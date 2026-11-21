/**
 * Стресс-кривые IRRBB (BCBS 368) — порт логики сниппета irrbb_core
 * (metabase/irrbb_curves.sql, лист IRRBB в IRRBB_stress_curves.xlsx).
 * Та же математика: линейная интерполяция по узлам, сдвиги с затуханием
 * e^(−t/x), floor для шоков вниз. Проверено против Excel: 532 значения,
 * расхождение ≤ 6·10⁻¹³.
 */

/** 19 временных бакетов (Excel, строки 23–25) */
export const BUCKETS = [
  [1, 'до востр.', 0.0028],
  [2, '≤1м', 0.0417],
  [3, '1–3м', 0.1667],
  [4, '3–6м', 0.375],
  [5, '6–9м', 0.625],
  [6, '9–12м', 0.875],
  [7, '1–1,5г', 1.25],
  [8, '1,5–2г', 1.75],
  [9, '2–3г', 2.5],
  [10, '3–4г', 3.5],
  [11, '4–5г', 4.5],
  [12, '5–6г', 5.5],
  [13, '6–7г', 6.5],
  [14, '7–8г', 7.5],
  [15, '8–9г', 8.5],
  [16, '9–10г', 9.5],
  [17, '10–15г', 12.5],
  [18, '15–20г', 17.5],
  [19, '>20г', 25.0],
];

/** 7 сценариев (Excel, A55:A61) */
export const SCENARIOS = [
  [0, '0. Базовая кривая (без стресса)'],
  [1, '1. Параллельный сдвиг вверх (parallel up)'],
  [2, '2. Параллельный сдвиг вниз (parallel down)'],
  [3, '3. Steepener — короткие вниз, длинные вверх'],
  [4, '4. Flattener — короткие вверх, длинные вниз'],
  [5, '5. Рост краткосрочных ставок (short rate up)'],
  [6, '6. Снижение краткосрочных ставок (short rate down)'],
];

/** Параметры по умолчанию (Excel, B10:B20); NaN/undefined -> значение из Excel */
export function resolveParams(overrides = {}) {
  const num = (v, dflt) => {
    const n = Number(v);
    return v === undefined || v === null || v === '' || Number.isNaN(n) ? dflt : n;
  };
  return {
    rParallel: num(overrides.r_parallel, 4.0),
    rShort: num(overrides.r_short, 5.0),
    rLong: num(overrides.r_long, 3.0),
    decayX: num(overrides.decay_x, 4.0),
    steepShort: num(overrides.steep_short, 0.65),
    steepLong: num(overrides.steep_long, 0.9),
    flatShort: num(overrides.flat_short, 0.8),
    flatLong: num(overrides.flat_long, 0.6),
    floorOn: num(overrides.floor_on, 1),
    floorT0: num(overrides.floor_t0, -1.5),
    floorGrowth: num(overrides.floor_growth, 0.03),
  };
}

function shiftPp(scenarioNo, t, p) {
  const decay = Math.exp(-t / p.decayX);
  switch (scenarioNo) {
    case 0:
      return 0;
    case 1:
      return p.rParallel;
    case 2:
      return -p.rParallel;
    case 3:
      return -p.steepShort * p.rShort * decay + p.steepLong * p.rLong * (1 - decay);
    case 4:
      return p.flatShort * p.rShort * decay - p.flatLong * p.rLong * (1 - decay);
    case 5:
      return p.rShort * decay;
    case 6:
      return -p.rShort * decay;
    default:
      return 0;
  }
}

/**
 * Узлы: отсортированный массив { tenorYears, yieldPct }.
 * Возвращает строки { scenarioNo, scenarioName, bucketNo, bucketLabel, termYears,
 * basePct, pointType, shiftPp, floorPct, stressedPct } — 7 × 19.
 */
export function stressCurves(nodes, overrides = {}) {
  if (!nodes.length) return [];
  const p = resolveParams(overrides);
  const sorted = [...nodes].sort((a, b) => a.tenorYears - b.tenorYears);
  const tMin = sorted[0].tenorYears;
  const tMax = sorted[sorted.length - 1].tenorYears;
  const yFirst = sorted[0].yieldPct;
  const yLast = sorted[sorted.length - 1].yieldPct;

  const baseAt = (t) => {
    if (t <= tMin) return { base: yFirst, type: t < tMin ? 'ближайшее известное' : 'узел' };
    if (t >= tMax) return { base: yLast, type: t > tMax ? 'экстраполяция' : 'узел' };
    for (let i = 0; i < sorted.length - 1; i++) {
      const t0 = sorted[i].tenorYears;
      const t1 = sorted[i + 1].tenorYears;
      if (t >= t0 && t < t1) {
        const y0 = sorted[i].yieldPct;
        const y1 = sorted[i + 1].yieldPct;
        return { base: y0 + (y1 - y0) * (t - t0) / (t1 - t0), type: t === t0 ? 'узел' : 'интерполяция' };
      }
    }
    return { base: yLast, type: 'экстраполяция' };
  };

  const rows = [];
  for (const [scenarioNo, scenarioName] of SCENARIOS) {
    for (const [bucketNo, bucketLabel, termYears] of BUCKETS) {
      const { base, type } = baseAt(termYears);
      const shift = shiftPp(scenarioNo, termYears, p);
      const floorPct = p.floorOn === 1 ? Math.min(0, p.floorT0 + p.floorGrowth * termYears) : -999;
      const stressed =
        shift < 0 ? Math.max(base + shift, Math.min(base, floorPct)) : base + shift;
      rows.push({
        scenarioNo,
        scenarioName,
        bucketNo,
        bucketLabel,
        termYears,
        basePct: base,
        pointType: type,
        shiftPp: shift,
        shiftBp: shift * 100,
        floorPct,
        stressedPct: stressed,
      });
    }
  }
  return rows;
}

/** Сводка «История за полгода» (вопрос 2): одна строка на дату и сценарий. */
export function stressSummary(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.scenarioNo}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        scenarioNo: r.scenarioNo,
        scenarioName: r.scenarioName,
        shiftShortBp: null,
        shiftLongBp: null,
        maxAbsShiftBp: 0,
        minRatePct: Infinity,
        maxRatePct: -Infinity,
        shortEndPct: null,
        longEndPct: null,
      });
    }
    const acc = byKey.get(key);
    acc.maxAbsShiftBp = Math.max(acc.maxAbsShiftBp, Math.abs(r.shiftBp));
    acc.minRatePct = Math.min(acc.minRatePct, r.stressedPct);
    acc.maxRatePct = Math.max(acc.maxRatePct, r.stressedPct);
    if (r.bucketNo === 1) {
      acc.shiftShortBp = r.shiftBp;
      acc.shortEndPct = r.stressedPct;
    }
    if (r.bucketNo === 19) {
      acc.shiftLongBp = r.shiftBp;
      acc.longEndPct = r.stressedPct;
    }
  }
  return [...byKey.values()].map((a) => ({
    ...a,
    minRatePct: a.minRatePct === Infinity ? null : a.minRatePct,
    maxRatePct: a.maxRatePct === -Infinity ? null : a.maxRatePct,
    slopePp: a.shortEndPct !== null && a.longEndPct !== null ? a.longEndPct - a.shortEndPct : null,
  }));
}
