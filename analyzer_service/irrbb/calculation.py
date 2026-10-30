"""Pure calculation functions used by the IRRBB business service."""

from __future__ import annotations

import bisect
import math
from datetime import date
from typing import Sequence

from .config import IRRBBConfig
from .domain import (
    BucketResult,
    CurveAnalysis,
    CurveNode,
    ScenarioPoint,
    ScenarioResult,
)


def _validate_nodes(nodes: Sequence[CurveNode]) -> list[CurveNode]:
    if not nodes:
        raise ValueError("Source curve contains no nodes")

    ordered = sorted(nodes, key=lambda node: node.maturity_years)
    for node in ordered:
        if not math.isfinite(node.maturity_years) or node.maturity_years < 0:
            raise ValueError("MOEX node maturities must be finite and non-negative")
        if not math.isfinite(node.rate_percent):
            raise ValueError("MOEX node rates must be finite")
    for left, right in zip(ordered, ordered[1:]):
        if math.isclose(left.maturity_years, right.maturity_years, abs_tol=1e-12):
            raise ValueError(
                f"Duplicate MOEX node maturity: {left.maturity_years} years"
            )
    return ordered


def interpolate_rate(
    maturity_years: float,
    nodes: Sequence[CurveNode],
) -> tuple[float, int]:
    """Linearly interpolate a rate and return the lower/selected MOEX node index.

    Outside the source curve range, the nearest endpoint rate is used. For a
    maturity between source nodes, `moex_node_index` is the index of the left
    (lower-maturity) node. At an exact node it is that node's index.
    """
    if not math.isfinite(maturity_years) or maturity_years < 0:
        raise ValueError("Requested maturity must be finite and non-negative")

    ordered = _validate_nodes(nodes)
    maturities = [node.maturity_years for node in ordered]

    if maturity_years <= maturities[0]:
        return ordered[0].rate_percent, ordered[0].moex_index
    if maturity_years >= maturities[-1]:
        return ordered[-1].rate_percent, ordered[-1].moex_index

    right_pos = bisect.bisect_left(maturities, maturity_years)
    right = ordered[right_pos]
    if math.isclose(maturity_years, right.maturity_years, rel_tol=0.0, abs_tol=1e-12):
        return right.rate_percent, right.moex_index

    left = ordered[right_pos - 1]
    fraction = (maturity_years - left.maturity_years) / (
        right.maturity_years - left.maturity_years
    )
    rate = left.rate_percent + fraction * (right.rate_percent - left.rate_percent)
    return rate, left.moex_index


def _floor_percent(maturity_years: float, config: IRRBBConfig) -> float:
    return min(
        config.floor_cap_pp,
        config.floor_intercept_pp + config.floor_slope_pp * maturity_years,
    )


def _build_buckets(nodes: Sequence[CurveNode], config: IRRBBConfig) -> tuple[BucketResult, ...]:
    result: list[BucketResult] = []
    for bucket in config.buckets:
        exp_weight = math.exp(-bucket.maturity_years / config.x_years)
        base_rate, moex_index = interpolate_rate(bucket.maturity_years, nodes)
        result.append(
            BucketResult(
                number=bucket.number,
                label=bucket.label,
                maturity_years=bucket.maturity_years,
                exp_weight=exp_weight,
                long_weight=1.0 - exp_weight,
                moex_node_index=moex_index,
                floor_percent=_floor_percent(bucket.maturity_years, config),
                base_rate_percent=base_rate,
            )
        )
    return tuple(result)


def _scenario_shifts(bucket: BucketResult, config: IRRBBConfig) -> dict[str, float]:
    short_weight = bucket.exp_weight
    long_weight = bucket.long_weight

    steepener = (
        -config.steepener_short_pp * short_weight
        + config.steepener_long_pp * long_weight
    )
    flattener = (
        config.flattener_short_pp * short_weight
        - config.flattener_long_pp * long_weight
    )
    short_rate = config.short_rate_shift_pp * short_weight

    return {
        "base": 0.0,
        "parallel_up": config.parallel_shift_pp,
        "parallel_down": -config.parallel_shift_pp,
        "steepener": steepener,
        "flattener": flattener,
        "short_rate_up": short_rate,
        "short_rate_down": -short_rate,
    }


def _apply_stress(
    base_rate_percent: float,
    shift_pp: float,
    floor_percent: float,
    config: IRRBBConfig,
) -> float:
    stressed = base_rate_percent + shift_pp
    if config.apply_floor_to_negative_shifts and shift_pp < 0:
        lower_bound = min(base_rate_percent, floor_percent)
        stressed = max(stressed, lower_bound)
    return stressed


def build_analysis(
    as_of: date,
    nodes: Sequence[CurveNode],
    config: IRRBBConfig,
) -> CurveAnalysis:
    """Build bucket data and all seven scenario curves for one business date."""
    ordered_nodes = _validate_nodes(nodes)
    buckets = _build_buckets(ordered_nodes, config)

    scenario_names = (
        "base",
        "parallel_up",
        "parallel_down",
        "steepener",
        "flattener",
        "short_rate_up",
        "short_rate_down",
    )
    scenarios: list[ScenarioResult] = []
    for name in scenario_names:
        points: list[ScenarioPoint] = []
        for bucket in buckets:
            shift = _scenario_shifts(bucket, config)[name]
            stressed_rate = _apply_stress(
                bucket.base_rate_percent,
                shift,
                bucket.floor_percent,
                config,
            )
            points.append(
                ScenarioPoint(
                    bucket_number=bucket.number,
                    bucket_label=bucket.label,
                    shift_pp=shift,
                    stressed_rate_percent=stressed_rate,
                )
            )
        scenarios.append(ScenarioResult(name=name, points=tuple(points)))

    return CurveAnalysis(
        as_of=as_of,
        x_years=config.x_years,
        source_node_count=len(ordered_nodes),
        buckets=buckets,
        scenarios=tuple(scenarios),
    )
