"""Run the IRRBB demo using the temporary mock/local adapters."""

from __future__ import annotations

import argparse
from datetime import date

from irrbb.api import IRRBBAPI
from irrbb.config import IRRBBConfig
from irrbb.mock_adapters import (
    LocalChartStorageAdapter,
    LocalJsonAnalysisRepository,
    MockCurveDataAdapter,
)
from irrbb.service import IRRBBService


def main() -> None:
    parser = argparse.ArgumentParser(description="Build IRRBB buckets and stress curves")
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=date.today(),
        help="Business date in YYYY-MM-DD format (default: today)",
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Root folder for results and charts (default: output)",
    )
    args = parser.parse_args()

    output_dir = args.output_dir
    service = IRRBBService(
        curve_data=MockCurveDataAdapter(),
        analysis_repository=LocalJsonAnalysisRepository(f"{output_dir}/results"),
        chart_storage=LocalChartStorageAdapter(f"{output_dir}/charts"),
        config=IRRBBConfig(),
    )
    api = IRRBBAPI(service)
    execution = api.calculate(args.as_of)

    print(f"Analysis date: {execution.analysis.as_of.isoformat()}")
    print(f"Buckets: {len(execution.analysis.buckets)}")
    print(f"Scenarios: {len(execution.analysis.scenarios)}")
    print("Result files:")
    for path in execution.result_files:
        print(f"  {path}")
    print("Charts:")
    for path in execution.chart_files:
        print(f"  {path}")


if __name__ == "__main__":
    main()
