from pathlib import Path

from alembic import op

revision = "0002_calculations"
down_revision = "0001_inputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create independent curve calculations and linked portfolio results."""
    sql = Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql)


def downgrade() -> None:
    """Remove calculation results before their parent runs."""
    for table in (
        "instrument_result",
        "bucket_result",
        "scenario_result",
        "portfolio_run",
        "stressed_curve_point",
        "base_point_source",
        "base_curve_point",
        "run_scenario",
        "curve_run",
    ):
        op.execute(f"DROP TABLE calc.{table}")
