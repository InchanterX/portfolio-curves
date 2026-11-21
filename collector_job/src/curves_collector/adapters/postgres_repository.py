import hashlib
import json

from psycopg.types.json import Jsonb

SOURCE = "cbr"
CURVE_CODE = "zcyc"
CURRENCY = "RUB"
LOCK_ID = 723897451103


class PostgresRepository:
    def __init__(self, connection):
        """Keep a single session for the advisory lock and transactions."""
        self.connection = connection

    def acquire_lock(self):
        """Avoid overlaps between scheduled and initial jobs."""
        with self.connection.transaction():
            return self.connection.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_ID,)).fetchone()[0]

    def latest_date(self):
        """Find the latest accepted observation from this source."""
        with self.connection.transaction():
            return self.connection.execute(
                "SELECT max(curve_date) FROM market.curve WHERE source=%s AND curve_code=%s "
                "AND currency_code=%s AND status='accepted'", (SOURCE, CURVE_CODE, CURRENCY),
            ).fetchone()[0]

    def start_batch(self):
        """Record a new ingestion attempt."""
        with self.connection.transaction():
            return self.connection.execute(
                "INSERT INTO market.ingestion_batch (source) VALUES (%s) RETURNING id", (SOURCE,),
            ).fetchone()[0]

    def finish_batch(self, batch_id, error=None):
        """Persist the result of an ingestion attempt."""
        with self.connection.transaction():
            self.connection.execute(
                "UPDATE market.ingestion_batch SET status=%s, finished_at=now(), error_message=%s WHERE id=%s",
                ("failed" if error else "succeeded", error, batch_id),
            )

    def save(self, batch_id, curves):
        """Atomically store new and corrected observations with all their points."""
        inserted = 0
        with self.connection.transaction():
            for curve in curves:
                payload = {"date": curve.date.isoformat(), "points": [
                    {"tenor_years": str(tenor.normalize()), "rate_pct": str(rate.normalize())}
                    for tenor, rate in curve.points
                ]}
                encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
                digest = hashlib.sha256(encoded.encode()).hexdigest()
                latest = self.connection.execute(
                    "SELECT revision, payload_sha256 FROM market.curve "
                    "WHERE source=%s AND curve_code=%s AND currency_code=%s AND curve_date=%s "
                    "AND status='accepted' ORDER BY revision DESC LIMIT 1",
                    (SOURCE, CURVE_CODE, CURRENCY, curve.date),
                ).fetchone()
                if latest and latest[1] == digest:
                    continue
                revision = self.connection.execute(
                    "SELECT coalesce(max(revision), 0) + 1 FROM market.curve "
                    "WHERE source=%s AND curve_code=%s AND currency_code=%s AND curve_date=%s",
                    (SOURCE, CURVE_CODE, CURRENCY, curve.date),
                ).fetchone()[0]
                curve_id = self.connection.execute(
                    "INSERT INTO market.curve (ingestion_batch_id,source,curve_code,currency_code,"
                    "curve_date,revision,payload,payload_sha256,rate_convention) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                    (batch_id, SOURCE, CURVE_CODE, CURRENCY, curve.date, revision, Jsonb(payload), digest,
                     "percent_per_annum"),
                ).fetchone()[0]
                with self.connection.cursor() as cursor:
                    cursor.executemany(
                        "INSERT INTO market.curve_point (curve_id,point_no,tenor_years,rate_pct) "
                        "VALUES (%s,%s,%s,%s)",
                        [(curve_id, number, tenor, rate) for number, (tenor, rate) in enumerate(curve.points, 1)],
                    )
                self.connection.execute("UPDATE market.curve SET status='accepted' WHERE id=%s", (curve_id,))
                inserted += 1
        return inserted
