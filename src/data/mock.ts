/**
 * Демонстрационные данные фронтенда.
 * Поля и имена согласованы с irrbb_schema.sql (см. «IRRBB: колонки БД для фронтенда»):
 * даты-время приходят как ISO (UTC), деньги — числа, форматирование только в UI.
 * Финансовые значения в реальной системе отдаёт Calculator; здесь — моки из макета.
 */

export interface Tenor {
  code: string;
  label: string;
  years: number;
  daysToMaturity: number;
  sortOrder: number;
}

export interface CurvePoint {
  tenorCode: string;
  daysToMaturity: number | null;
  yieldPct: number | null;
  changePp: number | null;
  isMissing: boolean;
}

export interface YieldCurve {
  id: string;
  curveDate: string; // date
  sourceCode: string;
  revision: number;
  isCurrent: boolean;
  status: 'ok' | 'partial' | 'stale' | 'error';
  fetchedAt: string; // timestamptz
  points: CurvePoint[];
}

export interface Instrument {
  id: string;
  instrumentCode: string; // ISIN
  name: string;
  instrumentTypeCode: 'ofz' | 'municipal' | 'corporate' | 'deposit';
  nominalRub: number;
  interestRatePct: number | null;
  maturityDate: string | null;
  status: 'active' | 'matured' | 'excluded';
  marketPricePct: number | null;
  accruedCouponRub: number | null;
}

export interface Portfolio {
  id: string;
  name: string;
  currency: 'RUB';
  version: number;
  instruments: Instrument[];
  updatedAt: string;
}

export interface ScenarioShock {
  tenorCode: string;
  shockBps: number;
}

export interface Scenario {
  id: string;
  externalId: string;
  version: number;
  name: string;
  scenarioTypeCode: 'parallel' | 'twist' | 'curvature';
  description: string | null;
  approvalStatus: 'approved' | 'deprecated';
  isMandatory: boolean;
  shocks: ScenarioShock[];
}

export interface CalculationScenarioResult {
  scenarioId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  npvMln: number | null;
  deltaNpvMln: number | null;
  deltaNiiMln: number | null;
  economicCapitalMln: number | null;
  errorMessage: string | null;
}

export interface Calculation {
  id: string;
  number: string;
  portfolioId: string;
  portfolioVersion: number;
  portfolioInstrumentCount: number;
  valuationDate: string;
  baseCurveId: string;
  initiatedBy: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  methodologyVersion: string | null;
  baseNpvMln: number | null;
  baseNiiMln: number | null;
  scenarios: CalculationScenarioResult[];
  summary: {
    ecIrrbbMln: number | null;
    worstScenarioId: string | null;
    scenariosTotal: number;
    scenariosSucceeded: number;
    scenariosFailed: number;
    isFinal: boolean;
    calculatedAt: string;
  } | null;
}

export interface InstrumentContribution {
  instrumentCode: string;
  name: string;
  nominalRub: number;
  baseNpvMln: number | null;
  scenarioNpvMln: number | null;
  deltaNpvMln: number | null;
  deltaNiiMln: number | null;
  /** вклад позиции в совокупное изменение NPV, % */
  sharePct: number;
}

export interface LlmAnalysis {
  calculationId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'unavailable';
  analysisText: string | null;
  model: string | null;
  generatedAt: string | null;
  factors: { title: string; detail: string }[];
}

export interface DataSourceStatus {
  sourceCode: string;
  name: string;
  status: 'connected' | 'no_connection' | 'stale' | 'error';
  detail: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}

export interface AppUser {
  id: string;
  fullName: string;
  email: string;
  roleCode: 'admin' | 'analyst' | 'viewer';
  isActive: boolean;
  lastLoginAt: string | null;
}

/* ---------------- tenors ---------------- */

export const TENORS: Tenor[] = [
  { code: '3M', label: '3 мес', years: 0.25, daysToMaturity: 91, sortOrder: 1 },
  { code: '6M', label: '6 мес', years: 0.5, daysToMaturity: 182, sortOrder: 2 },
  { code: '1Y', label: '1 год', years: 1, daysToMaturity: 365, sortOrder: 3 },
  { code: '2Y', label: '2 года', years: 2, daysToMaturity: 730, sortOrder: 4 },
  { code: '3Y', label: '3 года', years: 3, daysToMaturity: 1095, sortOrder: 5 },
  { code: '5Y', label: '5 лет', years: 5, daysToMaturity: 1825, sortOrder: 6 },
  { code: '7Y', label: '7 лет', years: 7, daysToMaturity: 2555, sortOrder: 7 },
  { code: '10Y', label: '10 лет', years: 10, daysToMaturity: 3650, sortOrder: 8 },
  { code: '15Y', label: '15 лет', years: 15, daysToMaturity: 5475, sortOrder: 9 },
  { code: '20Y', label: '20 лет', years: 20, daysToMaturity: 7300, sortOrder: 10 },
  { code: '30Y', label: '30 лет', years: 30, daysToMaturity: 10950, sortOrder: 11 },
];

