import { AppShell } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { IconArrowRight, IconDownload } from '../components/Icons';
import { ImpactBars } from '../components/ImpactBars';
import { NPV_IMPACT_ROWS, PORTFOLIOS, type Instrument } from '../data/mock';
import { navigate, useHashRoute } from '../router';
import { fmtBps, fmtDate, fmtDeltaRub, fmtPct } from '../utils/format';

const CASH_FLOW_COLUMNS: Column<{ date: string; type: string; amountRub: number }>[] = [
  {
    key: 'date',
    title: 'Дата',
    sortValue: (r) => r.date,
    render: (r) => <span className="num">{fmtDate(r.date)}</span>,
  },
  {
    key: 'type',
    title: 'Тип платежа',
    render: (r) => r.type,
  },
  {
    key: 'amount',
    title: 'Сумма, ₽',
    align: 'right',
    sortValue: (r) => r.amountRub,
    render: (r) => <span className="num">{fmtDeltaRub(r.amountRub)}</span>,
  },
];

export function InstrumentCardPage() {
  const route = useHashRoute();
  const [, portfolioId, instrumentId] = route.split('/');
  const portfolio = PORTFOLIOS.find((p) => p.id === portfolioId) ?? PORTFOLIOS[0];
  const instrument: Instrument | undefined =
    portfolio.instruments.find((i) => i.id === instrumentId) ?? portfolio.instruments[0];

  const flows = [
    { date: '2026-12-15', type: 'Купонный платёж', amountRub: 260510 },
    { date: '2027-06-15', type: 'Купонный платёж', amountRub: 260510 },
    { date: '2043-05-15', type: 'Погашение номинала', amountRub: instrument.nominalRub },
  ];

  const kv = (k: string, v: string) => (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );

  return (
    <AppShell
      crumb={{
        section: `Рабочая область / Портфели / ${portfolio.name}`,
        title: instrument.name,
        actions: (
          <button className="btn btn-ghost btn-sm">
            <IconDownload size={14} /> Экспорт
          </button>
        ),
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">{instrument.name}</h1>
          <p className="sub">
            {portfolio.name} · {instrument.instrumentCode} · {instrument.status === 'active' ? 'активен' : 'исключён'}
          </p>
        </div>
        <div className="row wrap">
          <span className="badge badge-accent">ОФЗ-ПД</span>
          <span className="badge">{instrument.maturityDate ? `Погашение ${fmtDate(instrument.maturityDate)}` : 'Бессрочный'}</span>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card kpi">
          <span className="kpi-label">Рыночная стоимость</span>
          <span className="kpi-value num">{(instrument.nominalRub / 1e6).toFixed(2).replace('.', ',')} млн ₽</span>
          <span className="kpi-sub">12 000 облигаций</span>
        </div>
        <div className="card kpi kpi-featured">
          <span className="kpi-label">Доходность к погашению</span>
          <span className="kpi-value num">16,84 %</span>
          <span className="kpi-sub">По рыночной цене</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Модиф. дюрация</span>
          <span className="kpi-value num">7,82</span>
          <span className="kpi-sub">Чувствительность к ставке</span>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3 className="card-title">Параметры инструмента</h3>
          <p className="card-sub">Характеристики выпуска из справочника</p>
          <div className="mt-1">
            {kv('Эмитент', 'Министерство финансов РФ')}
            {kv('Выпуск', '15 мая 2023')}
            {kv('Погашение', instrument.maturityDate ? fmtDate(instrument.maturityDate) : '—')}
            {kv('Номинал', '1 000 ₽')}
            {kv('Купон', instrument.interestRatePct != null ? `${fmtPct(instrument.interestRatePct)} годовых, 2 раза в год` : 'Нет данных')}
            {kv('Рыночная цена', instrument.marketPricePct != null ? `${String(instrument.marketPricePct).replace('.', ',')} %` : 'Нет данных')}
            {kv('НКД на облигацию', instrument.accruedCouponRub != null ? fmtDeltaRub(instrument.accruedCouponRub) : '—')}
            {kv('Мод. дюрация', '7,82')}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Влияние на NPV</h3>
          <p className="card-sub">Изменение стоимости при сдвиге базовой кривой</p>
          <div className="mt-3">
            <ImpactBars
              rows={NPV_IMPACT_ROWS.map((r) => ({ label: fmtBps(r.shockBps), value: r.deltaRub / 1e6 }))}
              format={(v) => {
                const sign = v > 0 ? '+' : v < 0 ? '−' : '';
                return `${sign}${Math.abs(v).toFixed(2).replace('.', ',')} млн ₽`;
              }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <h3 className="card-title">Денежные потоки</h3>
            <p className="card-sub">Ближайшие выплаты по позиции</p>
          </div>
        </div>
        <div className="mt-2">
          <DataTable columns={CASH_FLOW_COLUMNS} rows={flows} rowKey={(r) => r.date + r.type} pageSize={10} />
        </div>
      </div>

      <div className="card row-between">
        <div className="small muted">
          Оценка чувствительности носит демонстрационный характер. Расчёт выполняется модулем Calculator.
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/results/detail')}>
          К детализации <IconArrowRight size={14} />
        </button>
      </div>

      <div className="footer-note">Демонстрационные данные · 29.10.2026</div>
    </AppShell>
  );
}
