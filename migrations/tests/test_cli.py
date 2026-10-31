import logging
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError

from curves_migrations import cli


def test_default_command(monkeypatch):
    """Upgrade to head when the container starts without arguments."""
    migrate = Mock()
    monkeypatch.setattr(cli, "migrate", migrate)
    assert cli.main([]) == 0
    migrate.assert_called_once_with("upgrade", None)


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (["upgrade", "0001_inputs"], ("upgrade", "0001_inputs")),
        (["downgrade", "base"], ("downgrade", "base")),
        (["current"], ("current", None)),
        (["history"], ("history", None)),
    ],
)
def test_explicit_commands(args, expected, monkeypatch):
    """Forward an explicit operation and revision without changing its meaning."""
    migrate = Mock()
    monkeypatch.setattr(cli, "migrate", migrate)
    assert cli.main(args) == 0
    migrate.assert_called_once_with(*expected)


def test_downgrade_requires_revision():
    """Reject an ambiguous rollback before opening a connection."""
    with pytest.raises(SystemExit) as caught:
        cli.main(["downgrade"])
    assert caught.value.code == 2


def test_failure_does_not_log_secret(monkeypatch, caplog):
    """Return failure without exposing credentials from an underlying exception."""
    monkeypatch.setattr(
        cli,
        "migrate",
        Mock(side_effect=RuntimeError("postgresql://user:secret@host/db")),
    )
    with caplog.at_level(logging.ERROR):
        assert cli.main([]) == 1
    assert "secret" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_history_needs_no_database(monkeypatch, capsys):
    """Display migration history without requiring database credentials."""
    monkeypatch.delenv("DATABASE_DSN", raising=False)
    assert cli.main(["history"]) == 0
    assert "0004_guards" in capsys.readouterr().out


def test_connection_retry(monkeypatch):
    """Retry a transient connection error and return the successful connection."""
    engine = Mock()
    connection = Mock()
    engine.connect.side_effect = [OperationalError(None, None, OSError()), connection]
    monkeypatch.setattr(cli.time, "sleep", Mock())
    assert cli.connect(engine) is connection
    assert engine.connect.call_count == 2


def test_authentication_failure_is_not_retried(monkeypatch):
    """Stop immediately when PostgreSQL rejects authentication."""
    original = Mock(sqlstate="28P01")
    engine = Mock()
    engine.connect.side_effect = OperationalError(None, None, original)
    sleep = Mock()
    monkeypatch.setattr(cli.time, "sleep", sleep)
    with pytest.raises(RuntimeError, match="rejected"):
        cli.connect(engine)
    sleep.assert_not_called()


def test_connection_timeout(monkeypatch):
    """Stop retrying when the connection time budget is exhausted."""
    engine = Mock()
    engine.connect.side_effect = OperationalError(None, None, OSError())
    monkeypatch.setattr(cli.time, "monotonic", Mock(side_effect=[0, 61]))
    with pytest.raises(TimeoutError, match="connection"):
        cli.connect(engine)


def test_lock_timeout(monkeypatch):
    """Limit lock waiting and end each unsuccessful polling transaction."""
    connection = Mock()
    connection.scalar.return_value = False
    monkeypatch.setattr(cli.time, "monotonic", Mock(side_effect=[0, 121]))
    with pytest.raises(TimeoutError, match="lock"):
        cli.acquire_lock(connection)
    connection.commit.assert_called_once()


def test_successful_lock():
    """Keep the session lock while closing the polling transaction."""
    connection = Mock()
    connection.scalar.return_value = True
    cli.acquire_lock(connection)
    connection.commit.assert_called_once()