/* ---------------- yield curves ---------------- */

function curve(
  id: string,
  curveDate: string,
  fetchedAt: string,
  yields: (number | null)[],
  changes: (number | null)[],
): YieldCurve {
  return {
    id,
    curveDate,
    sourceCode: 'moex',
    revision: 1,
    isCurrent: true,
    status: 'ok',
    fetchedAt,
    points: TENORS.map((t, i) => ({
      tenorCode: t.code,
      daysToMaturity: t.daysToMaturity,
      yieldPct: yields[i],
      changePp: changes[i],
      isMissing: yields[i] === null,
    })),
  };
}

/** 29.10.2026 — текущая кривая из макета */
export const CURVE_CURRENT = curve(
  'crv-2910',
  '2026-10-29',
  '2026-10-29T15:42:00Z',
  [13.16, 13.55, 14.04, 14.62, 15.05, 16.07, 15.85, 16.52, 16.28, 16.44, 16.36],
  [0.32, 0.15, 0.07, 0.12, 0.05, 0.0, 0.1, 0.16, 0.11, 0.09, 0.14],
);

/** 28.10.2026 — предыдущий день для сравнения */
export const CURVE_PREVIOUS = curve(
  'crv-2810',
  '2026-10-28',
  '2026-10-28T15:40:00Z',
  [12.84, 13.4, 13.97, 14.5, 15.0, 16.07, 15.75, 16.36, 16.17, 16.35, 16.22],
  [0.1, -0.05, 0.02, 0.0, 0.08, -0.03, 0.04, -0.02, 0.0, 0.05, 0.01],
);

/** История кривых: несколько дат для графика */
export const CURVE_HISTORY: { date: string; yields: number[] }[] = [
  { date: '2026-10-20', yields: [12.9, 13.3, 13.8, 14.3, 14.8, 15.9, 15.6, 16.2, 16.0, 16.2, 16.1] },
  { date: '2026-10-22', yields: [13.0, 13.4, 13.9, 14.4, 14.9, 16.0, 15.7, 16.3, 16.1, 16.3, 16.2] },
  { date: '2026-10-23', yields: [13.05, 13.45, 13.95, 14.5, 15.0, 16.05, 15.72, 16.38, 16.15, 16.34, 16.2] },
  { date: '2026-10-26', yields: [12.95, 13.42, 13.92, 14.48, 14.96, 16.04, 15.74, 16.34, 16.14, 16.3, 16.18] },
  { date: '2026-10-27', yields: [12.8, 13.38, 13.9, 14.45, 14.95, 16.02, 15.72, 16.3, 16.12, 16.28, 16.15] },
  { date: '2026-10-28', yields: [12.84, 13.4, 13.97, 14.5, 15.0, 16.07, 15.75, 16.36, 16.17, 16.35, 16.22] },
  { date: '2026-10-29', yields: [13.16, 13.55, 14.04, 14.62, 15.05, 16.07, 15.85, 16.52, 16.28, 16.44, 16.36] },
];

/* ---------------- portfolios & instruments ---------------- */

function instrument(
  id: string,
  code: string,
  name: string,
  type: Instrument['instrumentTypeCode'],
  nominal: number,
  rate: number | null,
  maturity: string | null,
  pricePct: number | null = null,
  nkd: number | null = null,
): Instrument {
  return {
    id,
    instrumentCode: code,
    name,
    instrumentTypeCode: type,
    nominalRub: nominal,
    interestRatePct: rate,
    maturityDate: maturity,
    status: 'active',
    marketPricePct: pricePct,
    accruedCouponRub: nkd,
  };
}

