-- =====================================================================
-- IRRBB: кривые доходности ОФЗ под стресс-сценариями (BCBS 368)
-- Логика 1-в-1 повторяет лист IRRBB в IRRBB_stress_curves.xlsx.
-- Диалект: PostgreSQL. Для других СУБД см. примечания в конце файла.
--
-- ПРЕДПОЛОЖЕНИЕ О СХЕМЕ (замените на свою):
--   public.gcurve_nodes(as_of_date date, tenor_years numeric, yield_pct numeric)
--   одна строка = один узел G-curve на одну дату; пара (as_of_date, tenor_years) уникальна.
--
-- КАК ПОДКЛЮЧИТЬ В METABASE
--   1. Блок "SNIPPET irrbb_core" сохраните как сниппет с именем  irrbb_core.
--   2. Блок "ВОПРОС 1" -> новый SQL-вопрос  «IRRBB: кривые на дату».
--   3. Блок "ВОПРОС 2" -> новый SQL-вопрос  «IRRBB: история за полгода».
--   4. В боковой панели Variables у обоих вопросов:
--        as_of           -> тип Date (по умолчанию пусто = последняя доступная дата)
--        r_parallel ... floor_growth -> тип Number, значения по умолчанию не нужны
--        (если поле пустое, подставляется значение из Excel, см. блок params).
-- =====================================================================


-- =====================================================================
-- SNIPPET irrbb_core   (всё, что между линиями; без завершающего SELECT)
-- =====================================================================
WITH
-- Параметры сценариев. Пустая переменная -> значение по умолчанию (как в Excel, B10:B20).
params AS (
  SELECT
    COALESCE(NULL [[, {{r_parallel}}]],   4.0)   AS r_parallel,    -- B10  параллельный сдвиг, п.п.
    COALESCE(NULL [[, {{r_short}}]],      5.0)   AS r_short,       -- B11  сдвиг коротких ставок, п.п.
    COALESCE(NULL [[, {{r_long}}]],       3.0)   AS r_long,        -- B12  сдвиг длинных ставок, п.п.
    COALESCE(NULL [[, {{decay_x}}]],      4.0)   AS decay_x,       -- B13  параметр затухания x, лет
    COALESCE(NULL [[, {{steep_short}}]],  0.65)  AS steep_short,   -- B14  steepener: вес short
    COALESCE(NULL [[, {{steep_long}}]],   0.9)   AS steep_long,    -- B15  steepener: вес long
    COALESCE(NULL [[, {{flat_short}}]],   0.8)   AS flat_short,    -- B16  flattener: вес short
    COALESCE(NULL [[, {{flat_long}}]],    0.6)   AS flat_long,     -- B17  flattener: вес long
    COALESCE(NULL [[, {{floor_on}}]],     1)     AS floor_on,      -- B18  1 - floor включён, 0 - выключен
    COALESCE(NULL [[, {{floor_t0}}]],    -1.5)   AS floor_t0,      -- B19  floor при t = 0, %
    COALESCE(NULL [[, {{floor_growth}}]], 0.03)  AS floor_growth   -- B20  рост floor в год, п.п.
),

-- Временные бакеты (Excel, строки 23-25)
buckets (bucket_no, bucket_label, term_years) AS (
  VALUES
    (1,  'до востр.', 0.0028),
    (2,  '≤1м',       0.0417),
    (3,  '1–3м',      0.1667),
    (4,  '3–6м',      0.375),
    (5,  '6–9м',      0.625),
    (6,  '9–12м',     0.875),
    (7,  '1–1,5г',    1.25),
    (8,  '1,5–2г',    1.75),
    (9,  '2–3г',      2.5),
    (10, '3–4г',      3.5),
    (11, '4–5г',      4.5),
    (12, '5–6г',      5.5),
    (13, '6–7г',      6.5),
    (14, '7–8г',      7.5),
    (15, '8–9г',      8.5),
    (16, '9–10г',     9.5),
    (17, '10–15г',    12.5),
    (18, '15–20г',    17.5),
    (19, '>20г',      25.0)
),

