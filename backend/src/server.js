/**
 * REST API GCURVE (IRRBB) — чтение данных из Postgres по схеме
 * auth / ref / market / app / calc / audit (см. irrbb_migration.sql).
 *
 * Фронтенд ходит сюда через vite-прокси /api -> http://localhost:4000
 * и при недоступности API прозрачно работает на моках (src/api/client.ts).
 */
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';
import { stressCurves, stressSummary } from './stress.js';

const { Pool } = pg;

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/irrbb',
  // короткий таймаут, чтобы фронт быстро упал в fallback на моки
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
  max: 10,
});

/** Выполнить запрос. Бросает ошибку с флагом dbUnavailable, если Postgres не отвечает. */
async function q(sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (err) {
    err.dbUnavailable = true;
    throw err;
  }
}

/** Обертка маршрута: единый ответ 503 при недоступности БД. */
const route = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json(data);
  } catch (err) {
    if (err.dbUnavailable) {
      res.status(503).json({ error: 'database_unavailable', detail: String(err.message) });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal', detail: String(err.message) });
  }
};

app.get('/', (req, res) => {
  res.json({ service: 'gcurve-backend', docs: 'см. BACKEND.md', health: '/api/health' });
});

app.get(
  '/api/health',
  route(async () => {
    await q('SELECT 1 AS ok');
    return { ok: true, db: 'up' };
  }),
);

/* ------------------------------------------------------------------ */
/* Кривые (market.curve, market.curve_point, ref.time_bucket)          */
/* ------------------------------------------------------------------ */

/** Последняя принятая кривая с точками; change_pp считается к прошлой дате. */
app.get(
  '/api/curves/current',
  route(async () => {
    const [latest] = await q(
      `SELECT id, curve_date, source, revision, loaded_at
         FROM market.curve
        WHERE status = 'accepted'
        ORDER BY curve_date DESC, revision DESC
        LIMIT 1`,
    );
    if (!latest) return null;

    const [points, prevRows, buckets] = await Promise.all([
      q(
        `SELECT tenor_years, rate_pct
           FROM market.curve_point
          WHERE curve_id = $1
          ORDER BY point_no`,
        [latest.id],
      ),
      q(
        `WITH prev AS (
           SELECT id FROM market.curve
            WHERE status = 'accepted' AND curve_date < $1::date
            ORDER BY curve_date DESC, revision DESC LIMIT 1
         )
         SELECT p.tenor_years, p.rate_pct
           FROM market.curve_point p JOIN prev ON prev.id = p.curve_id`,
        [latest.curve_date],
      ),
      q(`SELECT bucket_no, label, tenor_years FROM ref.time_bucket ORDER BY bucket_no`),
    ]);

    const prevByTenor = new Map(prevRows.map((r) => [Number(r.tenor_years), Number(r.rate_pct)]));
    const pointsByTenor = new Map(points.map((r) => [Number(r.tenor_years), Number(r.rate_pct)]));

    // «Нет данных»: тенор есть в ref.time_bucket, а точки в кривой нет
    const resultPoints = buckets.map((b) => {
      const tenor = Number(b.tenor_years);
      const rate = pointsByTenor.get(tenor) ?? null;
      const prev = prevByTenor.get(tenor) ?? null;
      return {
        label: b.label,
        tenorYears: tenor,
        daysToMaturity: Math.round(tenor * 365),
        ratePct: rate,
        changePp: rate !== null && prev !== null ? Number((rate - prev).toFixed(4)) : null,
        isMissing: rate === null,
      };
    });

    return {
      id: latest.id,
      curveDate: latest.curve_date,
      source: latest.source,
      revision: latest.revision,
      fetchedAt: latest.loaded_at,
      points: resultPoints,
    };
  }),
);

