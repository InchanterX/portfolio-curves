from pathlib import Path

from alembic import op

revision = "0005_remove_legacy_auth"
down_revision = "0004_guards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Remove obsolete authentication; retain string authors and audit actors."""
    op.get_bind().exec_driver_sql(
        Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")
    )


def downgrade() -> None:
    """Restore empty auth tables and nullable references, not deleted credentials."""
    op.get_bind().exec_driver_sql(
        Path(__file__)
        .with_name("0005_restore_legacy_auth.sql")
        .read_text(encoding="utf-8")
    )
