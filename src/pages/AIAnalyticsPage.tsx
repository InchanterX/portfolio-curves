import { AppShell } from '../components/AppShell';
import { IconArrowRight, IconSparkle } from '../components/Icons';
import { CALCULATION, LLM_ANALYSIS } from '../data/mock';
import { navigate } from '../router';
import { fmtMln, fmtMlnDelta } from '../utils/format';

export function AIAnalyticsPage() {
  if (LLM_ANALYSIS.status !== 'succeeded') {
    return (
      <AppShell
        crumb={{
          section: 'Рабочая область / AI-аналитика',
          title: 'AI-аналитика',
        }}
      >
        <div className="page-head">
          <div>
            <h1 className="h1">AI-аналитика</h1>
            <p className="sub">Интерпретация результатов и факторов риска.</p>
          </div>
        </div>
        <div className="card empty">
          <div className="empty-icon">
            <IconSparkle size={22} />
          </div>
          <div style={{ fontWeight: 600 }}>Анализ недоступен</div>
          <div className="small muted">LLM-модуль не ответил. Результаты Calculator и их экспорт остаются доступны.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / AI-аналитика',
        title: 'AI-аналитика',
        actions: (
          <button className="btn btn-primary btn-sm">
            <IconSparkle size={14} /> Запустить анализ
          </button>
        ),
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">AI-аналитика</h1>
          <p className="sub">
            Интерпретация результатов и факторов риска. Выводы не изменяют и не пересчитывают результаты Calculator.
          </p>
        </div>
        <span className="badge badge-accent">Расчёт № {CALCULATION.number}</span>
      </div>

      <div className="card row-between">
        <div className="row" style={{ gap: 14 }}>
          <span className="logo-mark" style={{ width: 36, height: 36 }}>
            <IconSparkle size={18} />
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>Анализ завершён</div>
            <div className="small muted">
              {CALCULATION.summary?.scenariosTotal} сценария · {CALCULATION.portfolioInstrumentCount} инструмента
              на основе расчёта № {CALCULATION.number} · {LLM_ANALYSIS.model}
            </div>
          </div>
        </div>
        <span className="badge badge-green">
          <span className="dot" /> Готово
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <div className="card">
          <h3 className="card-title">Что влияет на результат</h3>
          <p className="card-sub">Факторы ранжированы по вкладу в изменение NPV</p>
          <div className="mt-2">
            {LLM_ANALYSIS.factors.map((f, i) => (
              <div className="list-row" key={i} style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  <span
                    className="num"
                    style={{
                      fontWeight: 700,
                      color: 'var(--accent-2)',
                      background: 'var(--accent-soft)',
                      borderRadius: 8,
                      width: 30,
                      height: 30,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{f.title}</div>
                    <div className="small muted" style={{ maxWidth: 720, marginTop: 2 }}>
                      {f.detail}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Основания анализа</h3>
          <p className="card-sub">Данные, на которых построен вывод</p>
          <div className="mt-2">
            <div className="kv">
              <span className="k">Базовая оценка</span>
              <span className="v">Банк России · 29.10</span>
            </div>
            <div className="kv">
              <span className="k">Базовый NPV</span>
              <span className="v num">{fmtMln(CALCULATION.baseNpvMln)}</span>
            </div>
            <div className="kv">
              <span className="k">Сценарий к NPV</span>
              <span className="v num neg">{fmtMlnDelta(-2.46)}</span>
            </div>
            <div className="kv">
              <span className="k">Позиций в данных</span>
              <span className="v num">24 из 24</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Что проверить дальше</h3>
        <p className="card-sub">Типовые шаги после анализа риска</p>
        <div className="row wrap mt-2" style={{ gap: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/results/detail')}>
            Все инструменты <IconArrowRight size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/results')}>
            Сравнение сценариев <IconArrowRight size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/portfolios/pfz-main/i1')}>
            Карточка ОФЗ 26238 <IconArrowRight size={14} />
          </button>
        </div>
        <p className="small muted mt-2">
          Выводы сформированы автоматически и не заменяют расчёт Calculator. Проверяйте ключевые цифры по
          исходным результатам.
        </p>
      </div>

      <div className="footer-note">GCURVE / Анализ процентного риска · Демонстрационные данные</div>
    </AppShell>
  );
}