export const PORTFOLIOS: Portfolio[] = [
  {
    id: 'pfz-main',
    name: 'ОФЗ · Основной',
    currency: 'RUB',
    version: 17,
    updatedAt: '2026-10-29T14:10:00Z',
    instruments: [
      instrument('i1', 'RU000A1038V3', 'ОФЗ 26238', 'ofz', 7340000, 7.1, '2043-05-15', 57.1, 32.1),
      instrument('i2', 'RU000A101C78', 'ОФЗ 26240', 'ofz', 12384000, 6.9, '2042-07-21', 58.0, 12.4),
      instrument('i3', 'RU000A101K89', 'ОФЗ 26243', 'ofz', 21410900, 7.0, '2038-05-05', 63.64, 28.9),
      instrument('i4', 'RU000A102EJ9', 'ОФЗ 26244', 'ofz', 27906000, 6.7, '2036-03-06', 61.2, 19.55),
      instrument('i5', 'RU000A103TW1', 'ОФЗ 26246', 'ofz', 21087000, 6.4, '2034-02-15', 59.35, 41.2),
      instrument('i6', 'RU000A0ZYCK8', 'ОФЗ 26212', 'ofz', 28106300, 7.25, '2028-09-27', 96.8, 8.15),
      instrument('i7', 'RU000A0JWSQ7', 'ОФЗ 25083', 'ofz', 15600000, 6.5, '2031-12-15', 74.2, 22.3),
      instrument('i8', 'RU000A103A56', 'ОФЗ 26247', 'ofz', 18920000, 6.8, '2035-06-26', 64.9, 5.6),
    ],
  },
  {
    id: 'pfz-cash',
    name: 'Денежные позиции',
    currency: 'RUB',
    version: 9,
    updatedAt: '2026-10-28T09:30:00Z',
    instruments: [
      instrument('c1', 'DEP-001', 'Депозит до востребования', 'deposit', 18200000, 0.1, null, null, null),
      instrument('c2', 'DEP-014', 'Межбанковский депозит 3М', 'deposit', 15400000, 15.6, '2027-01-28', null, null),
      instrument('c3', 'DEP-021', 'Межбанковский депозит 6М', 'deposit', 12600000, 15.85, '2027-04-28', null, null),
      instrument('c4', 'CORP-77', 'Коммерческий вексель', 'corporate', 9000000, 16.2, '2026-12-20', null, null),
    ],
  },
  {
    id: 'pfz-mun',
    name: 'Денежные облигации',
    currency: 'RUB',
    version: 5,
    updatedAt: '2026-10-27T11:00:00Z',
    instruments: [
      instrument('m1', 'RU000A105A01', 'МОБЛ 1-об', 'municipal', 11200000, 14.5, '2030-03-12', 78.4, 55.0),
      instrument('m2', 'RU000A104B12', 'МОБЛ 2-об', 'municipal', 9400000, 15.1, '2031-07-30', 74.9, 61.2),
      instrument('m3', 'RU000A103C23', 'МОБЛ 3-об', 'municipal', 13300000, 15.6, '2029-11-15', 81.3, 12.8),
      instrument('m4', 'RU000A102D34', 'МОБЛ 4-об', 'municipal', 7200000, 16.0, '2032-01-25', 70.2, 44.15),
    ],
  },
];

/* ---------------- scenarios ---------------- */

export const SCENARIOS: Scenario[] = [
  {
    id: 'sc-par-p100',
    externalId: 'parallel_plus_100',
    version: 3,
    name: 'Параллельный +100 б.п.',
    scenarioTypeCode: 'parallel',
    description:
      'Одинаковый сдвиг всех сроков кривой вверх на 100 базисных пунктов. Базовый стресс роста ставок.',
    approvalStatus: 'approved',
    isMandatory: true,
    shocks: TENORS.map((t) => ({ tenorCode: t.code, shockBps: 100 })),
  },
  {
    id: 'sc-par-m100',
    externalId: 'parallel_minus_100',
    version: 2,
    name: 'Параллельный −100 б.п.',
    scenarioTypeCode: 'parallel',
    description: 'Одинаковый сдвиг всех сроков кривой вниз на 100 базисных пунктов.',
    approvalStatus: 'approved',
    isMandatory: true,
    shocks: TENORS.map((t) => ({ tenorCode: t.code, shockBps: -100 })),
  },
  {
    id: 'sc-twist',
    externalId: 'twist_50',
    version: 4,
    name: 'Разворот наклона (Twist +50/−50)',
    scenarioTypeCode: 'twist',
    description:
      'Короткие сроки растут, длинные падают: сдвиг короткого конца вверх на +50 б.п., длинного вниз на −50 б.п.',
    approvalStatus: 'approved',
    isMandatory: true,
    shocks: TENORS.map((t) => ({
      tenorCode: t.code,
      shockBps: t.years <= 3 ? 50 : -50,
    })),
  },
  {
    id: 'sc-curv',
    externalId: 'curvature_50',
    version: 2,
    name: 'Изгиб (Curvature +50 б.п.)',
    scenarioTypeCode: 'curvature',
    description:
      'Увеличение кривизны: средние сроки сдвигаются сильнее коротких и длинных (пик на 3–5 годах).',
    approvalStatus: 'approved',
    isMandatory: true,
    shocks: TENORS.map((t) => {
      const bump = Math.exp(-Math.pow((t.years - 4) / 2.2, 2));
      return { tenorCode: t.code, shockBps: Math.round(50 * bump) };
    }),
  },
];

