import os
import shutil
import threading
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from curves_migrations import cli
from curves_migrations.config import alembic_config, database_url

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def database():
    """Migrate an explicitly supplied empty PostgreSQL 18.6 test database."""
    dsn = os.environ.get("MIGRATIONS_TEST_DSN")
    if not dsn:
        pytest.skip(
            "MIGRATIONS_TEST_DSN must point to an empty disposable PostgreSQL 18.6 database"
        )
    engine = create_engine(database_url(dsn), poolclass=NullPool)
    with engine.connect() as connection:
        assert connection.scalar(text("SHOW server_version_num")) == "180006"
        assert not connection.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n "
                "ON n.oid = c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' "
                "AND n.nspname <> 'information_schema' AND c.relkind IN ('r', 'v', 'm', 'S'))"
            )
        ), "Integration tests require an empty disposable database"
    previous = os.environ.get("DATABASE_DSN")
    os.environ["DATABASE_DSN"] = dsn
    try:
        cli.migrate("upgrade", "head")
        yield engine
    finally:
        try:
            cli.migrate("downgrade", "base")
        finally:
            engine.dispose()
            if previous is None:
                os.environ.pop("DATABASE_DSN", None)
            else:
                os.environ["DATABASE_DSN"] = previous


@pytest.fixture
def connection(database):
    """Roll back test records so schema lifecycle tests stay isolated."""
    with database.connect() as connection, connection.begin() as transaction:
        yield connection
        transaction.rollback()


def reject(connection, statement, params=None):
    """Assert a database invariant while preserving the surrounding test transaction."""
    with pytest.raises(DBAPIError), connection.begin_nested():
        connection.execute(text(statement), params or {})


def curve_inputs(connection):
    """Build synthetic accepted market inputs and a complete test methodology."""
    batch = connection.scalar(
        text("INSERT INTO market.ingestion_batch(source) VALUES ('TEST') RETURNING id")
    )
    curve = connection.scalar(
        text(
            "INSERT INTO market.curve(ingestion_batch_id, source, curve_code, curve_date, "
            "payload, payload_sha256, rate_convention) VALUES (:batch, 'TEST', 'TEST', "
            "'2026-01-01', '{}', repeat('a', 64), 'test') RETURNING id"
        ),
        {"batch": batch},
    )
    connection.execute(
        text(
            "INSERT INTO market.curve_point(curve_id, point_no, tenor_years, rate_pct) "
            "VALUES (:curve, 1, 1, -0.5), (:curve, 2, 30, 2)"
        ),
        {"curve": curve},
    )
    connection.execute(
        text("UPDATE market.curve SET status = 'accepted' WHERE id = :curve"),
        {"curve": curve},
    )
    grid = connection.scalar(text("SELECT id FROM ref.bucket_set"))
    methodology = connection.scalar(
        text(
            "INSERT INTO app.methodology_version(code, version_no, name, status, "
            "bucket_set_id, x, parallel_shift_pp, short_shift_pp, long_shift_pp, "
            "floor_mode, interpolation_method, extrapolation_method, nearest_method, "
            "rate_convention, created_by) VALUES ('test', 1, 'Synthetic test', 'ready', "
            ":grid, 4, 1, 1, 1, 'none', 'test', 'test', 'test', 'test', 'test') RETURNING id"
        ),
        {"grid": grid},
    )
    return {"curve": curve, "grid": grid, "methodology": methodology}


def curve_run(connection, inputs):
    """Create a pending curve calculation with an explicit base scenario."""
    run = connection.scalar(
        text(
            "INSERT INTO calc.curve_run(curve_id, methodology_id, bucket_set_id, "
            "reporting_date, created_by) VALUES (:curve, :methodology, :grid, "
            "'2026-01-01', 'test') RETURNING id"
        ),
        inputs,
    )
    base = connection.scalar(text("SELECT id FROM app.scenario WHERE code = 'base'"))
    connection.execute(
        text("INSERT INTO calc.run_scenario VALUES (:run, :scenario)"),
        {"run": run, "scenario": base},
    )
    return {**inputs, "run": run, "scenario": base}


