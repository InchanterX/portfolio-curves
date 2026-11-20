import os
import sys
from pathlib import Path

from alembic.config import Config
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


def database_url(value: str | None = None) -> URL:
    """Read the PostgreSQL URL without exposing credentials in errors."""
    dsn = value if value is not None else os.environ.get("DATABASE_DSN")
    if not dsn:
        raise ValueError("DATABASE_DSN is required")
    try:
        url = make_url(dsn)
    except ArgumentError, ValueError, TypeError:
        raise ValueError("DATABASE_DSN is not a valid PostgreSQL URL") from None
    if url.drivername not in {"postgresql", "postgresql+psycopg"}:
        raise ValueError("DATABASE_DSN must use PostgreSQL with psycopg")
    if not url.database:
        raise ValueError("DATABASE_DSN must include a database name")
    return url.set(drivername="postgresql+psycopg")


def alembic_config() -> Config:
    """Resolve packaged migration files independently of the working directory."""
    config = Config(stdout=sys.stdout)
    config.set_main_option("script_location", str(Path(__file__).parent / "alembic"))
    return config
