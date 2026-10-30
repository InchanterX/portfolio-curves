"""Protocols (ports) that isolate business logic from data and persistence."""

from __future__ import annotations

from datetime import date
from typing import Protocol, Sequence

from .domain import CurveAnalysis, CurveNode


class CurveDataPort(Protocol):
    def get_curve(self, as_of: date) -> Sequence[CurveNode]:
        """Return source curve nodes available for the requested business date."""
        ...


class AnalysisRepositoryPort(Protocol):
    def save_analysis(self, analysis: CurveAnalysis) -> Sequence[str]:
        """Persist calculated bucket and scenario data; return saved resource IDs."""
        ...


class ChartStoragePort(Protocol):
    def save_chart(self, as_of: date, filename: str, image: bytes) -> str:
        """Persist a rendered chart and return its resource ID or URI."""
        ...