def test_schema_cycle(database):
    """Upgrade twice, downgrade all owned objects and recreate the entire schema."""
    cli.migrate("upgrade", "head")
    cli.migrate("downgrade", "base")
    with database.connect() as connection:
        assert connection.scalar(text("SELECT to_regnamespace('calc')")) is None
    cli.migrate("upgrade", "head")


def test_seed_data(connection):
    """Verify exact grid tenors, seven scenarios and unknown methodology parameters."""
    rows = connection.execute(
        text(
            "SELECT label, tenor_years, upper_years FROM ref.time_bucket ORDER BY bucket_no"
        )
    ).all()
    assert len(rows) == 19
    assert [str(row.tenor_years) for row in rows] == [
        "0.00280000",
        "0.04170000",
        "0.16670000",
        "0.37500000",
        "0.62500000",
        "0.87500000",
        "1.25000000",
        "1.75000000",
        "2.50000000",
        "3.50000000",
        "4.50000000",
        "5.50000000",
        "6.50000000",
        "7.50000000",
        "8.50000000",
        "9.50000000",
        "12.50000000",
        "17.50000000",
        "25.00000000",
    ]
    assert rows[16].label == "15y"
    assert rows[-1].label == "30y" and rows[-1].upper_years is None
    assert connection.scalar(text("SELECT count(*) FROM app.scenario")) == 7
    draft = connection.execute(
        text("SELECT status, x, floor_mode, ec_formula FROM app.methodology_version")
    ).one()
    assert tuple(draft) == ("draft", None, None, None)


def test_draft_and_incomplete_methodology_rejected(connection):
    """Disallow incomplete publication and calculations based on a draft."""
    inputs = curve_inputs(connection)
    reject(
        connection,
        "UPDATE app.methodology_version SET status = 'ready' WHERE code = 'irrbb_initial'",
    )
    reject(
        connection,
        "INSERT INTO calc.curve_run(curve_id, methodology_id, bucket_set_id, reporting_date, created_by) "
        "SELECT :curve, id, bucket_set_id, '2026-01-01', 'test' FROM app.methodology_version WHERE code = 'irrbb_initial'",
        inputs,
    )
    reject(
        connection,
        "UPDATE app.methodology_version SET x = 4, parallel_shift_pp = 1, "
        "short_shift_pp = 1, long_shift_pp = 1, floor_mode = 'constant', "
        "floor_params = '{}', interpolation_method = 'test', extrapolation_method = 'test', "
        "nearest_method = 'test', rate_convention = 'test', status = 'ready' "
        "WHERE code = 'irrbb_initial'",
    )
    reject(
        connection,
        "UPDATE app.methodology_version SET x = 4, parallel_shift_pp = 1, "
        "short_shift_pp = 1, long_shift_pp = 1, floor_mode = 'by_bucket', "
        "floor_params = '{}', interpolation_method = 'test', extrapolation_method = 'test', "
        "nearest_method = 'test', rate_convention = 'test', status = 'ready' "
        "WHERE code = 'irrbb_initial'",
    )


def test_accepted_inputs_immutable(connection):
    """Protect accepted curves, published methodologies and their points."""
    inputs = curve_inputs(connection)
    reject(connection, "UPDATE market.curve SET revision = 2 WHERE id = :curve", inputs)
    reject(
        connection,
        "UPDATE market.curve_point SET rate_pct = 4 WHERE curve_id = :curve",
        inputs,
    )
    reject(connection, "DELETE FROM market.curve_point WHERE curve_id = :curve", inputs)
    reject(
        connection,
        "UPDATE app.methodology_version SET x = 5 WHERE id = :methodology",
        inputs,
    )
    reject(connection, "TRUNCATE market.curve_point")
    reject(
        connection,
        "INSERT INTO ref.time_bucket VALUES (:grid, 20, '40y', 30, 40, 35)",
        inputs,
    )
    reject(connection, "UPDATE app.scenario SET params = '{}' WHERE code = 'base'")


