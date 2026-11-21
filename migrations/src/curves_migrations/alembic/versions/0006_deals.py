from pathlib import Path

from alembic import op

revision = "0006_deals"
down_revision = "0005_remove_legacy_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the partner team's deal contract without inferred constraints."""
    op.get_bind().exec_driver_sql(
        Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")
    )


def downgrade() -> None:
    """Remove deals without dropping the shared public schema."""
    op.execute("DROP TABLE public.deals")