-- Сценарии (Excel, A55:A61)
scenarios (scenario_no, scenario_name) AS (
  VALUES
    (0, '0. Базовая кривая (без стресса)'),
    (1, '1. Параллельный сдвиг вверх (parallel up)'),
    (2, '2. Параллельный сдвиг вниз (parallel down)'),
    (3, '3. Steepener — короткие вниз, длинные вверх'),
    (4, '4. Flattener — короткие вверх, длинные вниз'),
    (5, '5. Рост краткосрочных ставок (short rate up)'),
    (6, '6. Снижение краткосрочных ставок (short rate down)')
),

-- Узлы за последние полгода от сегодняшней даты; as_of (если задан) - верхняя граница.
nodes AS (
  SELECT as_of_date, tenor_years, yield_pct
  FROM public.gcurve_nodes
  WHERE as_of_date >= CURRENT_DATE - INTERVAL '6 months'
  [[AND as_of_date <= {{as_of}}]]
),

-- Крайние узлы по каждой дате (для "ближайшее известное" и экстраполяции)
edges AS (
  SELECT e.as_of_date, e.t_min, e.t_max, nf.yield_pct AS y_first, nl.yield_pct AS y_last
  FROM (
    SELECT as_of_date, MIN(tenor_years) AS t_min, MAX(tenor_years) AS t_max
    FROM nodes
    GROUP BY as_of_date
  ) e
  JOIN nodes nf ON nf.as_of_date = e.as_of_date AND nf.tenor_years = e.t_min
  JOIN nodes nl ON nl.as_of_date = e.as_of_date AND nl.tenor_years = e.t_max
),

-- Отрезки между соседними узлами: [t0, t1); у последнего узла t1 IS NULL
segments AS (
  SELECT
    as_of_date,
    tenor_years AS t0,
    yield_pct   AS y0,
    LEAD(tenor_years) OVER (PARTITION BY as_of_date ORDER BY tenor_years) AS t1,
    LEAD(yield_pct)   OVER (PARTITION BY as_of_date ORDER BY tenor_years) AS y1
  FROM nodes
),

-- Базовая кривая на бакетах (Excel, строки 28-31): линейная интерполяция,
-- левее первого узла - значение первого узла, правее последнего - значение последнего.
base AS (
  SELECT
    e.as_of_date,
    b.bucket_no,
    b.bucket_label,
    b.term_years,
    CASE
      WHEN b.term_years <= e.t_min THEN e.y_first
      WHEN b.term_years >= e.t_max THEN e.y_last
      ELSE s.y0 + (s.y1 - s.y0) * (b.term_years - s.t0) / (s.t1 - s.t0)
    END AS base_pct,
    CASE
      WHEN b.term_years <  e.t_min THEN 'ближайшее известное'
      WHEN b.term_years >  e.t_max THEN 'экстраполяция'
      WHEN b.term_years =  s.t0    THEN 'узел'
      ELSE 'интерполяция'
    END AS point_type
  FROM edges e
  CROSS JOIN buckets b
  LEFT JOIN segments s
    ON  s.as_of_date = e.as_of_date
    AND s.t0 <= b.term_years
    AND (s.t1 IS NULL OR b.term_years < s.t1)
),

-- Сдвиг Δ (п.п.) по сценариям (Excel, строки 35-50) и floor (строка 29)
shifted AS (
  SELECT
    ba.as_of_date,
    sc.scenario_no,
    sc.scenario_name,
    ba.bucket_no,
    ba.bucket_label,
    ba.term_years,
    ba.base_pct,
    ba.point_type,
    CASE sc.scenario_no
      WHEN 0 THEN 0
      WHEN 1 THEN  p.r_parallel
      WHEN 2 THEN -p.r_parallel
      WHEN 3 THEN -p.steep_short * p.r_short * EXP(-ba.term_years / p.decay_x)
                  + p.steep_long * p.r_long  * (1 - EXP(-ba.term_years / p.decay_x))
      WHEN 4 THEN  p.flat_short  * p.r_short * EXP(-ba.term_years / p.decay_x)
                  - p.flat_long  * p.r_long  * (1 - EXP(-ba.term_years / p.decay_x))
      WHEN 5 THEN  p.r_short * EXP(-ba.term_years / p.decay_x)
      WHEN 6 THEN -p.r_short * EXP(-ba.term_years / p.decay_x)
    END AS shift_pp,
    CASE WHEN p.floor_on = 1
         THEN LEAST(0, p.floor_t0 + p.floor_growth * ba.term_years)
         ELSE -999
    END AS floor_pct
  FROM base ba
  CROSS JOIN scenarios sc
  CROSS JOIN params p
),

