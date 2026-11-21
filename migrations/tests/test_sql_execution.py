"""Check SQLAlchemy-to-psycopg SQL forwarding without a PostgreSQL server."""

import importlib.util
from pathlib import Path

from psycopg._queries import PostgresQuery
from psycopg.adapt import Transformer
from sqlalchemy import create_engine


def test_guard_migration_preserves_postgres_format_placeholders(monkeypatch):
    """Raw %I/%s in PL/pgSQL must not be interpreted as psycopg parameters."""
    path = (
        Path(__file__).resolve().parents[1]
        / "src/curves_migrations/alembic/versions/0004_guards.py"
    )
    spec = importlib.util.spec_from_file_location("guards_revision", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sql = path.with_suffix(".sql").read_text(encoding="utf-8")
    calls = []

    def forward(cursor, statement, parameters, context=None):
        query = PostgresQuery(Transformer())
        query.convert(statement, parameters)
        calls.append((query.query, parameters))
        # SQLite supplies a real SQLAlchemy connection/cursor; only the PostgreSQL
        # parser is exercised here. Full DDL execution belongs to integration tests.
        cursor.execute("SELECT 1")

    engine = create_engine("sqlite://")
    monkeypatch.setattr(engine.dialect, "do_execute", forward)
    monkeypatch.setattr(
        engine.dialect,
        "do_execute_no_params",
        lambda cursor, statement, context=None: forward(
            cursor, statement, None, context
        ),
    )
    try:
        with engine.connect() as connection:
            monkeypatch.setattr(module.op, "get_bind", lambda: connection)
            module.upgrade()
        assert calls == [(sql.encode("utf-8"), None)]
    finally:
        engine.dispose()
