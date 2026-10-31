from pathlib import Path

import pytest
from alembic.script import ScriptDirectory

from curves_migrations.config import alembic_config, database_url


@pytest.mark.parametrize("scheme", ["postgresql", "postgresql+psycopg"])
def test_url_normalization(scheme):
    """Keep encoded credentials and query parameters while selecting psycopg."""
    url = database_url(f"{scheme}://user:p%40ss%25word@host:5432/db?sslmode=require")
    assert url.drivername == "postgresql+psycopg"
    assert url.password == "p@ss%word"
    assert url.query["sslmode"] == "require"
    assert url.database == "db"


@pytest.mark.parametrize(
    "dsn",
    ["", "bad:secret-password", "sqlite:///secret-password", "postgresql://host"],
)
def test_invalid_urls_do_not_disclose_input(dsn, monkeypatch):
    """Reject unsupported URLs without including the supplied secret."""
    monkeypatch.delenv("DATABASE_DSN", raising=False)
    with pytest.raises(ValueError) as caught:
        database_url(dsn)
    assert "secret-password" not in str(caught.value)


def test_environment_url(monkeypatch):
    """Read the database URL from the existing container environment contract."""
    monkeypatch.setenv("DATABASE_DSN", "postgresql://user:secret@host/db")
    assert database_url().password == "secret"


def test_packaged_revisions_are_independent_of_cwd(tmp_path, monkeypatch):
    """Discover a single migration head from any working directory."""
    monkeypatch.chdir(tmp_path)
    script = ScriptDirectory.from_config(alembic_config())
    assert script.get_heads() == ["0004_guards"]
    revisions = list(script.walk_revisions())
    assert len(revisions) == 4
    for revision in revisions:
        if revision.revision in {"0001_inputs", "0002_calculations", "0004_guards"}:
            assert Path(revision.path).with_suffix(".sql").is_file()
