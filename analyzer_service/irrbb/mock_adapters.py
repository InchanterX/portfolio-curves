"""Temporary adapters for local development and contract testing."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Mapping, Sequence

from .domain import CurveAnalysis, CurveNode


class MockCurveDataAdapter:
    """Return supplied test curves or a deterministic illustrative curve."""

    def __init__(
        self,
        curves: Mapping[date, Sequence[CurveNode]] | None = None,
        default_nodes: Sequence[CurveNode] | None = None,
    ) -> None:
        self._curves = dict(curves or {})
        self._default_nodes = tuple(default_nodes or self._demo_curve())

    def get_curve(self, as_of: date) -> Sequence[CurveNode]:
        if as_of in self._curves:
            return self._curves[as_of]
        if self._default_nodes:
            return self._default_nodes
        raise KeyError(f"No mock curve configured for {as_of.isoformat()}")

    @staticmethod
    def _demo_curve() -> tuple[CurveNode, ...]:
        # Illustrative values only. Replace with records returned by the MOEX adapter.
        rows = (
            (1 / 365, 15.80),
            (1 / 12, 15.70),
            (0.25, 15.45),
            (0.50, 15.10),
            (0.75, 14.80),
            (1.0, 14.45),
            (1.5, 14.00),
            (2.0, 13.65),
            (3.0, 13.20),
            (4.0, 12.95),
            (5.0, 12.80),
            (7.0, 12.75),
            (10.0, 12.90),
            (15.0, 13.10),
            (20.0, 13.20),
            (30.0, 13.25),
        )
        return tuple(
            CurveNode(maturity_years=tenor, rate_percent=rate, moex_index=index)
            for index, (tenor, rate) in enumerate(rows)
        )


class LocalJsonAnalysisRepository:
    """Local file adapter that persists analysis as JSON for the demo."""

    def __init__(self, output_dir: Path | str = Path("output/results")) -> None:
        self._output_dir = Path(output_dir)

    def save_analysis(self, analysis: CurveAnalysis) -> Sequence[str]:
        date_dir = self._output_dir / analysis.as_of.isoformat()
        date_dir.mkdir(parents=True, exist_ok=True)

        bucket_path = date_dir / "buckets.json"
        scenario_path = date_dir / "scenarios.json"
        analysis_path = date_dir / "analysis.json"

        bucket_payload = [asdict(bucket) for bucket in analysis.buckets]
        scenario_payload = [
            {
                "name": scenario.name,
                "points": [asdict(point) for point in scenario.points],
            }
            for scenario in analysis.scenarios
        ]
        analysis_payload = {
            "as_of": analysis.as_of.isoformat(),
            "x_years": analysis.x_years,
            "source_node_count": analysis.source_node_count,
            "buckets": bucket_payload,
            "scenarios": scenario_payload,
        }

        self._write_json(bucket_path, bucket_payload)
        self._write_json(scenario_path, scenario_payload)
        self._write_json(analysis_path, analysis_payload)
        return tuple(str(path) for path in (bucket_path, scenario_path, analysis_path))

    @staticmethod
    def _write_json(path: Path, payload: object) -> None:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )


class LocalChartStorageAdapter:
    """Local file adapter for rendered PNG charts."""

    def __init__(self, output_dir: Path | str = Path("output/charts")) -> None:
        self._output_dir = Path(output_dir)

    def save_chart(self, as_of: date, filename: str, image: bytes) -> str:
        date_dir = self._output_dir / as_of.isoformat()
        date_dir.mkdir(parents=True, exist_ok=True)
        path = date_dir / filename
        path.write_bytes(image)
        return str(path)
