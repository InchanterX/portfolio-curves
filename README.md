# IRRBB curve analysis

A small business-logic project for building 18 IRRBB maturity buckets, calculating
seven stress scenarios, rendering charts, and persisting daily JSON/PNG artifacts.
The MOEX parser and production API/database adapters are intentionally not included.

## Run

Python 3.10+ is required.

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python run_demo.py --as-of 2026-10-30
```

The demo uses illustrative mock curve nodes. It writes:

```text
output/
├── results/
│   └── YYYY-MM-DD/
│       ├── buckets.json
│       ├── scenarios.json
│       └── analysis.json
└── charts/
    └── YYYY-MM-DD/
        ├── curve_scenarios.png
        └── scenario_shifts.png
```

Run tests with:

```bash
pytest -q
```

## Architecture

- `domain.py` — immutable domain models.
- `config.py` — bucket definitions and scenario parameters.
- `ports.py` — protocols for curve input and output persistence.
- `calculation.py` — interpolation, bucket and stress calculations.
- `service.py` — application/business orchestration; no MOEX or database details.
- `plotting.py` — pure chart rendering to PNG bytes; no file I/O.
- `api.py` — transport-independent facade for a future HTTP/RPC layer.
- `mock_adapters.py` — demo input and local JSON/PNG persistence adapters.

A future MOEX adapter should implement `CurveDataPort`. A database/object-storage
adapter should implement `AnalysisRepositoryPort` and `ChartStoragePort`.
The daily scheduler should call `IRRBBAPI.calculate(as_of)`; scheduling is not
part of this package.

## Calculation conventions implemented

1. The configured 18 maturities are used as the x-axis buckets.
2. G-curve rates are linearly interpolated between source nodes. Outside the
   source-node range, the nearest endpoint rate is used.
3. For an interpolated bucket, `moex_node_index` is the source index of the
   lower-maturity node. At an exact node or outside the range, it is the exact
   or nearest endpoint index, respectively.
4. `exp_weight = exp(-t / x)` and `long_weight = 1 - exp_weight`; default `x=4`.
5. The floor is `min(0, -1.5 + 0.03 * t)` percent.
6. For a negative bucket-level shift, the stressed rate is
   `max(base + shift, min(base, floor))`. Positive and zero shifts are not
   floor-adjusted.
7. Parallel shifts default to +/-4 p.p.; short-rate shifts default to +/-5 p.p.
   multiplied by `exp(-t/x)`.

## Important assumptions to reconcile with the Excel workbook

The original Excel workbook was not attached to the request. Therefore the
following steepener/flattener amplitudes are provisional configuration values,
not verified Excel parameters:

- Steepener: short leg = 4 p.p., long leg = 4 p.p.
- Flattener: short leg = 4 p.p., long leg = 4 p.p.

Change them in `IRRBBConfig` after checking the workbook. The formulas implemented
are:

```text
steepener = -steepener_short_pp * exp(-t/x)
             + steepener_long_pp * (1 - exp(-t/x))

flattener =  flattener_short_pp * exp(-t/x)
             - flattener_long_pp * (1 - exp(-t/x))
```

The `MOEX index` convention is also made explicit: for interpolated values it
stores the left-hand source node index. If the Excel column instead means the
right-hand node, nearest node, or a one-based row number, adjust this mapping in
`calculation.py` or normalize indices in the MOEX adapter.

## Output units

Rates, floor and stress curve values are in percent. Scenario shifts are in
percentage points (p.p.), matching the supplied specification. The demo curve
is illustrative and must not be used for bank valuation or risk reporting.
