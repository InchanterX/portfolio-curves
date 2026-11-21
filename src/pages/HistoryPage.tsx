import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { IconCalendar, IconPlus } from '../components/Icons';
import { TENORS, CURVE_CURRENT, CURVE_HISTORY } from '../data/mock';
import { accentColors } from '../lib/colors';
import { navigate } from '../router';
import { Visualization } from '../visualizations/Visualization';
import { fmtDate, fmtPct } from '../utils/format';

interface SnapshotRow {
  date: string;
  source: string;
  points: string;
  yield10y: number;
}

const currentDate = new Date(`${CURVE_CURRENT.curveDate}T00:00:00Z`);
const months = Array.from({ length: 6 }, (_, index) => {
  const date = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - 5 + index, 1));
  return {
    value: `${date.getUTCFullYear()}-${date.getUTCMonth()}`,
    label: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date),
    days: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(),
  };
});

export function HistoryPage() {
  const [curves, setCurves] = useState(CURVE_HISTORY);
  const [visible, setVisible] = useState<Set<number>>(new Set([curves.length - 3, curves.length - 2, curves.length - 1]));
  const [selectedMonth, setSelectedMonth] = useState(months.length - 1);
  const [selectedDay, setSelectedDay] = useState(1);

  const toggle = (i: number) =>
    setVisible((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const addDate = () => {
    const [year, month] = months[selectedMonth].value.split('-').map(Number);
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    setCurves((list) => {
      if (list.some((curve) => curve.date === iso)) return list;
      const oldest = list[0];
      return [{ date: iso, yields: oldest.yields.map((y) => +(y - 0.05).toFixed(2)) }, ...list].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
    });
  };

  const snapshotColumns: Column<SnapshotRow>[] = [
    {
      key: 'date',
      title: 'Дата снимка',
      sortValue: (r) => r.date,
      render: (r) => <b className="num">{fmtDate(r.date)}</b>,
    },
    { key: 'source', title: 'Источник', render: (r) => r.source },
    { key: 'points', title: 'Точек', align: 'right', render: (r) => <span className="num">{r.points}</span> },
    {
      key: 'yield',
      title: '10 лет',
      align: 'right',
      sortValue: (r) => r.yield10y,
      render: (r) => <span className="num">{fmtPct(r.yield10y)}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      render: () => (
        <span className="badge badge-green">
          <span className="dot" /> Принята
        </span>
      ),
    },
    {
      key: 'action',
      title: '',
      render: () => (
        <button className="link" onClick={() => navigate('/compare')}>
          Открыть →
        </button>
      ),
    },
  ];

  const snapshotRows: SnapshotRow[] = [...curves]
    .reverse()
    .map((c) => ({ date: c.date, source: 'Банк России', points: '11/11', yield10y: c.yields[7] }));

  return (
    <AppShell
      crumb={{
        section: 'Аналитика кривой ОФЗ / История кривых',
        title: 'История кривых',
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Динамика кривой за неделю</h1>
          <p className="sub">Все ревизии кривых сохраняются и доступны для анализа · последние {curves.length} дат</p>
        </div>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">Кривые за выбранный период</h3>
            <p className="card-sub">Доходность, % годовых — срок до погашения. Клик по дате скрывает серию.</p>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {curves.map((c, i) => (
              <button
                key={c.date}
                className={`badge ${visible.has(i) ? '' : 'muted'}`}
                style={{
                  cursor: 'pointer',
                  borderColor: visible.has(i) ? accentColors[i % accentColors.length] : undefined,
                  color: visible.has(i) ? accentColors[i % accentColors.length] : undefined,
                  opacity: visible.has(i) ? 1 : 0.5,
                }}
                onClick={() => toggle(i)}
              >
                {fmtDate(c.date)}
              </button>
            ))}
            <div className="row" style={{ gap: 6 }} aria-label="Календарь добавления даты">
              <IconCalendar size={16} className="muted" />
              <select
                className="select"
                aria-label="День"
                style={{ width: 68, padding: '6px 24px 6px 9px', backgroundPosition: 'calc(100% - 14px) 50%, calc(100% - 9px) 50%' }}
                value={selectedDay}
                onChange={(event) => setSelectedDay(Number(event.target.value))}
              >
                {Array.from({ length: months[selectedMonth].days }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              <select
                className="select"
                aria-label="Месяц"
                style={{ width: 158, padding: '6px 28px 6px 9px' }}
                value={selectedMonth}
                onChange={(event) => {
                  const month = Number(event.target.value);
                  setSelectedMonth(month);
                  setSelectedDay((day) => Math.min(day, months[month].days));
                }}
              >
                {months.map((month, index) => (
                  <option key={month.value} value={index}>
                    {month.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={addDate} title="Добавить выбранную дату">
                <IconPlus size={14} /> Добавить
              </button>
            </div>
          </div>
        </div>
        <Visualization
          display="line"
          labels={TENORS.map((t) => t.label)}
          series={curves.map((c, i) => ({
            label: fmtDate(c.date),
            values: visible.has(i) ? c.yields : c.yields.map(() => null),
            color: accentColors[i % accentColors.length],
            dashed: i < curves.length - 3,
          }))}
          height={320}
          settings={{ 'graph.y_axis.format': (v) => `${Math.round(v)}%` }}
        />
      </div>

      <div className="card">
        <h3 className="card-title">Доступные снимки кривой</h3>
        <p className="card-sub">Все загруженные ревизии с источником и статусом</p>
        <div className="mt-2">
          <DataTable columns={snapshotColumns} rows={snapshotRows} rowKey={(r) => r.date} pageSize={10} />
        </div>
      </div>

      <div className="footer-note">GCURVE / Анализ процентного риска · Демонстрационные данные</div>
    </AppShell>
  );
}
