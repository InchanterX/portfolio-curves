from alembic import op

revision = "0007_collector"
down_revision = "0006_deals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Allow repeated historical payloads and expose latest bucketed points."""
    op.execute("ALTER TABLE market.curve DROP CONSTRAINT uq_curve_payload")
    op.execute("""
        CREATE VIEW mart.v_curve_bucket AS
        SELECT c.id AS curve_id, c.ingestion_batch_id, c.source, c.curve_code,
               c.currency_code, c.curve_date, c.revision, c.loaded_at,
               p.point_no, p.tenor_years, p.rate_pct,
               s.code AS bucket_set_code, s.version_no AS bucket_set_version,
               b.bucket_no, b.label AS bucket_label, b.lower_years, b.upper_years,
               b.tenor_years AS bucket_midpoint_years
        FROM mart.v_latest_curve latest
        JOIN market.curve c ON c.id = latest.id
        JOIN market.curve_point p ON p.curve_id = c.id
        JOIN ref.bucket_set s ON s.code = 'irrbb_excel' AND s.version_no = 1
        JOIN ref.time_bucket b ON b.bucket_set_id = s.id
            AND p.tenor_years > b.lower_years
            AND (b.upper_years IS NULL OR p.tenor_years <= b.upper_years)
    """)
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_reader') THEN
                GRANT SELECT ON mart.v_curve_bucket TO metabase_reader;
            END IF;
        END $$
    """)


def downgrade() -> None:
    """Remove the view and restore the original payload uniqueness rule."""
    op.execute("DROP VIEW mart.v_curve_bucket")
    op.execute("ALTER TABLE market.curve ADD CONSTRAINT uq_curve_payload "
               "UNIQUE (source, curve_code, currency_code, curve_date, payload_sha256)")