/* ---------------- calculation ---------------- */

export const CALCULATION: Calculation = {
  id: 'calc-0248',
  number: '0248',
  portfolioId: 'pfz-main',
  portfolioVersion: 17,
  portfolioInstrumentCount: 24,
  valuationDate: '2026-10-29',
  baseCurveId: 'crv-2910',
  initiatedBy: 'Соня Иванова',
  status: 'completed',
  requestedAt: '2026-10-29T15:44:00Z',
  startedAt: '2026-10-29T15:44:03Z',
  finishedAt: '2026-10-29T15:44:41Z',
  durationMs: 38200,
  methodologyVersion: 'IRRBB-METH-1.1',
  baseNpvMln: 128.4,
  baseNiiMln: 9.84,
  scenarios: [
    {
      scenarioId: 'sc-par-p100',
      status: 'succeeded',
      npvMln: 125.94,
      deltaNpvMln: -2.46,
      deltaNiiMln: -1.12,
      economicCapitalMln: -2.46,
      errorMessage: null,
    },
    {
      scenarioId: 'sc-twist',
      status: 'succeeded',
      npvMln: 128.91,
      deltaNpvMln: 0.51,
      deltaNiiMln: 0.34,
      economicCapitalMln: 0.51,
      errorMessage: null,
    },
    {
      scenarioId: 'sc-curv',
      status: 'succeeded',
      npvMln: 127.63,
      deltaNpvMln: -0.77,
      deltaNiiMln: -0.42,
      economicCapitalMln: -0.77,
      errorMessage: null,
    },
  ],
  summary: {
    ecIrrbbMln: -2.46,
    worstScenarioId: 'sc-par-p100',
    scenariosTotal: 3,
    scenariosSucceeded: 3,
    scenariosFailed: 0,
    isFinal: true,
    calculatedAt: '2026-10-29T15:44:41Z',
  },
};

export const CONTRIBUTIONS: InstrumentContribution[] = [
  {
    instrumentCode: 'RU000A1038V3',
    name: 'ОФЗ 26238',
    nominalRub: 7340000,
    baseNpvMln: 4.19,
    scenarioNpvMln: 3.79,
    deltaNpvMln: -0.4,
    deltaNiiMln: -0.19,
    sharePct: 23.5,
  },
  {
    instrumentCode: 'RU000A101K89',
    name: 'ОФЗ 26243',
    nominalRub: 21410900,
    baseNpvMln: 13.63,
    scenarioNpvMln: 13.32,
    deltaNpvMln: -0.31,
    deltaNiiMln: -0.14,
    sharePct: 18.4,
  },
  {
    instrumentCode: 'RU000A102EJ9',
    name: 'ОФЗ 26244',
    nominalRub: 27906000,
    baseNpvMln: 17.08,
    scenarioNpvMln: 16.85,
    deltaNpvMln: -0.23,
    deltaNiiMln: -0.1,
    sharePct: 13.6,
  },
  {
    instrumentCode: 'RU000A103TW1',
    name: 'ОФЗ 26246',
    nominalRub: 21087000,
    baseNpvMln: 12.54,
    scenarioNpvMln: 12.38,
    deltaNpvMln: -0.16,
    deltaNiiMln: -0.07,
    sharePct: 9.5,
  },
  {
    instrumentCode: 'RU000A101C78',
    name: 'ОФЗ 26240',
    nominalRub: 12384000,
    baseNpvMln: 7.18,
    scenarioNpvMln: 7.13,
    deltaNpvMln: -0.05,
    deltaNiiMln: -0.02,
    sharePct: 3.0,
  },
];

/** Совокупный вклад позиций, свёрнутых в строку «Другие позиции» (19 шт.) */
export const OTHER_POSITIONS = {
  count: 19,
  nominalRub: 53007000,
  baseNpvMln: 73.78,
  scenarioNpvMln: 72.99,
  deltaNpvMln: -0.79,
  sharePct: 32.0,
};

export const NPV_IMPACT_ROWS = [
  { shockBps: -100, deltaRub: 574676 },
  { shockBps: -50, deltaRub: 287338 },
  { shockBps: 50, deltaRub: -287338 },
  { shockBps: 100, deltaRub: -574676 },
];