def test_source_scenario_and_bucket_foreign_keys(connection):
    """Reject results from another curve, grid or unselected scenario."""
    data = curve_run(connection, curve_inputs(connection))
    connection.execute(
        text(
            "INSERT INTO calc.base_curve_point VALUES (:run, :curve, :grid, 1, -0.5, 'known', 0.9, 0.1, NULL)"
        ),
        data,
    )
    reject(
        connection,
        "INSERT INTO calc.base_point_source VALUES (:run, 1, :curve + 100000, 1, 1)",
        data,
    )
    reject(
        connection,
        "INSERT INTO calc.base_curve_point VALUES (:run, :curve, :grid, 99, 1, 'known', 0.9, 0.1, NULL)",
        data,
    )
    reject(
        connection,
        "INSERT INTO calc.base_curve_point VALUES (:run, :curve, :grid + 100000, 2, 1, 'known', 0.9, 0.1, NULL)",
        data,
    )
    reject(
        connection,
        "INSERT INTO calc.stressed_curve_point SELECT :run, id, 1, 1, 0.5, 0.5 FROM app.scenario WHERE code = 'parallel_up'",
        data,
    )
    connection.execute(
        text(
            "INSERT INTO calc.stressed_curve_point VALUES (:run, :scenario, 1, 0, -0.5, -0.5)"
        ),
        data,
    )
    connection.execute(
        text("UPDATE calc.curve_run SET status = 'running' WHERE id = :run"), data
    )
    reject(connection, "DELETE FROM calc.run_scenario WHERE curve_run_id = :run", data)
    connection.execute(
        text("UPDATE calc.curve_run SET status = 'succeeded' WHERE id = :run"), data
    )
    reject(
        connection,
        "UPDATE calc.stressed_curve_point SET rate_pct = 1 WHERE curve_run_id = :run",
        data,
    )


def test_base_scenario_required_at_commit(connection):
    """Enforce base scenario membership with a deferred database constraint."""
    data = curve_run(connection, curve_inputs(connection))
    with pytest.raises(DBAPIError), connection.begin_nested():
        connection.execute(
            text("DELETE FROM calc.run_scenario WHERE curve_run_id = :run"), data
        )
        connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def test_portfolio_membership_and_nii_horizon(connection):
    """Keep instrument results inside the selected snapshot and require NII horizon."""
    data = curve_run(connection, curve_inputs(connection))
    connection.execute(
        text("UPDATE calc.curve_run SET status = 'succeeded' WHERE id = :run"), data
    )
    snapshots = []
    instruments = []
    for _ in range(2):
        snapshot = connection.scalar(
            text(
                "INSERT INTO app.portfolio_snapshot(as_of_date, source_file_name, source_file_sha256, uploaded_by) VALUES ('2026-01-01', 'test', repeat('b', 64), 'test') RETURNING id"
            )
        )
        instrument = connection.scalar(
            text(
                "INSERT INTO app.instrument(snapshot_id, external_id, instrument_type, balance_side, currency_code, notional, rate_type) VALUES (:snapshot, 'test', 'loan', 'asset', 'RUB', 100, 'fixed') RETURNING id"
            ),
            {"snapshot": snapshot},
        )
        connection.execute(
            text(
                "INSERT INTO app.instrument_cashflow(instrument_id, flow_date, cashflow_type, amount) VALUES (:instrument, '2027-01-01', 'principal', -100)"
            ),
            {"instrument": instrument},
        )
        connection.execute(
            text(
                "UPDATE app.portfolio_snapshot SET status = 'validated' WHERE id = :snapshot"
            ),
            {"snapshot": snapshot},
        )
        snapshots.append(snapshot)
        instruments.append(instrument)
    portfolio = connection.scalar(
        text(
            "INSERT INTO calc.portfolio_run(curve_run_id, portfolio_snapshot_id, reporting_date, methodology, created_by) VALUES (:run, :snapshot, '2026-01-01', '{}', 'test') RETURNING id"
        ),
        {**data, "snapshot": snapshots[0]},
    )
    params = {
        **data,
        "portfolio": portfolio,
        "snapshot": snapshots[0],
        "instrument": instruments[1],
    }
    reject(
        connection,
        "INSERT INTO calc.instrument_result VALUES (:portfolio, :run, :scenario, :snapshot, :instrument, 100, 0)",
        params,
    )
    reject(
        connection,
        "INSERT INTO calc.scenario_result VALUES (:portfolio, :run, :scenario, 'RUB', 100, 0, 5, 0)",
        params,
    )
    reject(
        connection,
        "INSERT INTO calc.scenario_result VALUES (:portfolio, :run, :scenario, 'USD', 100, 0, NULL, NULL)",
        params,
    )
    reject(
        connection,
        "UPDATE app.instrument SET notional = 200 WHERE id = :instrument",
        params,
    )
    reject(
        connection,
        "UPDATE app.instrument_cashflow SET amount = 200 WHERE instrument_id = :instrument",
        params,
    )
    connection.execute(
        text(
            "INSERT INTO calc.instrument_result VALUES (:portfolio, :run, :scenario, :snapshot, :instrument, -100, -1)"
        ),
        {**params, "instrument": instruments[0]},
    )


