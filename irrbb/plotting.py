"""Chart rendering. Functions return PNG bytes and do not perform file I/O."""

from __future__ import annotations

from io import BytesIO
from typing import Mapping

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from .domain import CurveAnalysis


_SCENARIO_LABELS = {
    "base": "Base",
    "parallel_up": "Parallel up",
    "parallel_down": "Parallel down",
    "steepener": "Steepener",
    "flattener": "Flattener",
    "short_rate_up": "Short rate up",
    "short_rate_down": "Short rate down",
}


def _to_png_bytes(figure: plt.Figure) -> bytes:
    buffer = BytesIO()
    figure.savefig(buffer, format="png", dpi=160, bbox_inches="tight")
    plt.close(figure)
    return buffer.getvalue()


def render_curve_chart(analysis: CurveAnalysis) -> bytes:
    """Render base G-curve together with all stress curves."""
    labels = [bucket.label for bucket in analysis.buckets]
    positions = list(range(len(labels)))

    fig, ax = plt.subplots(figsize=(14, 7))
    for scenario in analysis.scenarios:
        values = [point.stressed_rate_percent for point in scenario.points]
        is_base = scenario.name == "base"
        ax.plot(
            positions,
            values,
            marker="o",
            markersize=4,
            linewidth=2.8 if is_base else 1.7,
            linestyle="-" if is_base else "--",
            label=_SCENARIO_LABELS.get(scenario.name, scenario.name),
            zorder=3 if is_base else 2,
        )

    ax.set_title(f"G-curve and stress scenarios — {analysis.as_of.isoformat()}")
    ax.set_xlabel("Bucket")
    ax.set_ylabel("Rate, %")
    ax.set_xticks(positions, labels, rotation=35, ha="right")
    ax.grid(True, which="major", linestyle=":", alpha=0.65)
    ax.legend(ncol=2, frameon=False)
    fig.tight_layout()
    return _to_png_bytes(fig)


def render_shift_chart(analysis: CurveAnalysis) -> bytes:
    """Render bucket-level scenario shifts in percentage points."""
    labels = [bucket.label for bucket in analysis.buckets]
    positions = list(range(len(labels)))

    fig, ax = plt.subplots(figsize=(14, 6))
    for scenario in analysis.scenarios:
        if scenario.name == "base":
            continue
        values = [point.shift_pp for point in scenario.points]
        ax.plot(
            positions,
            values,
            marker="o",
            markersize=3.5,
            linewidth=1.7,
            label=_SCENARIO_LABELS.get(scenario.name, scenario.name),
        )

    ax.axhline(0.0, linewidth=1.0, linestyle="-", alpha=0.8)
    ax.set_title(f"Scenario shifts — {analysis.as_of.isoformat()}")
    ax.set_xlabel("Bucket")
    ax.set_ylabel("Shift, p.p.")
    ax.set_xticks(positions, labels, rotation=35, ha="right")
    ax.grid(True, which="major", linestyle=":", alpha=0.65)
    ax.legend(ncol=3, frameon=False)
    fig.tight_layout()
    return _to_png_bytes(fig)


def render_all_charts(analysis: CurveAnalysis) -> Mapping[str, bytes]:
    return {
        "curve_scenarios.png": render_curve_chart(analysis),
        "scenario_shifts.png": render_shift_chart(analysis),
    }
