import argparse
import logging
import time

from alembic import command
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from curves_migrations.config import alembic_config, database_url

LOCK_KEY = 485187443385121
CONNECT_TIMEOUT = 60.0
LOCK_TIMEOUT = 120.0
LOGGER = logging.getLogger("curves_migrations")


def connect(engine: Engine, timeout: float = CONNECT_TIMEOUT) -> Connection:
    """Retry transient connection failures within a bounded time budget."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return engine.connect()
        except OperationalError as error:
            state = getattr(error.orig, "sqlstate", None)
            if state and not (state.startswith("08") or state == "57P03"):
                raise RuntimeError("PostgreSQL rejected the connection") from None
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("PostgreSQL connection timeout") from None
            time.sleep(min(1.0, remaining))


def acquire_lock(connection: Connection, timeout: float = LOCK_TIMEOUT) -> None:
    """Acquire the migration session lock without holding a transaction open."""
    deadline = time.monotonic() + timeout
    while True:
        acquired = connection.scalar(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_KEY}
        )
        connection.commit()
        if acquired:
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Migration lock timeout")
        time.sleep(min(0.25, remaining))


def migrate(action: str, revision: str | None = None) -> None:
    """Execute Alembic on the same PostgreSQL session that owns the lock."""
    config = alembic_config()
    if action == "history":
        command.history(config)
        return
    engine = create_engine(
        database_url(),
        poolclass=NullPool,
        connect_args={"connect_timeout": 3},
        hide_parameters=True,
    )
    try:
        with connect(engine) as connection:
            locked = False
            try:
                if action in {"upgrade", "downgrade"}:
                    acquire_lock(connection)
                    locked = True
                config.attributes["connection"] = connection
                if action == "upgrade":
                    command.upgrade(config, revision or "head")
                elif action == "downgrade":
                    command.downgrade(config, revision)
                else:
                    command.current(config)
            finally:
                connection.rollback()
                if locked and not connection.invalidated:
                    connection.execute(
                        text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY}
                    )
                    connection.commit()
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    """Run the requested migration command and emit credential-free diagnostics."""
    parser = argparse.ArgumentParser(prog="curves-migrate")
    subparsers = parser.add_subparsers(dest="action")
    upgrade = subparsers.add_parser("upgrade")
    upgrade.add_argument("revision", nargs="?", default="head")
    downgrade = subparsers.add_parser("downgrade")
    downgrade.add_argument("revision")
    subparsers.add_parser("current")
    subparsers.add_parser("history")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        migrate(args.action or "upgrade", getattr(args, "revision", None))
    except Exception as error:
        LOGGER.error("Migration command failed (%s)", type(error).__name__)
        return 1
    LOGGER.info("Migration command completed")
    return 0