def test_audit_and_mart_are_read_only(connection):
    """Prevent audit rewrites and DML through reporting views."""
    connection.execute(
        text(
            "INSERT INTO audit.audit_log(actor, action, entity_type, entity_id) VALUES ('test', 'test', 'test', 1)"
        )
    )
    reject(connection, "UPDATE audit.audit_log SET actor = 'changed'")
    reject(connection, "DELETE FROM audit.audit_log")
    reject(connection, "TRUNCATE audit.audit_log")
    curve_inputs(connection)
    reject(connection, "UPDATE mart.v_curve SET rate_pct = 100")


def test_parallel_migrators_wait_for_session_lock(database):
    """Verify that a second migration session waits for the first session lock."""
    acquired = threading.Event()
    finished = threading.Event()
    failures = []

    def contender():
        """Acquire the migration lock on a second independent database session."""
        try:
            with database.connect() as connection:
                acquired.set()
                cli.acquire_lock(connection, timeout=3)
                connection.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": cli.LOCK_KEY}
                )
                connection.commit()
        except Exception as error:
            failures.append(error)
        finally:
            finished.set()

    with database.connect() as connection:
        cli.acquire_lock(connection)
        worker = threading.Thread(target=contender)
        worker.start()
        assert acquired.wait(2)
        assert not finished.wait(0.2)
        connection.execute(
            text("SELECT pg_advisory_unlock(:key)"), {"key": cli.LOCK_KEY}
        )
        connection.commit()
        worker.join(5)
    assert finished.is_set() and not failures


def test_failed_revision_is_rolled_back(database, tmp_path, monkeypatch):
    """Roll back a failing revision without changing the previous Alembic version."""
    config = alembic_config()
    source = Path(config.get_main_option("script_location"))
    target = tmp_path / "alembic"
    shutil.copytree(source, target)
    (target / "versions/0005_success.py").write_text(
        "from alembic import op\n"
        "revision = '0005_success'\n"
        "down_revision = '0004_guards'\n"
        "def upgrade():\n"
        "    op.execute('CREATE TABLE public.committed_probe(id integer)')\n"
        "def downgrade():\n"
        "    op.execute('DROP TABLE public.committed_probe')\n",
        encoding="utf-8",
    )
    (target / "versions/0006_failure.py").write_text(
        "from alembic import op\n"
        "revision = '0006_failure'\n"
        "down_revision = '0005_success'\n"
        "def upgrade():\n"
        "    op.execute('CREATE TABLE public.rollback_probe(id integer)')\n"
        "    op.execute('SELECT 1 / 0')\n"
        "def downgrade():\n"
        "    op.execute('DROP TABLE public.rollback_probe')\n",
        encoding="utf-8",
    )
    config.set_main_option("script_location", str(target))
    monkeypatch.setattr(cli, "alembic_config", lambda: config)
    with pytest.raises(DBAPIError):
        cli.migrate("upgrade", "head")
    with database.connect() as connection:
        assert (
            connection.scalar(text("SELECT to_regclass('public.rollback_probe')"))
            is None
        )
        assert (
            connection.scalar(text("SELECT version_num FROM public.alembic_version"))
            == "0005_success"
        )
        assert connection.scalar(text("SELECT to_regclass('public.committed_probe')"))
        assert connection.scalar(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": cli.LOCK_KEY}
        )
        connection.execute(
            text("SELECT pg_advisory_unlock(:key)"), {"key": cli.LOCK_KEY}
        )
        connection.commit()
    cli.migrate("downgrade", "0004_guards")
