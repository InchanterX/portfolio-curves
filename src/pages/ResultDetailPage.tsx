import { AppShell } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { IconArrowRight } from '../components/Icons';
import { CALCULATION, CONTRIBUTIONS, OTHER_POSITIONS, SCENARIOS } from '../data/mock';
import { navigate } from '../router';
import { fmtMlnDelta, fmtRub, fmtShare } from '../utils/format';

const scenario = SCENARIOS.find((s) => s.id === 'sc-par-p100')!;

interface Row {
  key: string;
  name: string;
  code?: string;
  nominalRub: number;
  baseNpvMln: number | null;
  deltaNpvMln: number | null;
  sharePct: number;
  isOthers?: boolean;
}

export function ResultDetailPage() {
  const scenarioDelta = CALCULATION.scenarios.find((s) => s.scenarioId === scenario.id)?.deltaNpvMln ?? null;

  const rows: Row[] = [
    ...CONTRIBUTIONS.map((c) => ({
      key: c.instrumentCode,
      name: c.name,
      code: c.instrumentCode,
      nominalRub: c.nominalRub,
      baseNpvMln: c.baseNpvMln,
      deltaNpvMln: c.deltaNpvMln,
      sharePct: c.sharePct,
    })),
    {
      key: 'others',
      name: `Другие позиции · ${OTHER_POSITIONS.count}`,
      nominalRub: OTHER_POSITIONS.nominalRub,
      baseNpvMln: OTHER_POSITIONS.baseNpvMln,
      deltaNpvMln: OTHER_POSITIONS.deltaNpvMln,
      sharePct: OTHER_POSITIONS.sharePct,
      isOthers: true,
    },
  ];

  const columns: Column<Row>[] = [
    {
      key: 'name',
      title: 'Инструмент',
      sortValue: (r) => r.name,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          {r.code && <div className="small muted num">{r.code}</div>}
        </div>
      ),
    },
    {
      key: 'nominal',
      title: 'Номинал, ₽',
      align: 'right',
      sortValue: (r) => r.nominalRub,
      render: (r) => <span className="num">{fmtRub(r.nominalRub)}</span>,
    },
    {
      key: 'base',
      title: 'Базовый NPV, млн ₽',
      align: 'right',
      sortValue: (r) => r.baseNpvMln ?? -Infinity,
      render: (r) => <span className="num">{r.baseNpvMln != null ? r.baseNpvMln.toFixed(2).replace('.', ',') : 'Нет данных'}</span>,
    },
    {
      key: 'delta',
      title: 'Δ NPV, млн ₽',
      align: 'right',
      sortValue: (r) => r.deltaNpvMln ?? -Infinity,
      render: (r) =>
        r.deltaNpvMln === null ? (
          <span className="muted">Нет данных</span>
        ) : (
          <span className={`num ${r.deltaNpvMln > 0 ? 'pos' : r.deltaNpvMln < 0 ? 'neg' : ''}`}>{fmtMlnDelta(r.deltaNpvMln)}</span>
        ),
    },
    {
      key: 'share',
      title: 'Вклад, %',
      align: 'right',
      sortValue: (r) => r.sharePct,
      render: (r) => <span className="num">{fmtShare(r.sharePct)}</span>,
    },
    {
      key: 'action',
      title: '',
      render: (r) =>
        r.isOthers ? (
          <button className="link" onClick={() => navigate('/portfolios')}>
            Показать →
          </button>
        ) : (
          <button className="link" onClick={() => navigate(`/portfolios/pfz-main/i1`)}>
            Карточка →
          </button>
        ),
    },
  ];

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Детализация по инструментам',
        title: 'Вклад позиций в результат',
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Детализация по инструментам</h1>
          <p className="sub">
            Результаты / Расчёт № {CALCULATION.number} / Вклад позиций · сортировка по абсолютному изменению NPV
          </p>
        </div>
        <span className="badge badge-accent">Сценарий: {scenario.name}</span>
      </div>

      <div className="grid grid-3">
        <div className="card kpi kpi-featured">
          <span className="kpi-label">Сценарный Δ NPV</span>
          <span className="kpi-value lg num">{fmtMlnDelta(scenarioDelta)}</span>
          <span className="kpi-sub num">−1,92 % от базового NPV</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Позиций выполнено</span>
          <span className="kpi-value num">24 / 24</span>
          <span className="kpi-sub">По всем инструментам портфеля</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Изменение NPV</span>
          <span className="kpi-value num">23,3 %</span>
          <span className="kpi-sub">Совокупно по портфелю</span>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Вклад позиций в результат</h3>
        <p className="card-sub">Сортировка по абсолютному изменению NPV. Клик по строке — карточка инструмента.</p>
        <div className="mt-2">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            onRowClick={(r) => (r.isOthers ? navigate('/portfolios') : navigate('/portfolios/pfz-main/i1'))}
          />
        </div>
      </div>

      <div className="card row-between">
        <div>
          <div style={{ fontWeight: 600 }}>Концентрация чувствительности</div>
          <div className="small muted" style={{ maxWidth: 640 }}>
            Пять крупнейших позиций формируют основную часть процентного риска портфеля. Проверьте лимиты
            концентрации по длинным выпускам.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/ai')}>
          Открыть AI-аналитику <IconArrowRight size={14} />
        </button>
      </div>

      <div className="card row-between">
        <div className="small muted">
          ОФЗ 26238 вносит вклад −2,3 % совокупного изменения в этом сценарии — наибольший среди позиций.
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/results')}>
          ← К результатам
        </button>
      </div>

      <div className="footer-note">GCURVE / Анализ процентного риска</div>
    </AppShell>
  );
}
