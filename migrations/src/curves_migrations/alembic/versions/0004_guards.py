from pathlib import Path

from alembic import op

revision = "0004_guards"
down_revision = "0003_seed"
branch_labels = None
depends_on = None

TRIGGERS = {
    "ref.bucket_set": ["immutable", "no_truncate"],
    "ref.time_bucket": ["immutable", "no_truncate", "protect_bucket_insert"],
    "market.curve": ["protect_curve", "no_truncate"],
    "market.curve_point": ["protect_point", "no_truncate"],
    "app.methodology_version": ["protect_methodology", "no_truncate"],
    "app.scenario": ["protect_scenario", "no_truncate"],
    "app.portfolio_snapshot": ["protect_snapshot", "no_truncate"],
    "app.instrument": ["protect_instrument", "no_truncate"],
    "app.instrument_cashflow": ["protect_cashflow", "no_truncate"],
    "audit.audit_log": ["immutable", "no_truncate"],
    "calc.curve_run": ["protect_run", "no_truncate"],
    "calc.portfolio_run": ["protect_run", "no_truncate"],
    "calc.run_scenario": ["protect_result", "no_truncate", "require_base"],
    "calc.base_curve_point": ["protect_result", "no_truncate"],
    "calc.base_point_source": ["protect_result", "no_truncate"],
    "calc.stressed_curve_point": ["protect_result", "no_truncate"],
    "calc.scenario_result": ["protect_result", "no_truncate"],
    "calc.bucket_result": ["protect_result", "no_truncate"],
    "calc.instrument_result": ["protect_result", "no_truncate"],
}
VIEWS = [
    "v_instrument_result",
    "v_scenario_result",
    "v_run_summary",
    "v_stressed_curve",
    "v_curve",
    "v_latest_curve",
]
FUNCTIONS = [
    "require_base_scenario",
    "guard_result",
    "guard_run",
    "guard_cashflow",
    "guard_instrument",
    "guard_snapshot",
    "guard_scenario",
    "guard_methodology",
    "guard_curve_point",
    "guard_curve",
    "guard_bucket_insert",
    "reject_change",
]


def upgrade() -> None:
    """Install input guards, calculation invariants and read-only reporting views."""
    sql = Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql)


def downgrade() -> None:
    """Remove reporting views and protection triggers before reverting seed data."""
    for view in VIEWS:
        op.execute(f"DROP VIEW mart.{view}")
    for table, triggers in TRIGGERS.items():
        for trigger in triggers:
            op.execute(f"DROP TRIGGER {trigger} ON {table}")
    op.execute("DROP TRIGGER require_base ON calc.curve_run")
    for function in FUNCTIONS:
        op.execute(f"DROP FUNCTION app.{function}()")