-- Кривая под стрессом (Excel, строки 36, 39, ...): для шоков вниз - с учётом floor
curves AS (
  SELECT
    as_of_date, scenario_no, scenario_name, bucket_no, bucket_label, term_years,
    base_pct, point_type, shift_pp, floor_pct,
    CASE
      WHEN shift_pp < 0 THEN GREATEST(base_pct + shift_pp, LEAST(base_pct, floor_pct))
      ELSE base_pct + shift_pp
    END AS stressed_pct
  FROM shifted
)
-- =====================================================================
-- конец сниппета irrbb_core
-- =====================================================================


-- =====================================================================
-- ВОПРОС 1: «IRRBB: кривые на дату»
-- Для выбранной даты берётся последняя доступная дата <= as_of
-- (выходные/праздники -> ближайшая предыдущая); без выбора - последняя в окне.
-- График: X = term_years (или bucket_label, ось "Порядковая"), серия = scenario_name,
--         Y = stressed_pct. Строк: 7 сценариев x 19 бакетов = 133.
-- =====================================================================
{{snippet: irrbb_core}}
SELECT
  as_of_date           AS curve_date,
  scenario_no,
  scenario_name,
  bucket_no,
  bucket_label,
  term_years,
  base_pct,
  point_type,
  shift_pp * 100       AS shift_bp,
  floor_pct,
  stressed_pct
FROM curves
WHERE as_of_date = (SELECT MAX(as_of_date) FROM curves)
ORDER BY scenario_no, bucket_no


-- =====================================================================
-- ВОПРОС 2: «IRRBB: история за полгода»  (сводка по сценариям, Excel блок 5)
-- Одна строка = дата x сценарий (~130 дат x 7 = ~900 строк, меньше лимита в 2000).
-- Графики: X = curve_date, Y = slope_pp / min_rate_pct / max_rate_pct / short_end_pct ...,
--          серия = scenario_name.
-- =====================================================================
{{snippet: irrbb_core}}
SELECT
  as_of_date                                                       AS curve_date,
  scenario_no,
  scenario_name,
  MAX(CASE WHEN bucket_no = 1  THEN shift_pp END) * 100            AS shift_short_bp,   -- Δ короткий конец, б.п.
  MAX(CASE WHEN bucket_no = 19 THEN shift_pp END) * 100            AS shift_long_bp,    -- Δ длинный конец, б.п.
  MAX(ABS(shift_pp)) * 100                                         AS max_abs_shift_bp, -- макс. |Δ|, б.п.
  MIN(stressed_pct)                                                AS min_rate_pct,     -- мин. ставка, %
  MAX(stressed_pct)                                                AS max_rate_pct,     -- макс. ставка, %
  MAX(CASE WHEN bucket_no = 1  THEN stressed_pct END)              AS short_end_pct,
  MAX(CASE WHEN bucket_no = 19 THEN stressed_pct END)              AS long_end_pct,
  MAX(CASE WHEN bucket_no = 19 THEN stressed_pct END)
    - MAX(CASE WHEN bucket_no = 1 THEN stressed_pct END)           AS slope_pp          -- наклон: длинный - короткий, п.п.
FROM curves
GROUP BY as_of_date, scenario_no, scenario_name
ORDER BY as_of_date, scenario_no


-- =====================================================================
-- ПРИМЕЧАНИЯ
-- * Другие СУБД: CURRENT_DATE - INTERVAL '6 months' ->
--   DATEADD(month, -6, CURRENT_DATE) (Snowflake), DATEADD(month, -6, CAST(GETDATE() AS date)) (SQL Server),
--   CURRENT_DATE - INTERVAL 6 MONTH (MySQL), today() - INTERVAL 6 MONTH (ClickHouse);
--   LEAST/GREATEST есть в PostgreSQL, MySQL, Snowflake, ClickHouse; в SQL Server - только с 2022
--   (раньше замените на CASE); VALUES-CTE в MySQL < 8.0.19 и ClickHouse придётся заменить
--   на UNION ALL.
-- * Если дата задана раньше, чем 6 месяцев назад, или данных на неё и раньше нет - строк не будет.
-- * Если в данных есть дубли (as_of_date, tenor_years), строки задвоятся: дедуплицируйте источник.
-- =====================================================================
