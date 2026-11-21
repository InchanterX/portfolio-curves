import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { IconExport, IconPlus } from '../components/Icons';
import { CURVE_CURRENT, CURVE_HISTORY, CURVE_PREVIOUS, TENORS } from '../data/mock';
import { Visualization } from '../visualizations/Visualization';
import { fmtDate, fmtPct, fmtPp } from '../utils/format';

interface Row {
  tenorCode: string;
  label: string;
  cur: number | null;
  prev: number | null;
  delta: number | null;
}

/** Доходности по дате: история + предыдущий день */
const YIELDS_BY_DATE: Record<string, number[]> = Object.fromEntries(CURVE_HISTORY.map((c) => [c.date, c.yields]));
YIELDS_BY_DATE[CURVE_PREVIOUS.curveDate] = CURVE_PREVIOUS.points.map((p) => p.yieldPct ?? 0);

const ALL_DATES = [CURVE_PREVIOUS.curveDate, ...CURVE_HISTORY.map((c) => c.date).reverse()].filter(
  (d) => d !== CURVE_CURRENT.curveDate,
);

export function ComparePage() {
  const [dates, setDates] = useState<string[]>([CURVE_PREVIOUS.curveDate]);
  const [compareDate, setCompareDate] = useState<string>(CURVE_PREVIOUS.curveDate);
  const [applied, setApplied] = useState<string>(CURVE_PREVIOUS.curveDate);

  const addDate = () => {
    const next = ALL_DATES.find((d) => !dates.includes(d));
    if (!next) return;
    setDates((d) => [...d, next]);
    setCompareDate(next);
    setApplied(next);
  };

  const prevYields = YIELDS_BY_DATE[applied] ?? YIELDS_BY_DATE[CURVE_PREVIOUS.curveDate];

  const rows: Row[] = TENORS.map((t, i) => {
    const cur = CURVE_CURRENT.points[i];
    return {
      tenorCode: t.code,
      label: t.label,
      cur: cur?.yieldPct ?? null,
      prev: prevYields[i] ?? null,
      delta: cur?.yieldPct != null && prevYields[i] != null ? +(cur.yieldPct - prevYields[i]).toFixed(2) : null,
    };
  });

  const columns: Column<Row>[] = [
    {
      key: 'tenor',
      title: 'Срок',
      sortValue: (r) => TENORS.find((t) => t.code === r.tenorCode)?.sortOrder ?? 0,
      render: (r) => <b>{r.label}</b>,
    },
    {
      key: 'cur',
      title: fmtDate(CURVE_CURRENT.curveDate),
      align: 'right',
      sortValue: (r) => r.cur ?? -1,
      render: (r) => (r.cur === null ? <span className="muted">Нет данных</span> : <span className="num">{fmtPct(r.cur)}</span>),
    },
    {
      key: 'prev',
      title: fmtDate(applied),
      align: 'right',
      sortValue: (r) => r.prev ?? -1,
      render: (r) => (r.prev === null ? <span className="muted">Нет данных</span> : <span className="num">{fmtPct(r.prev)}</span>),
    },
    {
      key: 'delta',
      title: 'Δ, п.п.',
      align: 'right',
      sortValue: (r) => r.delta ?? -999,
      render: (r) =>
        r.delta === null ? (
          <span className="muted">Нет данных</span>
        ) : (
          <span className={`num ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : 'muted'}`}>{fmtPp(r.delta)}</span>
        ),
    },
  ];

  return (
    <AppShell
      crumb={{
        section: 'Аналитика кривой ОФЗ / Сравнение дат',
        title: 'Сравнение кривых по датам',
        actions: (
          <button className="btn btn-primary btn-sm">
            <IconExport size={14} /> Экспорт
          </button>
        ),
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Сравнение дат</h1>
          <p className="sub">Анализ различий кривых на выбранные даты. Базовая дата — {fmtDate(CURVE_CURRENT.curveDate)}.</p>
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Первая дата</label>
            <select className="select" style={{ width: 180 }} value={CURVE_CURRENT.curveDate} disabled>
              <option>{fmtDate(CURVE_CURRENT.curveDate)}</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Вторая дата</label>
            <select className="select" style={{ width: 180 }} value={compareDate} onChange={(e) => setCompareDate(e.target.value)}>
              {[...new Set([...dates, ...ALL_DATES])].map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d)}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setApplied(compareDate)}>
            Сравнить
          </button>
          <button className="btn btn-ghost btn-sm" onClick={addDate}>
            <IconPlus size={14} /> Добавить дату
          </button>
        </div>
      </div>

      <div className="card">
        <Visualization
          display="line"
          labels={TENORS.map((t) => t.label)}
          series={[
            { label: fmtDate(CURVE_CURRENT.curveDate), values: CURVE_CURRENT.points.map((p) => p.yieldPct) },
            { label: fmtDate(applied), values: prevYields, dashed: true, color: 'var(--text-3)' },
          ]}
          height={300}
          settings={{ 'graph.y_axis.format': (v) => `${Math.round(v)}%` }}
        />
        <div className="row" style={{ justifyContent: 'center', gap: 22, marginTop: 6 }}>
          <span className="small muted row" style={{ gap: 6 }}>
            <i style={{ width: 14, height: 3, background: 'var(--accent)', borderRadius: 2, display: 'inline-block' }} />
            {fmtDate(CURVE_CURRENT.curveDate)}
          </span>
          <span className="small muted row" style={{ gap: 6 }}>
            <i style={{ width: 14, height: 0, borderTop: '2px dashed var(--text-3)', display: 'inline-block' }} />
            {fmtDate(applied)}
          </span>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Изменение по срокам</h3>
        <p className="card-sub">Точки кривой на выбранные даты и разница в п.п.</p>
        <div className="mt-2">
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.tenorCode} pageSize={20} />
        </div>
      </div>

      <div className="footer-note">Демонстрационные данные · {fmtDate(CURVE_CURRENT.curveDate)}</div>
    </AppShell>
  );
}
