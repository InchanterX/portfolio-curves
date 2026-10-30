"""Domain models for IRRBB curve construction and stress scenarios."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Tuple


@dataclass(frozen=True, slots=True)
class BucketDefinition:
    number: int
    label: str
    maturity_years: float


@dataclass(frozen=True, slots=True)
class CurveNode:
    """One point from the source G-curve.

    `moex_index` is the source node index supplied by the MOEX adapter.
    """

    maturity_years: float
    rate_percent: float
    moex_index: int


@dataclass(frozen=True, slots=True)
class BucketResult:
    number: int
    label: str
    maturity_years: float
    exp_weight: float
    long_weight: float
    moex_node_index: int
    floor_percent: float
    base_rate_percent: float


@dataclass(frozen=True, slots=True)
class ScenarioPoint:
    bucket_number: int
    bucket_label: str
    shift_pp: float
    stressed_rate_percent: float


@dataclass(frozen=True, slots=True)
class ScenarioResult:
    name: str
    points: Tuple[ScenarioPoint, ...]


@dataclass(frozen=True, slots=True)
class CurveAnalysis:
    as_of: date
    x_years: float
    source_node_count: int
    buckets: Tuple[BucketResult, ...]
    scenarios: Tuple[ScenarioResult, ...]


@dataclass(frozen=True, slots=True)
class AnalysisExecution:
    """Result of one service run, including locations returned by output ports."""

    analysis: CurveAnalysis
    result_files: Tuple[str, ...]
    chart_files: Tuple[str, ...]
