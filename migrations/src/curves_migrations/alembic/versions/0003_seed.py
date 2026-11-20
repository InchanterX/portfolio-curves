from alembic import op
from sqlalchemy import text

revision = "0003_seed"
down_revision = "0002_calculations"
branch_labels = None
depends_on = None

BUCKETS = [
    ("1d", "0", "0.0028", "0.0028"),
    ("1m", "0.0028", "0.08333333", "0.0417"),
    ("3m", "0.08333333", "0.25", "0.1667"),
    ("6m", "0.25", "0.5", "0.375"),
    ("9m", "0.5", "0.75", "0.625"),
    ("1y", "0.75", "1", "0.875"),
    ("1.5y", "1", "1.5", "1.25"),
    ("2y", "1.5", "2", "1.75"),
    ("3y", "2", "3", "2.5"),
    ("4y", "3", "4", "3.5"),
    ("5y", "4", "5", "4.5"),
    ("6y", "5", "6", "5.5"),
    ("7y", "6", "7", "6.5"),
    ("8y", "7", "8", "7.5"),
    ("9y", "8", "9", "8.5"),
    ("10y", "9", "10", "9.5"),
    ("15y", "10", "15", "12.5"),
    ("20y", "15", "20", "17.5"),
    ("30y", "20", None, "25"),
]
SCENARIOS = [
    ("base", "Base"),
    ("parallel_up", "Parallel up"),
    ("parallel_down", "Parallel down"),
    ("steepener", "Steepener"),
    ("flattener", "Flattener"),
    ("short_up", "Short rate up"),
    ("short_down", "Short rate down"),
]


def upgrade() -> None:
    """Seed the agreed bucket grid, standard scenarios and an incomplete methodology."""
    connection = op.get_bind()
    grid_id = connection.scalar(
        text(
            "INSERT INTO ref.bucket_set(code, version_no, name) "
            "VALUES ('irrbb_excel', 1, 'IRRBB 19 buckets, supplied Excel tenors') "
            "RETURNING id"
        )
    )
    connection.execute(
        text(
            "INSERT INTO ref.time_bucket "
            "(bucket_set_id, bucket_no, label, lower_years, upper_years, tenor_years) "
            "VALUES (:grid, :number, :label, :lower, :upper, :tenor)"
        ),
        [
            dict(
                grid=grid_id,
                number=number,
                label=label,
                lower=lower,
                upper=upper,
                tenor=tenor,
            )
            for number, (label, lower, upper, tenor) in enumerate(BUCKETS, 1)
        ],
    )
    connection.execute(
        text(
            "INSERT INTO app.scenario "
            "(code, version_no, name, shift_type, is_predefined, created_by) "
            "VALUES (:code, 1, :name, :code, true, 'migration')"
        ),
        [dict(code=code, name=name) for code, name in SCENARIOS],
    )
    connection.execute(
        text(
            "INSERT INTO app.methodology_version "
            "(code, version_no, name, bucket_set_id, source_document, created_by) "
            "VALUES ('irrbb_initial', 1, 'Unconfirmed methodology', :grid, "
            "'BCBS IRRBB April 2016 and supplied Excel; parameters unconfirmed', 'migration')"
        ),
        {"grid": grid_id},
    )


def downgrade() -> None:
    """Delete only the seeded versions and their bucket grid."""
    connection = op.get_bind()
    connection.execute(
        text(
            "DELETE FROM app.methodology_version "
            "WHERE code = 'irrbb_initial' AND version_no = 1"
        )
    )
    connection.execute(
        text("DELETE FROM app.scenario WHERE code = :code AND version_no = 1"),
        [dict(code=code) for code, _ in SCENARIOS],
    )
    connection.execute(
        text(
            "DELETE FROM ref.time_bucket WHERE bucket_set_id IN "
            "(SELECT id FROM ref.bucket_set WHERE code = 'irrbb_excel' AND version_no = 1)"
        )
    )
    connection.execute(
        text("DELETE FROM ref.bucket_set WHERE code = 'irrbb_excel' AND version_no = 1")
    )
