"""Static model configuration. Keep model assumptions out of daily source data."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Tuple

from .domain import BucketDefinition


DEFAULT_BUCKETS: Tuple[BucketDefinition, ...] = (
    BucketDefinition(1, "1d", 1 / 365),
    BucketDefinition(2, "1m", 1 / 12),
    BucketDefinition(3, "3m", 0.25),
    BucketDefinition(4, "6m", 0.50),
    BucketDefinition(5, "9m", 0.75),
    BucketDefinition(6, "1y", 1.0),
    BucketDefinition(7, "1.5y", 1.5),
    BucketDefinition(8, "2y", 2.0),
    BucketDefinition(9, "3y", 3.0),
    BucketDefinition(10, "4y", 4.0),
    BucketDefinition(11, "5y", 5.0),
    BucketDefinition(12, "6y", 6.0),
    BucketDefinition(13, "7y", 7.0),
    BucketDefinition(14, "8y", 8.0),
    BucketDefinition(15, "9y", 9.0),
    BucketDefinition(16, "10y", 10.0),
    BucketDefinition(17, "20y", 20.0),
    BucketDefinition(18, "30y", 30.0),
)


@dataclass(frozen=True, slots=True)
class IRRBBConfig:
    # Exponential decay parameter in e^(-t/x).
    x_years: float = 4.0

    # All shifts below are expressed in percentage points (p.p.).
    parallel_shift_pp: float = 4.0
    short_rate_shift_pp: float = 5.0

    # Placeholder defaults for the missing Excel steepener/flattener inputs.
    # Reconcile these four values with the source workbook before production use.
    steepener_short_pp: float = 4.0
    steepener_long_pp: float = 4.0
    flattener_short_pp: float = 4.0
    flattener_long_pp: float = 4.0

    # Floor(t) = min(floor_cap_pp, floor_intercept_pp + floor_slope_pp * t).
    floor_intercept_pp: float = -1.5
    floor_slope_pp: float = 0.03
    floor_cap_pp: float = 0.0
    apply_floor_to_negative_shifts: bool = True

    buckets: Tuple[BucketDefinition, ...] = field(default_factory=lambda: DEFAULT_BUCKETS)

    def __post_init__(self) -> None:
        if self.x_years <= 0:
            raise ValueError("x_years must be greater than zero")
        if not self.buckets:
            raise ValueError("At least one bucket must be configured")
        numbers = [bucket.number for bucket in self.buckets]
        labels = [bucket.label for bucket in self.buckets]
        maturities = [bucket.maturity_years for bucket in self.buckets]
        if len(numbers) != len(set(numbers)):
            raise ValueError("Bucket numbers must be unique")
        if len(labels) != len(set(labels)):
            raise ValueError("Bucket labels must be unique")
        if any(value <= 0 for value in maturities):
            raise ValueError("Bucket maturities must be greater than zero")
        if maturities != sorted(maturities):
            raise ValueError("Buckets must be sorted by maturity")
