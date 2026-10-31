from pathlib import Path

from alembic import op

revision = "0001_inputs"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create reference data, market inputs, scenarios and portfolio inputs."""
    sql = Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql)


def downgrade() -> None:
    """Remove input tables and owned schemas in reverse dependency order."""
    for table in (
        "audit.audit_log",
        "app.instrument_cashflow",
        "app.instrument",
        "app.portfolio_snapshot",
        "app.scenario",
        "app.methodology_version",
        "market.curve_point",
        "market.curve",
        "market.ingestion_batch",
        "ref.time_bucket",
        "ref.bucket_set",
    ):
        op.execute(f"DROP TABLE {table}")
    for schema in ("mart", "audit", "calc", "app", "market", "ref"):
        op.execute(f"DROP SCHEMA {schema}")
