import { useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { DataTable } from '../components/DataTable';
import { IconArrowRight, IconClose, IconPlus } from '../components/Icons';
import {
  CALCULATION,
  CURVE_CURRENT,
  PORTFOLIOS,
  SCENARIOS,
  TENORS,
  type Scenario,
} from '../data/mock';
import { navigate } from '../router';
import { Visualization } from '../visualizations/Visualization';
import { fmtBps, fmtDate } from '../utils/format';

const TYPE_LABEL: Record<Scenario['scenarioTypeCode'], string> = {
  parallel: 'Parallel',
  twist: 'Twist',
  curvature: 'Curvature',
};

export function ScenariosPage() {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(['sc-par-p100', 'sc-twist', 'sc-curv']),
  );
  const [activeType, setActiveType] = useState<Scenario['scenarioTypeCode']>('parallel');
  const [shockValue, setShockValue] = useState(100);

  const portfolio = PORTFOLIOS.find((p) => p.id === CALCULATION.portfolioId) ?? PORTFOLIOS[0];

  const base = CURVE_CURRENT.points.map((p) => p.yieldPct ?? 0);

  const previewSeries = useMemo(() => {
    const list = SCENARIOS.filter((s) => selected.has(s.id)).slice(0, 3);
    return list.map((s) => ({
      label: s.name,
      values: s.shocks.map((sh, i) => base[i] + sh.shockBps / 100),
    }));
  }, [selected, base]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const canRun = selected.size > 0;
  const activeScenario = SCENARIOS.find((s) => s.scenarioTypeCode === activeType) ?? SCENARIOS[0];

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Сценарии сдвигов',
        title: 'Сценарии сдвигов',
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Настройте шоки и оцените форму сценария</h1>
          <p className="sub">Сценарии выбираются из утверждённого каталога Calculator и не редактируются.</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">Портфель</label>
              <select className="select">
                {PORTFOLIOS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.instruments.length} инструментов
                  </option>
                ))}
              </select>
            </div>
            <div className="small muted">
              Дата оценки: <b style={{ color: 'var(--text)' }}>{fmtDate(CALCULATION.valuationDate)}</b> · Базовая кривая:{' '}
              <b style={{ color: 'var(--text)' }}>{fmtDate(CURVE_CURRENT.curveDate)}, MOEX</b>
            </div>
          </div>

          <div className="card">
            <div className="row-between" style={{ marginBottom: 14 }}>
              <div>
                <h3 className="card-title">Параметры сценария</h3>
                <p className="card-sub">Шоки задаются в базисных пунктах</p>
              </div>
            </div>
            <div className="tabs" style={{ marginBottom: 16 }}>
              {(['parallel', 'twist', 'curvature'] as const).map((t) => (
                <button
                  key={t}
                  className={`tab ${activeType === t ? 'active' : ''}`}
                  onClick={() => setActiveType(t)}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="field">
              <label className="label">Название</label>
              <input className="input" value={activeScenario.name} readOnly />
            </div>
            <div className="field">
              <label className="label">Величина шока, б.п.</label>
              <input
                className="input num"
                type="number"
                min={-200}
                max={200}
                value={shockValue}
                onChange={(e) => setShockValue(Number(e.target.value))}
              />
            </div>
            <input
              type="range"
              className="slider"
              min={-200}
              max={200}
              value={shockValue}
              style={{ ['--fill' as string]: `${((shockValue + 200) / 400) * 100}%` }}
              onChange={(e) => setShockValue(Number(e.target.value))}
            />
            <div className="row-between small muted" style={{ marginTop: 6 }}>
              <span>−200</span>
              <span>0</span>
              <span>+200</span>
            </div>
            <p className="small muted mt-2" style={{ minHeight: 36 }}>
              {activeScenario.description}
            </p>
            <button className="btn btn-ghost btn-block" onClick={() => toggle(activeScenario.id)}>
              <IconPlus size={14} />
              {selected.has(activeScenario.id) ? 'Убрать из набора' : 'Добавить сценарий'}
            </button>
          </div>

          <div className="card">
            <div className="row-between">
              <div>
                <h3 className="card-title">Набор для расчёта</h3>
                <p className="card-sub">{selected.size} сценария · одна базовая кривая</p>
              </div>
              <span className="badge badge-accent">{selected.size}</span>
            </div>
            <div className="mt-2">
              <DataTable
                columns={[
                  {
                    key: 'name',
                    title: 'Сценарий',
                    sortValue: (s: Scenario) => s.name,
                    render: (s: Scenario) => <b>{s.name}</b>,
                  },
                  {
                    key: 'type',
                    title: 'Тип',
                    render: (s: Scenario) => <span className="badge">{TYPE_LABEL[s.scenarioTypeCode]}</span>,
                  },
                  {
                    key: 'what',
                    title: 'Что меняется',
                    render: (s: Scenario) => {
                      const shocks = s.shocks.map((x) => x.shockBps);
                      const min = Math.min(...shocks);
                      const max = Math.max(...shocks);
                      const text =
                        min === max ? `Все сроки ${fmtBps(max)}` : `от ${fmtBps(min)} до ${fmtBps(max)}`;
                      return <span className="small muted">{text}</span>;
                    },
                  },
                  {
                    key: 'remove',
                    title: '',
                    render: (s: Scenario) => (
                      <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => toggle(s.id)}>
                        <IconClose size={13} />
                      </button>
                    ),
                  },
                ]}
                rows={SCENARIOS.filter((s) => selected.has(s.id))}
                rowKey={(s: Scenario) => s.id}
              />
              {!selected.size && <div className="small muted">Набор пуст. Добавьте хотя бы один сценарий.</div>}
            </div>
            <button
              className="btn btn-primary btn-block mt-3"
              disabled={!canRun}
              onClick={() => navigate('/run')}
            >
              Запустить расчёт <IconArrowRight size={15} />
            </button>
          </div>
        </div>

        <div className="card">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title">Предпросмотр сдвига</h3>
              <p className="card-sub">Базовая (пунктир) и сценарные кривые, % годовых</p>
            </div>
          </div>
          <Visualization
            display="line"
            labels={TENORS.map((t) => t.label)}
            series={[
              ...previewSeries,
              { label: `Базовая ${fmtDate(CURVE_CURRENT.curveDate)}`, values: base, dashed: true, color: 'var(--text-3)' },
            ]}
            height={380}
            settings={{ 'graph.y_axis.format': (v) => `${Math.round(v)}%` }}
          />
          <div className="row wrap" style={{ justifyContent: 'center', gap: 18, marginTop: 8 }}>
            {previewSeries.map((s, i) => (
              <span key={s.label} className="small muted row" style={{ gap: 6 }}>
                <i
                  style={{
                    width: 14,
                    height: 3,
                    borderRadius: 2,
                    display: 'inline-block',
                    background: ['var(--accent)', 'var(--green)', 'var(--amber)'][i % 3],
                  }}
                />
                {s.label}
              </span>
            ))}
            <span className="small muted row" style={{ gap: 6 }}>
              <i style={{ width: 14, height: 0, borderTop: '2px dashed var(--text-3)', display: 'inline-block' }} />
              Базовая
            </span>
          </div>
          <div className="notice notice-info mt-3">
            Сценарные кривые предоставляются Calculator. Frontend не рассчитывает форму Twist/Curvature самостоятельно.
          </div>
        </div>
      </div>

      <div className="footer-note">Портфель: {portfolio.name} · {CALCULATION.portfolioInstrumentCount} инструмента</div>
    </AppShell>
  );
}
