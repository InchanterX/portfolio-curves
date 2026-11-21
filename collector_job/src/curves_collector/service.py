import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def collect(source, repository, start=None, end=None):
    """Load an explicit date interval or an overlapping incremental interval."""
    if not repository.acquire_lock():
        logger.info("Another collector holds the lock; skipping")
        return 0
    today = datetime.now(timezone(timedelta(hours=3))).date()
    end = end or today
    latest = repository.latest_date() if start is None else None
    start = start or (latest - timedelta(days=7) if latest else end - timedelta(days=29))
    if start > end:
        raise ValueError("Start date must not be later than end date")
    batch_id = repository.start_batch()
    try:
        curves = source.fetch(start, end)
        count = repository.save(batch_id, curves)
        repository.finish_batch(batch_id)
    except Exception as exc:
        logger.exception("Collector batch %s failed", batch_id)
        repository.finish_batch(batch_id, type(exc).__name__)
        raise
    logger.info("Batch %s: %s observations, %s new revisions", batch_id, len(curves), count)
    return count