/* ---------------- LLM ---------------- */

export const LLM_ANALYSIS: LlmAnalysis = {
  calculationId: 'calc-0248',
  status: 'succeeded',
  model: 'gcurve-llm-2',
  generatedAt: '2026-10-29T15:46:12Z',
  analysisText:
    'Портфель чувствителен к параллельному росту ставок: при сдвиге +100 б.п. NPV снижается на 1,92 %. Ключевой вклад вносит длинный конец портфеля. Сценарий Twist положителен для оценки, изгиб кривой даёт умеренное снижение.',
  factors: [
    {
      title: 'Основной риск — рост ставок',
      detail:
        'Parallel +100 б.п. снижает NPV на 1,92 %. Это системный риск всей позиции: длинные ОФЗ реагируют сильнее всего.',
    },
    {
      title: 'ОФЗ 26238 вносит вклад −2,3 % совокупного изменения',
      detail:
        'Наибольший вклад в снижение NPV даёт выпуск с максимальной дюрацией. Проверьте лимит концентрации по нему.',
    },
    {
      title: 'Изменение формы кривой',
      detail:
        'Twist (разворот наклона) повышает NPV на 0,40 %, Curvature снижает на 0,60 %. Портфель защищён от плоского разворота хуже, чем от изгиба.',
    },
    {
      title: 'На что обратить внимание',
      detail:
        'Пересмотрите допущения по ликвидности длинных выпусков и срокам рефинансирования при скачке ставок.',
    },
  ],
};

/* ---------------- sources ---------------- */

export const SOURCES: DataSourceStatus[] = [
  {
    sourceCode: 'cbr',
    name: 'Банк России',
    status: 'connected',
    detail: 'Бескупонная кривая ОФЗ · 11 точек',
    lastSuccessAt: '2026-10-29T15:42:00Z',
    lastErrorAt: null,
  },
  {
    sourceCode: 'moex',
    name: 'Московская биржа',
    status: 'connected',
    detail: 'Котировки и параметры инструментов',
    lastSuccessAt: '2026-10-29T15:40:00Z',
    lastErrorAt: null,
  },
  {
    sourceCode: 'calculator',
    name: 'Calculator',
    status: 'connected',
    detail: 'Расчёт NPV, NII и ЭКпрбк',
    lastSuccessAt: '2026-10-29T15:44:41Z',
    lastErrorAt: null,
  },
  {
    sourceCode: 'llm',
    name: 'LLM Analytics',
    status: 'stale',
    detail: 'Последнее обращение более суток назад',
    lastSuccessAt: '2026-10-28T08:15:00Z',
    lastErrorAt: null,
  },
];

/* ---------------- users ---------------- */

export const USERS: AppUser[] = [
  {
    id: 'u1',
    fullName: 'Соня Иванова',
    email: 'sonya@company.ru',
    roleCode: 'admin',
    isActive: true,
    lastLoginAt: '2026-10-29T14:02:00Z',
  },
  {
    id: 'u2',
    fullName: 'Марк Орлов',
    email: 'm.orlov@company.ru',
    roleCode: 'analyst',
    isActive: true,
    lastLoginAt: '2026-10-29T09:41:00Z',
  },
  {
    id: 'u3',
    fullName: 'Алина Соколова',
    email: 'a.sokolova@company.ru',
    roleCode: 'analyst',
    isActive: true,
    lastLoginAt: '2026-10-27T16:20:00Z',
  },
  {
    id: 'u4',
    fullName: 'Пётр Васильев',
    email: 'p.vasilyev@company.ru',
    roleCode: 'viewer',
    isActive: false,
    lastLoginAt: null,
  },
];

/* ---------------- misc ---------------- */

export const CURRENCIES = [{ code: 'RUB', label: 'Российский рубль · ₽' }];

export const INSTRUMENT_TYPE_LABELS: Record<Instrument['instrumentTypeCode'], string> = {
  ofz: 'ОФЗ',
  municipal: 'Муниципальная облигация',
  corporate: 'Корпоративная облигация',
  deposit: 'Депозит',
};

export const ROLE_LABELS: Record<AppUser['roleCode'], string> = {
  admin: 'Администратор',
  analyst: 'Аналитик',
  viewer: 'Наблюдатель',
};

export const SOURCE_STATUS_LABELS: Record<DataSourceStatus['status'], string> = {
  connected: 'Подключено',
  no_connection: 'Нет соединения',
  stale: 'Данные устарели',
  error: 'Ошибка получения данных',
};