/** Несколько последних кривых со всеми точками — для «Истории кривых». */
app.get(
  '/api/curves/history',
  route(async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 7), 30);
    const curves = await q(
      `SELECT id, curve_date, source, revision
         FROM market.curve
        WHERE status = 'accepted'
        ORDER BY curve_date DESC, revision DESC
        LIMIT $1`,
      [limit],
    );
    const ids = curves.map((c) => c.id);
    const points = ids.length
      ? await q(
          `SELECT curve_id, tenor_years, rate_pct
             FROM market.curve_point
            WHERE curve_id = ANY($1::bigint[])
            ORDER BY curve_id, point_no`,
          [ids],
        )
      : [];
    const byCurve = new Map();
    for (const p of points) {
      if (!byCurve.has(p.curve_id)) byCurve.set(p.curve_id, []);
      byCurve.get(p.curve_id).push({ tenorYears: Number(p.tenor_years), ratePct: Number(p.rate_pct) });
    }
    return curves.map((c) => ({
      id: c.id,
      curveDate: c.curve_date,
      source: c.source,
      points: byCurve.get(c.id) ?? [],
    }));
  }),
);

/** Справочник теноров (заменяет захардкоженный список на фронте). */
app.get(
  '/api/tenors',
  route(async () => {
    const rows = await q(
      `SELECT bucket_no, label, tenor_years
         FROM ref.time_bucket
        ORDER BY bucket_no`,
    );
    return rows.map((r) => ({
      bucketNo: r.bucket_no,
      label: r.label,
      tenorYears: Number(r.tenor_years),
      daysToMaturity: Math.round(Number(r.tenor_years) * 365),
    }));
  }),
);

/* ------------------------------------------------------------------ */
/* Стресс-кривые IRRBB (BCBS 368) — порт сниппета irrbb_core           */
/* Узлы берутся из market.curve_point последней принятой кривой.       */
/* ------------------------------------------------------------------ */

async function curveNodesOnDate(asOf) {
  const [curve] = await q(
    `SELECT id, curve_date
       FROM market.curve
      WHERE status = 'accepted'
        ${asOf ? 'AND curve_date <= $1::date' : ''}
      ORDER BY curve_date DESC, revision DESC
      LIMIT 1`,
    asOf ? [asOf] : [],
  );
  if (!curve) return null;
  const points = await q(
    `SELECT tenor_years, rate_pct
       FROM market.curve_point
      WHERE curve_id = $1
      ORDER BY tenor_years`,
    [curve.id],
  );
  return {
    curveDate: curve.curve_date,
    nodes: points.map((p) => ({ tenorYears: Number(p.tenor_years), yieldPct: Number(p.rate_pct) })),
  };
}

/** Кривые на дату: 7 сценариев × 19 бакетов (как вопрос 1 в Metabase). */
app.get(
  '/api/curves/stress',
  route(async (req) => {
    const found = await curveNodesOnDate(req.query.as_of ?? null);
    if (!found) return null;
    const rows = stressCurves(found.nodes, req.query);
    return { curveDate: found.curveDate, rows };
  }),
);

/** История за полгода: сводка по сценариям на дату (как вопрос 2 в Metabase). */
app.get(
  '/api/curves/stress/history',
  route(async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 130), 366);
    const curves = await q(
      `SELECT id, curve_date
         FROM market.curve
        WHERE status = 'accepted'
        ORDER BY curve_date DESC, revision DESC
        LIMIT $1`,
      [limit],
    );
    if (!curves.length) return [];
    const points = await q(
      `SELECT curve_id, tenor_years, rate_pct
         FROM market.curve_point
        WHERE curve_id = ANY($1::bigint[])
        ORDER BY curve_id, tenor_years`,
      [curves.map((c) => c.id)],
    );
    const byCurve = new Map();
    for (const p of points) {
      if (!byCurve.has(p.curve_id)) byCurve.set(p.curve_id, []);
      byCurve.get(p.curve_id).push({ tenorYears: Number(p.tenor_years), yieldPct: Number(p.rate_pct) });
    }
    return curves.map((c) => ({
      curveDate: c.curve_date,
      scenarios: stressSummary(stressCurves(byCurve.get(c.id) ?? [], req.query)),
    }));
  }),
);

/* ------------------------------------------------------------------ */
/* Портфели (app.portfolio, app.portfolio_instrument)                  */
/* ------------------------------------------------------------------ */

app.get(
  '/api/portfolios',
  route(async () => {
    const rows = await q(
      `SELECT p.id, p.name, p.version_no, p.updated_at,
              COUNT(pi.id) AS instrument_count,
              COALESCE(SUM(pi.nominal_rub), 0) AS total_nominal
         FROM app.portfolio p
         LEFT JOIN app.portfolio_instrument pi
           ON pi.portfolio_id = p.id AND pi.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.id`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      version: r.version_no,
      updatedAt: r.updated_at,
      instrumentCount: Number(r.instrument_count),
      totalNominal: Number(r.total_nominal),
    }));
  }),
);

