import os
from datetime import date
from decimal import Decimal

import psycopg
import pytest

from curves_collector.adapters.postgres_repository import PostgresRepository
from curves_collector.domain import Curve

pytestmark = pytest.mark.integration


def test_revisions_lock_and_bucket_view():
    dsn = os.environ.get('COLLECTOR_TEST_DSN')
    if not dsn:
        pytest.skip('COLLECTOR_TEST_DSN must point to a disposable migrated database')
    points = ((Decimal('0.25'), Decimal('10')), (Decimal('30'), Decimal('12')))
    first = Curve(date(2026, 1, 1), points)
    corrected = Curve(first.date, ((Decimal('0.25'), Decimal('11')), points[1]))
    with psycopg.connect(dsn) as conn, psycopg.connect(dsn) as other:
        conn.execute('SET ROLE curves_collector')
        conn.commit()
        repo = PostgresRepository(conn)
        assert repo.acquire_lock()
        assert not PostgresRepository(other).acquire_lock()
        batch = repo.start_batch()
        assert repo.save(batch, [first]) == 1
        assert repo.save(batch, [first]) == 0
        assert repo.save(batch, [corrected]) == 1
        assert repo.save(batch, [first]) == 1
        repo.finish_batch(batch)
        other.execute('SET ROLE metabase_reader')
        other.commit()
        rows = other.execute('SELECT revision, bucket_no, rate_pct FROM mart.v_curve_bucket '
                            'WHERE curve_date = %s ORDER BY bucket_no', (first.date,)).fetchall()
        assert [(r[0], r[1]) for r in rows] == [(3, 3), (3, 19)]
        assert rows[0][2] == Decimal('10')
