import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { IconArrowRight } from '../components/Icons';
import { CALCULATION, CURVE_CURRENT, PORTFOLIOS } from '../data/mock';
import { navigate } from '../router';
import { fmtDate } from '../utils/format';

const CHECKS = [
  { label: 'Портфель и позиции', value: `${CALCULATION.portfolioInstrumentCount} из 24` },
  { label: 'Базовая кривая', value: '12 точек' },
  { label: 'Сценарии сдвигов', value: '3 сценария' },
  { label: 'Параметры инструментов', value: 'Загружено' },
  { label: 'Денежные потоки', value: 'Доступно' },
];

interface JournalRow {
  time: string;
  event: string;
  status: string;
}

const JOURNAL: JournalRow[] = [
  { time: '15:44:03', event: 'Проверка входных данных', status: 'Готово' },
  { time: '15:44:05', event: 'Передача задания в Calculator', status: 'Готово' },
  { time: '15:44:09', event: 'Оценка базового NPV', status: 'Готово' },
  { time: '15:44:25', event: 'Расчёт сценариев NPV', status: 'Выполняется' },
];

export function RunCalculationPage() {
  const portfolio = PORTFOLIOS.find((p) => p.id === CALCULATION.portfolioId) ?? PORTFOLIOS[0];
  const [progress, setProgress] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setProgress((p) => {
        const next = p + 2;
        if (next >= 100 && timer.current) clearInterval(timer.current);
        return Math.min(next, 100);
      });
    }, 120);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const done = progress >= 100;
  const scenarioNo = done ? 3 : Math.min(3, Math.floor(progress / 34) + 1);
  const estimatedLeft = Math.max(1, Math.round(((100 - progress) / 100) * 20));

  const journalColumns: Column<JournalRow>[] = [
    { key: 'time', title: 'Время', render: (r) => <span className="num">{r.time}</span> },
    { key: 'event', title: 'Событие', render: (r) => r.event },
    {
      key: 'status',
      title: 'Статус',
      render: (_r, i) =>
        done || i < JOURNAL.length - 1 ? (
          <span className="badge badge-green">
            <span className="dot" /> Готово
          </span>
        ) : (
          <span className="badge badge-amber">Выполняется</span>
        ),
    },
  ];

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Сценарии сдвигов / Запуск расчёта',
        title: 'Запуск расчёта',
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Запуск расчёта</h1>
          <p className="sub">
            Проверяем данные, передаём задание в Calculator и отслеживаем выполнение.
          </p>
        </div>
      </div>

      <div className="steps">
        <span className="step done">
          <span className="step-n">✓</span> 1 · Выбор портфеля
        </span>
        <span className="step done">
          <span className="step-n">✓</span> 2 · Настройка сценариев
        </span>
        <span className={`step ${done ? 'done' : 'active'}`}>
          <span className="step-n">{done ? '✓' : '3'}</span> 3 · Расчёт
        </span>
        <span className={`step ${done ? 'active' : ''}`}>
          <span className="step-n">4</span> 4 · Результаты
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3 className="card-title">Проверка входных данных</h3>
          <p className="card-sub">
            {portfolio.name} · Базовая кривая {fmtDate(CURVE_CURRENT.curveDate)}, MOEX
          </p>
          <div className="mt-2">
            {CHECKS.map((c) => (
              <div className="kv" key={c.label}>
                <span className="k">
                  <span className="pos" style={{ marginRight: 6 }}>
                    ✓
                  </span>
                  {c.label}
                </span>
                <span className="v num">{c.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="row-between">
            <div>
              <h3 className="card-title">{done ? 'Расчёт завершён' : 'Расчёт выполняется'}</h3>
              <p className="card-sub">
                Задание № {CALCULATION.number} · передано в Calculator
              </p>
            </div>
            <span className={`run-percent num ${done ? 'pos' : ''}`}>{progress}%</span>
          </div>
          <div className="progress" style={{ marginTop: 12 }}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="small muted mt-2">
            {done
              ? 'Все сценарии обработаны, сводка ЭКпрбк сформирована.'
              : `Обрабатываем сценарий ${scenarioNo} из 3 · осталось ≈${estimatedLeft} с`}
          </p>
          <div className="row mt-2" style={{ gap: 10, justifyContent: 'flex-end' }}>
            {done ? (
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/results')}>
                Открыть результаты <IconArrowRight size={14} />
              </button>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/scenarios')}>
                  Отменить расчёт
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Журнал выполнения</h3>
        <p className="card-sub">Ход выполнения задания {CALCULATION.number}</p>
        <div className="mt-2">
          <DataTable columns={journalColumns} rows={JOURNAL} rowKey={(r) => r.time + r.event} pageSize={10} />
        </div>
      </div>

      <div className="footer-note">GCURVE / Анализ процентного риска</div>
    </AppShell>
  );
}
