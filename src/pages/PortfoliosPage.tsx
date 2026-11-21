import { useMemo, useState } from 'react';
import { AppShell, EmptyState } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { IconDownload, IconInbox, IconPlus, IconSearch } from '../components/Icons';
import { PORTFOLIOS, type Instrument } from '../data/mock';
import { navigate } from '../router';
import { fmtDate, fmtPct, fmtRub } from '../utils/format';

const TYPE_OPTIONS = [
  { value: 'all', label: 'Все типы' },
  { value: 'ofz', label: 'ОФЗ' },
  { value: 'municipal', label: 'Муниципальные' },
  { value: 'corporate', label: 'Корпоративные' },
  { value: 'deposit', label: 'Депозиты' },
];

export function PortfoliosPage() {
  const [portfolioId, setPortfolioId] = useState(PORTFOLIOS[0].id);
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState('');

  const portfolio = PORTFOLIOS.find((p) => p.id === portfolioId) ?? PORTFOLIOS[0];

  const filtered = useMemo(
    () =>
      portfolio.instruments.filter((i) => {
        if (typeFilter !== 'all' && i.instrumentTypeCode !== typeFilter) return false;
        if (query) {
          const q = query.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.instrumentCode.toLowerCase().includes(q);
        }
        return true;
      }),
    [portfolio, typeFilter, query],
  );

  const columns: Column<Instrument>[] = [
    {
      key: 'name',
      title: 'Инструмент',
      sortValue: (i) => i.name,
      render: (i) => (
        <div>
          <div style={{ fontWeight: 600 }}>{i.name}</div>
          <div className="small muted num">{i.instrumentCode}</div>
        </div>
      ),
    },
    {
      key: 'nominal',
      title: 'Номинал, ₽',
      align: 'right',
      sortValue: (i) => i.nominalRub,
      render: (i) => <span className="num">{fmtRub(i.nominalRub)}</span>,
    },
    {
      key: 'rate',
      title: 'Ставка, %',
      align: 'right',
      sortValue: (i) => i.interestRatePct ?? -1,
      render: (i) => <span className="num">{i.interestRatePct != null ? fmtPct(i.interestRatePct) : 'Нет данных'}</span>,
    },
    {
      key: 'price',
      title: 'Рыночная цена, %',
      align: 'right',
      sortValue: (i) => i.marketPricePct ?? -1,
      render: (i) => (
        <span className="num">{i.marketPricePct != null ? String(i.marketPricePct).replace('.', ',') + ' %' : 'Нет данных'}</span>
      ),
    },
    {
      key: 'action',
      title: '',
      render: (i) => (
        <button
          className="link"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/portfolios/${portfolio.id}/${i.id}`);
          }}
        >
          Открыть →
        </button>
      ),
    },
  ];

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Портфели',
        title: 'Портфели',
        actions: (
          <button className="btn btn-primary btn-sm">
            <IconPlus size={14} /> Новый портфель
          </button>
        ),
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Портфели организации</h1>
          <p className="sub">Выберите портфель, чтобы увидеть состав. Клик по строке открывает карточку инструмента.</p>
        </div>
      </div>

      <div className="grid grid-3">
        {PORTFOLIOS.map((p) => {
          const total = p.instruments.reduce((s, i) => s + i.nominalRub, 0);
          const active = p.id === portfolioId;
          return (
            <div
              key={p.id}
              className="card kpi card-hover"
              style={active ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : undefined}
              onClick={() => setPortfolioId(p.id)}
            >
              <span className="kpi-label">{p.name}</span>
              <span className="kpi-value num">{(total / 1e6).toFixed(2).replace('.', ',')} млн ₽</span>
              <span className="kpi-sub">
                {p.instruments.length} инструментов · Обновлён {fmtDate(p.updatedAt)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="row wrap" style={{ marginBottom: 16, gap: 10 }}>
          <div className="search-input grow" style={{ minWidth: 220 }}>
            <IconSearch size={14} />
            <input
              className="input"
              placeholder="Поиск по названию или ISIN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 190 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm">
            <IconDownload size={14} /> Импорт CSV
          </button>
        </div>

        {filtered.length ? (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(i) => i.id}
            onRowClick={(i) => navigate(`/portfolios/${portfolio.id}/${i.id}`)}
          />
        ) : (
          <EmptyState
            icon={<IconInbox />}
            title="Инструменты не найдены"
            hint="Попробуйте изменить фильтры или поисковый запрос."
          />
        )}
      </div>

      <div className="footer-note">Демонстрационные данные · {fmtDate(portfolio.updatedAt)}</div>
    </AppShell>
  );
}
