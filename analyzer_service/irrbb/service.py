"""Application/business service. It depends only on ports and domain logic."""

from __future__ import annotations

from datetime import date

from .calculation import build_analysis
from .config import IRRBBConfig
from .domain import AnalysisExecution
from .plotting import render_all_charts
from .ports import AnalysisRepositoryPort, ChartStoragePort, CurveDataPort


class IRRBBService:
    def __init__(
        self,
        curve_data: CurveDataPort,
        analysis_repository: AnalysisRepositoryPort,
        chart_storage: ChartStoragePort,
        config: IRRBBConfig | None = None,
    ) -> None:
        self._curve_data = curve_data
        self._analysis_repository = analysis_repository
        self._chart_storage = chart_storage
        self._config = config or IRRBBConfig()

    def run(self, as_of: date) -> AnalysisExecution:
        """Fetch, calculate, render and persist analysis for `as_of`.

        Scheduling is deliberately outside this service. The caller is
        responsible for choosing the business date and invoking this method.
        """
        source_nodes = self._curve_data.get_curve(as_of)
        analysis = build_analysis(as_of, source_nodes, self._config)

        result_files = tuple(self._analysis_repository.save_analysis(analysis))
        charts = render_all_charts(analysis)
        chart_files = tuple(
            self._chart_storage.save_chart(as_of, filename, content)
            for filename, content in charts.items()
        )
        return AnalysisExecution(
            analysis=analysis,
            result_files=result_files,
            chart_files=chart_files,
        )
