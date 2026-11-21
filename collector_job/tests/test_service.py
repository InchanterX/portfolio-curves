from datetime import date

import pytest

from curves_collector.service import collect


class Repository:
    def __init__(self, latest=None, locked=True):
        self.latest = latest
        self.locked = locked
        self.result = None

    def acquire_lock(self):
        return self.locked

    def latest_date(self):
        return self.latest

    def start_batch(self):
        return 1

    def save(self, batch_id, curves):
        return len(curves)

    def finish_batch(self, batch_id, error=None):
        self.result = error or 'success'


class Source:
    def __init__(self, fail=False):
        self.interval = None
        self.fail = fail

    def fetch(self, start, end):
        self.interval = (start, end)
        if self.fail:
            raise ValueError('private details')
        return []


def test_initial_and_incremental_intervals():
    source = Source()
    collect(source, Repository(), end=date(2026, 11, 30))
    assert source.interval == (date(2026, 11, 1), date(2026, 11, 30))
    collect(source, Repository(date(2026, 11, 20)), end=date(2026, 11, 30))
    assert source.interval == (date(2026, 11, 13), date(2026, 11, 30))


def test_failed_batch_and_concurrent_skip():
    repo = Repository()
    with pytest.raises(ValueError):
        collect(Source(fail=True), repo, start=date(2026, 11, 1), end=date(2026, 11, 30))
    assert repo.result == 'ValueError'
    assert collect(Source(fail=True), Repository(locked=False)) == 0
