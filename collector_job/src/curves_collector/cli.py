import argparse
import logging
import os
from datetime import date

import psycopg

from curves_collector.adapters.cbr_client import CbrClient
from curves_collector.adapters.postgres_repository import PostgresRepository
from curves_collector.service import collect


def main():
    """Run the collector once and return a nonzero status on failure."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-date", type=date.fromisoformat)
    parser.add_argument("--to-date", type=date.fromisoformat)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        dsn = os.environ["DATABASE_DSN"]
        with psycopg.connect(dsn, connect_timeout=10) as connection:
            collect(CbrClient(), PostgresRepository(connection), args.from_date, args.to_date)
    except Exception:
        logging.exception("Collector failed")
        return 1
    return 0
