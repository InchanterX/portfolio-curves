import { AppShell } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { ImpactBars } from '../components/ImpactBars';
import { IconArrowRight, IconSparkle } from '../components/Icons';
import { CALCULATION, LLM_ANALYSIS, PORTFOLIOS, SCENARIOS } from '../data/mock';
import { navigate } from '../router';
import { fmtDate, fmtMln, fmtMlnDelta, fmtShare } from '../utils/format';

interface Row {
  scenarioId: string;
  name: string;
  npv: number | null;
  deltaNpv: number | null;
  deltaShare: number | null;
}

export function ResultsPage() {
  const portfolio = PORTFOLIOS.find((p) => p.id === CALCULATION.portfolioId);
  const baseNpv = CALCULATION.baseNpvMln;

  const rows: Row[] = CALCULATION.scenarios.map((s) => {
    const sc = SCENARIOS.find((x) => x.id === s.scenarioId);
    return {
      scenarioId: s.scenarioId,
      name: sc?.name ?? s.scenarioId,
      npv: s.npvMln,
      deltaNpv: s.deltaNpvMln,
      deltaShare: baseNpv ? ((s.deltaNpvMln ?? 0) / baseNpv) * 100 : null,
    };
  });

  const worst = rows.reduce<Row | null>(
    (acc, r) => (r.deltaNpv !== null && (acc === null || r.deltaNpv < (acc.deltaNpv ?? 0)) ? r : acc),
    null,
  );

  const columns: Column<Row>[] = [
    {
      key: 'name',
      title: 'Сценарий',
      sortValue: (r) => r.name,
      render: (r) => <b>{r.name}</b>,
    },
    {
      key: 'npv',
      title: 'NPV, млн ₽',
      align: 'right',
      sortValue: (r) => r.npv ?? -Infinity,
      render: (r) => <span className="num">{r.npv != null ? r.npv.toFixed(2).replace('.', ',') : 'Нет данных'}</span>,
    },
    {
      key: 'delta',
      title: 'Δ NPV, млн ₽',
      align: 'right',
      sortValue: (r) => r.deltaNpv ?? -Infinity,
      render: (r) =>
        r.deltaNpv === null ? (
          <span className="muted">Нет данных</span>
        ) : (
          <span className={`num ${r.deltaNpv > 0 ? 'pos' : r.deltaNpv < 0 ? 'neg' : ''}`}>{fmtMlnDelta(r.deltaNpv)}</span>
        ),
    },
    {
      key: 'share',
      title: 'Δ, %',
      align: 'right',
      sortValue: (r) => r.deltaShare ?? -Infinity,
      render: (r) =>
        r.deltaShare === null ? (
          <span className="muted">Нет данных</span>
        ) : (
          <span className={`num ${r.deltaShare > 0 ? 'pos' : r.deltaShare < 0 ? 'neg' : ''}`}>{fmtShare(r.deltaShare)}</span>
        ),
    },
    {
      key: 'action',
      title: '',
      render: () => (
        <button className="link" onClick={() => navigate('/results/detail')}>
          Детализация →
        </button>
      ),
    },
  ];

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Результаты расчёта',
        title: 'Результаты расчёта',
        actions: (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/scenarios')}>
              Новый расчёт
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/ai')}>
              <IconSparkle size={14} /> AI-аналитика
            </button>
          </>
        ),
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Результаты расчёта</h1>
          <p className="sub">
            {portfolio?.name} · Расчёт № {CALCULATION.number} · {fmtDate(CALCULATION.requestedAt)},{' '}
            {new Date(CALCULATION.requestedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <span className="badge badge-green">
          <span className="dot" /> Расчёт завершён
        </span>
      </div>

      <div className="grid grid-3">
        <div className="card kpi">
          <span className="kpi-label">Базовый NPV</span>
          <span className="kpi-value num">{fmtMln(CALCULATION.baseNpvMln)}</span>
          <span className="kpi-sub">До применения шоков</span>
        </div>
        <div className="card kpi kpi-featured">
          <span className="kpi-label">Значение сценария</span>
          <span className="kpi-value num">{fmtMlnDelta(CALCULATION.summary?.ecIrrbbMln)}</span>
          <span className="kpi-sub">
            {worst ? `${worst.name} · ${fmtShare(worst.deltaShare)} от базового NPV` : 'Нет данных'}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Сценариев рассчитано</span>
          <span className="kpi-value num">
            {CALCULATION.summary?.scenariosSucceeded} / {CALCULATION.summary?.scenariosTotal}
          </span>
          <span className="kpi-sub">Все сценарии выполнены без ошибок</span>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <div className="card">
          <h3 className="card-title">Сравнение сценариев</h3>
          <p className="card-sub">Δ NPV относительно базовой оценки</p>
          <div className="mt-2">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.scenarioId}
              isRowSelected={(r) => r.scenarioId === CALCULATION.summary?.worstScenarioId}
              onRowClick={() => navigate('/results/detail')}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h3 className="card-title">Распределение изменений</h3>
            <p className="card-sub">Размер и направление влияния сценария, млн ₽</p>
            <div className="mt-3">
              <ImpactBars rows={rows.map((r) => ({ label: r.name, value: r.deltaNpv ?? 0 }))} />
            </div>
          </div>
          <div className="card">
            <h3 className="card-title">Краткий вывод</h3>
            <p className="card-sub">Сформировано на основе AI-аналитики расчёта № {CALCULATION.number}</p>
            <p className="small mt-2" style={{ lineHeight: 1.6 }}>
              {LLM_ANALYSIS.analysisText}
            </p>
            <button className="btn btn-primary btn-sm mt-2" onClick={() => navigate('/results/detail')}>
              Все инструменты <IconArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="footer-note">GCURVE / Анализ процентного риска</div>
    </AppShell>
  );
}
