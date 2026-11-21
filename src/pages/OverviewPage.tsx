import { useState } from 'react';
import { useApi } from '../api/client';
import { AppShell } from '../components/AppShell';
import { DataTable } from '../components/DataTable';
import { IconArrowRight, IconDownload } from '../components/Icons';
import { CURVE_CURRENT, CURVE_PREVIOUS, TENORS } from '../data/mock';
import { navigate } from '../router';
import { useDataset } from '../lib/query/useDataset';
import { QUESTIONS } from '../lib/query/questions';
import { Visualization } from '../visualizations/Visualization';
import { fmtDate, fmtMlnDelta, fmtPct, fmtPp, fmtTime } from '../utils/format';

const KEY_TENORS = ['3M', '1Y', '10Y', '30Y'];

export function OverviewPage() {
  const [tab, setTab] = useState<'chart' | 'table' | 'compare'>('chart');
  const { data: curve } = useApi('/curves/current', CURVE_CURRENT);
  // «Вопросы» Metabase: dataset сформирован декларативно, форматирование — по колонкам
  const { dataset: pointsDataset } = useDataset(QUESTIONS.curvePoints);
  const { dataset: compareDataset } = useDataset(QUESTIONS.curveCompare);
  const anchor = curve.points.find((p) => p.tenorCode === '10Y');
  const keyPoints = curve.points.filter((p) => KEY_TENORS.includes(p.tenorCode));
  const maxYield = Math.max(...keyPoints.map((p) => p.yieldPct ?? 0), 1);

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Обзор кривой',
        title: 'Обзор кривой',
        actions: (
          <>
            <button className="btn btn-ghost btn-sm">
              <IconDownload size={14} /> Экспорт
            </button>
          </>
        ),
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Бескупонная доходность ОФЗ</h1>
          <p className="sub">
            Базовая кривая · {fmtDate(curve.curveDate)} · обновлено {fmtTime(curve.fetchedAt)} (МСК)
          </p>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === 'chart' ? 'active' : ''}`} onClick={() => setTab('chart')}>
            Обзор
          </button>
          <button className={`tab ${tab === 'table' ? 'active' : ''}`} onClick={() => setTab('table')}>
            Таблица
          </button>
          <button className={`tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>
            Сравнение
          </button>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi kpi-featured">
          <span className="kpi-label">Доходность · 10 лет</span>
          <span className="kpi-value lg num">{anchor?.yieldPct !== null && anchor ? fmtPct(anchor.yieldPct) : 'Нет данных'}</span>
          <span className="kpi-sub num">{anchor?.changePp != null ? `${fmtPp(anchor.changePp)} к ${fmtDate('2026-10-28')}` : ''}</span>
        </div>
        {(['3M', '1Y', '5Y'] as const).map((code) => {
          const p = curve.points.find((x) => x.tenorCode === code);
          const t = TENORS.find((x) => x.code === code);
          return (
            <div className="card kpi" key={code}>
              <span className="kpi-label">Доходность · {t?.label}</span>
              <span className="kpi-value num">{p?.yieldPct != null ? fmtPct(p.yieldPct) : 'Нет данных'}</span>
              <span className="kpi-sub num">
                {p?.changePp != null ? (
                  <span className={p.changePp > 0 ? 'pos' : p.changePp < 0 ? 'neg' : 'muted'}>{fmtPp(p.changePp)}</span>
                ) : (
                  'Нет данных'
                )}
              </span>
            </div>
          );
        })}
      </div>

      {tab === 'chart' ? (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title">Кривая доходности</h3>
              <p className="card-sub">Доходность, % годовых — срок до погашения</p>
            </div>
            <span className="badge badge-green">
              <span className="dot" /> Источник подключён
            </span>
          </div>
          <Visualization
            display="line"
            labels={TENORS.map((t) => t.label)}
            series={[
              { label: '29.10.2026', values: curve.points.map((p) => p.yieldPct) },
              { label: '28.10.2026', values: curve.points.map((p) => (p.yieldPct !== null ? p.yieldPct - (p.changePp ?? 0) : null)), dashed: true, color: 'var(--text-3)' },
            ]}
            height={300}
            settings={{ 'graph.y_axis.format': (v) => `${Math.round(v)}%` }}
          />
          <div className="row" style={{ justifyContent: 'center', gap: 22, marginTop: 6 }}>
            <span className="small muted row" style={{ gap: 6 }}>
              <i style={{ width: 14, height: 3, background: 'var(--accent)', borderRadius: 2, display: 'inline-block' }} />
              {fmtDate(curve.curveDate)}
            </span>
            <span className="small muted row" style={{ gap: 6 }}>
              <i style={{ width: 14, height: 0, borderTop: '2px dashed var(--text-3)', display: 'inline-block' }} />
              {fmtDate('2026-10-28')}
            </span>
          </div>
        </div>
      ) : tab === 'table' ? (
        <DataTable dataset={pointsDataset} pageSize={20} />
      ) : (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title">Изменение формы кривой</h3>
              <p className="card-sub">Бескупонная доходность, % годовых. Базовая дата — {fmtDate(curve.curveDate)}.</p>
            </div>
          </div>
          <Visualization
            display="line"
            labels={TENORS.map((t) => t.label)}
            series={[
              { label: fmtDate(curve.curveDate), values: curve.points.map((p) => p.yieldPct) },
              { label: fmtDate(CURVE_PREVIOUS.curveDate), values: CURVE_PREVIOUS.points.map((p) => p.yieldPct), dashed: true, color: 'var(--text-3)' },
            ]}
            height={280}
            settings={{ 'graph.y_axis.format': (v) => `${Math.round(v)}%` }}
          />
          <div className="mt-2">
            <DataTable dataset={compareDataset} pageSize={20} />
          </div>
        </div>
      )}

      <div className="grid grid-3">
        <div className="card col-span-2">
          <h3 className="card-title">Точки кривой</h3>
          <p className="card-sub">Приблизительные значения на {fmtDate(curve.curveDate)}</p>
          <div className="mt-2">
            <DataTable dataset={pointsDataset} pageSize={10} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h3 className="card-title">Ключевые сроки</h3>
            <p className="card-sub">Доходность по основным точкам кривой</p>
            <div className="mt-2">
              {keyPoints.map((p) => {
                const t = TENORS.find((x) => x.code === p.tenorCode);
                return (
                  <div className="tenor-row" key={p.tenorCode}>
                    <span className="small muted">{t?.label}</span>
                    <div className="tenor-track">
                      <div className="tenor-fill" style={{ width: `${((p.yieldPct ?? 0) / maxYield) * 100}%` }} />
                    </div>
                    <span className="small num" style={{ textAlign: 'right' }}>
                      {p.yieldPct != null ? fmtPct(p.yieldPct) : 'Нет данных'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="eyebrow">Последний расчёт</div>
            <div className="h2 num neg" style={{ marginTop: 4 }}>{fmtMlnDelta(-2.46)}</div>
            <div className="small muted mt-1">Расчёт № 0248 · ОФЗ · Основной · −1,92 % от базового NPV</div>
            <button className="btn btn-ghost btn-sm mt-2" onClick={() => navigate('/results')}>
              Открыть результаты <IconArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="footer-note">GCURVE / Анализ процентного риска · Демонстрационные данные</div>
    </AppShell>
  );
}