app.get(
  '/api/portfolios/:id',
  route(async (req) => {
    const [portfolio] = await q(
      `SELECT id, name, version_no, updated_at
         FROM app.portfolio
        WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!portfolio) return null;
    const instruments = await q(
      `SELECT id, instrument_code, instrument_type_code, name, nominal_rub,
              interest_rate_pct, maturity_date, status
         FROM app.portfolio_instrument
        WHERE portfolio_id = $1 AND deleted_at IS NULL
        ORDER BY instrument_code`,
      [req.params.id],
    );
    return {
      id: String(portfolio.id),
      name: portfolio.name,
      version: portfolio.version_no,
      updatedAt: portfolio.updated_at,
      instruments: instruments.map((i) => ({
        id: String(i.id),
        instrumentCode: i.instrument_code,
        typeCode: i.instrument_type_code,
        name: i.name,
        nominalRub: Number(i.nominal_rub),
        interestRatePct: i.interest_rate_pct === null ? null : Number(i.interest_rate_pct),
        maturityDate: i.maturity_date,
        status: i.status,
      })),
    };
  }),
);

/* ------------------------------------------------------------------ */
/* Сценарии (app.scenario)                                             */
/* ------------------------------------------------------------------ */

/** Каталог активных сценариев. Шоки по тенорам НЕ дублируем: они лежат
 *  в calc.stressed_curve_point последнего запуска (см. /api/calculations/latest). */
app.get(
  '/api/scenarios',
  route(async () => {
    const rows = await q(
      `SELECT DISTINCT ON (code) id, code, name, shift_type, description,
              approval_status, is_mandatory, version_no
         FROM app.scenario
        WHERE is_active
        ORDER BY code, version_no DESC`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      code: r.code,
      name: r.name,
      shiftType: r.shift_type,
      description: r.description,
      approvalStatus: r.approval_status,
      isMandatory: r.is_mandatory,
      version: r.version_no,
    }));
  }),
);

/* ------------------------------------------------------------------ */
/* Расчёты (calc.curve_run + run_base_result + run_summary + …)        */
/* ------------------------------------------------------------------ */

app.get(
  '/api/calculations/latest',
  route(async () => {
    const [run] = await q(
      `SELECT r.id, r.status, r.created_at, r.started_at, r.finished_at,
              r.portfolio_id, r.portfolio_version, r.instrument_count,
              b.npv_base, b.nii_base,
              s.ec_irrbb, s.worst_scenario_id,
              s.scenarios_total, s.scenarios_succeeded, s.scenarios_failed,
              s.is_final, s.calculated_at
         FROM calc.curve_run r
         LEFT JOIN calc.run_base_result b ON b.curve_run_id = r.id
         LEFT JOIN calc.run_summary s ON s.curve_run_id = r.id
        ORDER BY r.created_at DESC
        LIMIT 1`,
    );
    if (!run) return null;

    const scenarios = await q(
      `SELECT rs.scenario_id, rs.status, rs.npv, rs.delta_npv, rs.nii, rs.delta_nii,
              rs.economic_capital, rs.error_code, rs.error_message,
              sc.name AS scenario_name
         FROM calc.run_scenario rs
         JOIN app.scenario sc ON sc.id = rs.scenario_id
        WHERE rs.curve_run_id = $1
        ORDER BY rs.scenario_id`,
      [run.id],
    );

    return {
      id: String(run.id),
      status: run.status,
      requestedAt: run.created_at,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      durationMs:
        run.started_at && run.finished_at
          ? new Date(run.finished_at) - new Date(run.started_at)
          : null,
      portfolioId: run.portfolio_id === null ? null : String(run.portfolio_id),
      portfolioVersion: run.portfolio_version,
      instrumentCount: run.instrument_count,
      baseNpvMln: run.npv_base === null ? null : Number(run.npv_base),
      baseNiiMln: run.nii_base === null ? null : Number(run.nii_base),
      summary: run.scenarios_total === null
        ? null
        : {
            ecIrrbbMln: run.ec_irrbb === null ? null : Number(run.ec_irrbb),
            worstScenarioId: run.worst_scenario_id === null ? null : String(run.worst_scenario_id),
            scenariosTotal: run.scenarios_total,
            scenariosSucceeded: run.scenarios_succeeded,
            scenariosFailed: run.scenarios_failed,
            isFinal: run.is_final,
            calculatedAt: run.calculated_at,
          },
      scenarios: scenarios.map((s) => ({
        scenarioId: String(s.scenario_id),
        name: s.scenario_name,
        status: s.status,
        npvMln: s.npv === null ? null : Number(s.npv),
        deltaNpvMln: s.delta_npv === null ? null : Number(s.delta_npv),
        deltaNiiMln: s.delta_nii === null ? null : Number(s.delta_nii),
        economicCapitalMln: s.economic_capital === null ? null : Number(s.economic_capital),
        errorCode: s.error_code,
        errorMessage: s.error_message,
      })),
    };
  }),
);

/** Детализация по инструментам сценария. Пагинация limit/offset — для 10/20/50. */
app.get(
  '/api/calculations/:id/instruments',
  route(async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 1), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const scenarioId = req.query.scenario_id ?? null;

    const params = [req.params.id];
    let scenarioFilter = '';
    if (scenarioId) {
      params.push(scenarioId);
      scenarioFilter = 'AND scenario_id = $2';
    }

    const [totalRow] = await q(
      `SELECT COUNT(*)::int AS n
         FROM calc.run_instrument_result
        WHERE curve_run_id = $1 ${scenarioFilter}`,
      params,
    );

    const rows = await q(
      `SELECT instrument_id, instrument_code, base_npv, scenario_npv, delta_npv, delta_nii
         FROM calc.run_instrument_result
        WHERE curve_run_id = $1 ${scenarioFilter}
        ORDER BY ABS(delta_npv) DESC NULLS LAST, instrument_code
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return {
      total: totalRow?.n ?? 0,
      limit,
      offset,
      rows: rows.map((r) => ({
        instrumentId: String(r.instrument_id),
        instrumentCode: r.instrument_code,
        baseNpvMln: r.base_npv === null ? null : Number(r.base_npv),
        scenarioNpvMln: r.scenario_npv === null ? null : Number(r.scenario_npv),
        deltaNpvMln: r.delta_npv === null ? null : Number(r.delta_npv),
        deltaNiiMln: r.delta_nii === null ? null : Number(r.delta_nii),
      })),
    };
  }),
);

/* ------------------------------------------------------------------ */
/* LLM-анализ (calc.llm_analysis)                                      */
/* ------------------------------------------------------------------ */

app.get(
  '/api/llm-analysis/latest',
  route(async () => {
    const [row] = await q(
      `SELECT a.status, a.analysis_text, a.model, a.generated_at, a.error_message
         FROM calc.llm_analysis a
         JOIN calc.curve_run r ON r.id = a.curve_run_id
        WHERE a.is_current
        ORDER BY r.created_at DESC
        LIMIT 1`,
    );
    if (!row) return null;
    return {
      status: row.status,
      analysisText: row.analysis_text,
      model: row.model,
      generatedAt: row.generated_at,
      errorMessage: row.error_message,
    };
  }),
);

/* ------------------------------------------------------------------ */
/* Статусы источников (app.source_status) и пользователи (auth)        */
/* ------------------------------------------------------------------ */

app.get(
  '/api/sources',
  route(async () => {
    const rows = await q(
      `SELECT source, status, last_success_at, last_error_at, last_error_message
         FROM app.source_status
        ORDER BY source`,
    );
    return rows.map((r) => ({
      source: r.source,
      status: r.status,
      lastSuccessAt: r.last_success_at,
      lastErrorAt: r.last_error_at,
      lastErrorMessage: r.last_error_message,
    }));
  }),
);

app.get(
  '/api/users',
  route(async () => {
    const rows = await q(
      `SELECT u.id, u.email, u.display_name, u.role, u.status,
              (SELECT MAX(s.created_at) FROM auth.user_session s
                WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS last_login_at
         FROM auth.user_account u
        ORDER BY u.id`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      email: r.email,
      fullName: r.display_name,
      role: r.role,
      status: r.status,
      lastLoginAt: r.last_login_at,
    }));
  }),
);

app.listen(port, () => {
  console.log(`gcurve-backend: http://localhost:${port} (db: ${process.env.DATABASE_URL ?? 'default'})`);
});
