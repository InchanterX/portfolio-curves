from datetime import date

import pytest

from irrbb.calculation import build_analysis, interpolate_rate
from irrbb.config import IRRBBConfig
from irrbb.domain import CurveNode
from irrbb.mock_adapters import (
    LocalChartStorageAdapter,
    LocalJsonAnalysisRepository,
    MockCurveDataAdapter,
)
from irrbb.service import IRRBBService


@pytest.fixtures

def simple_nodes() -> tuple[CurveNode, ...]:
    return (
        CurveNode(1.0, 10.0, 3),
        CurveNode(3.0, 14.0, 8),
        CurveNode(5.0, 15.0, 11),
    )


def test_interpolation_between_nodes(simple_nodes: tuple[CurveNode, ...]) -> None:
    rate, node_index = interpolate_rate(2.0, simple_nodes)
    assert rate == pytest.approx(12.0)
    assert node_index == 3  # lower-maturity node used for interpolation


def test_interpolation_clamps_to_nearest_endpoint(
    simple_nodes: tuple[CurveNode, ...],
) -> None:
    left_rate, left_index = interpolate_rate(0.25, simple_nodes)
    right_rate, right_index = interpolate_rate(20.0, simple_nodes)
    assert (left_rate, left_index) == (10.0, 3)
    assert (right_rate, right_index) == (15.0, 11)


def test_exact_node_returns_its_source_index(
    simple_nodes: tuple[CurveNode, ...],
) -> None:
    rate, node_index = interpolate_rate(3.0, simple_nodes)
    assert rate == 14.0
    assert node_index == 8


def test_bucket_weights_sum_to_one(simple_nodes: tuple[CurveNode, ...]) -> None:
    analysis = build_analysis(date(2026, 10, 30), simple_nodes, IRRBBConfig())
    for bucket in analysis.buckets:
        assert bucket.exp_weight + bucket.long_weight == pytest.approx(1.0)


def test_analysis_has_expected_buckets_and_scenarios(
    simple_nodes: tuple[CurveNode, ...],
) -> None:
    analysis = build_analysis(date(2026, 10, 30), simple_nodes, IRRBBConfig())
    assert len(analysis.buckets) == 18
    assert [item.name for item in analysis.scenarios] == [
        "base",
        "parallel_up",
        "parallel_down",
        "steepener",
        "flattener",
        "short_rate_up",
        "short_rate_down",
    ]
    assert all(len(scenario.points) == 18 for scenario in analysis.scenarios)


def test_negative_stress_respects_floor() -> None:
    config = IRRBBConfig()
    analysis = build_analysis(
        date(2026, 10, 30),
        (CurveNode(0.0, 1.0, 0), CurveNode(30.0, 1.0, 1)),
        config,
    )
    bucket = analysis.buckets[0]
    parallel_down = next(s for s in analysis.scenarios if s.name == "parallel_down")
    point = parallel_down.points[0]
    assert point.stressed_rate_percent >= min(
        bucket.base_rate_percent, bucket.floor_percent
    )
    assert point.stressed_rate_percent == pytest.approx(
        min(bucket.base_rate_percent, bucket.floor_percent)
    )


def test_service_persists_json_and_charts(tmp_path) -> None:
    service = IRRBBService(
        curve_data=MockCurveDataAdapter(),
        analysis_repository=LocalJsonAnalysisRepository(tmp_path / "results"),
        chart_storage=LocalChartStorageAdapter(tmp_path / "charts"),
        config=IRRBBConfig(),
    )
    execution = service.run(date(2026, 10, 30))

    assert len(execution.result_files) == 3
    assert len(execution.chart_files) == 2
    assert all((tmp_path / "results" / "2026-10-30").iterdir())
    assert all((tmp_path / "charts" / "2026-10-30").iterdir())
    assert all(path.endswith(".png") for path in execution.chart_files)
