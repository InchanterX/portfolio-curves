import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { navigate } from '../router';
import { CURVE_CURRENT, TENORS } from '../data/mock';
import { fmtDate } from '../utils/format';
import { Visualization } from '../visualizations/Visualization';
import { IconArrowRight, IconLogo, IconMail } from '../components/Icons';

/* ---------- shared auth frame: hero + card (макет 01–04) ---------- */

function AuthLayout({ children, help }: { children: ReactNode; help?: string }) {
  return (
    <div className="auth-wrap">
      <div className="auth-glow" />
      <div className="auth-split">
        <div className="auth-hero">
          <div className="sidebar-logo">
            <IconLogo />
            GCURVE
          </div>
          <span className="landing-pill">Платформа аналитики ОФЗ</span>
          <h1 className="landing-h1">
            Видеть кривую.
            <br />
            <span className="accent-text">Понимать риск.</span>
            <br />
            Принимать решения.
          </h1>
          <p className="landing-lead">
            Рыночные данные, сценарии сдвигов и оценка портфеля в едином рабочем пространстве.
          </p>
          <div className="card auth-hero-chart">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>Кривая бескупонной доходности</div>
                <div className="small muted">Базовая кривая · {fmtDate(CURVE_CURRENT.curveDate)}</div>
              </div>
              <span className="badge badge-green">
                <span className="dot" /> Подключено
              </span>
            </div>
            <Visualization
              display="line"
              labels={TENORS.map((t) => t.label)}
              series={[{ label: 'Доходность', values: CURVE_CURRENT.points.map((p) => p.yieldPct) }]}
              height={190}
              settings={{ 'graph.y_axis.format': (v) => `${v.toFixed(0)}%` }}
            />
            <div
              className="small muted"
              style={{ textAlign: 'center', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}
            >
              Банк России / MOEX / Сценарный анализ
            </div>
          </div>
        </div>
        <div className="auth-card">
          <div className="sidebar-logo" style={{ padding: '0 0 24px' }}>
            <IconLogo />
            GCURVE
          </div>
          {children}
        </div>
      </div>
      <div className="auth-help">{help ?? 'Нужна помощь? support@gcurve.ru'}</div>
    </div>
  );
}

/* ---------- landing ---------- */

export function Landing() {
  return (
    <div className="landing">
      <div className="landing-top">
        <IconLogo />
        GCURVE
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>
          Войти
        </button>
      </div>
      <div className="landing-hero">
        <div>
          <span className="landing-pill">Платформа аналитики ОФЗ</span>
          <h1 className="landing-h1">
            Видеть кривую.
            <br />
            <span className="accent-text">Понимать риск.</span>
            <br />
            Принимать решения.
          </h1>
          <p className="landing-lead">
            Рыночные данные, сценарии сдвигов и оценка портфеля в едином рабочем пространстве.
          </p>
          <div className="landing-cta">
            <button className="btn btn-primary" onClick={() => navigate('/register')}>
              Начать работу <IconArrowRight size={15} />
            </button>
            <button className="btn btn-outline" onClick={() => navigate('/login')}>
              Войти в аккаунт
            </button>
          </div>
          <div className="landing-note">Демонстрационные данные · {fmtDate(CURVE_CURRENT.curveDate)}</div>
        </div>
        <div className="landing-chart-card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Кривая бескупонной доходности</div>
              <div className="small muted">Базовая кривая · {fmtDate(CURVE_CURRENT.curveDate)}</div>
            </div>
            <span className="badge badge-green">
              <span className="dot" /> Подключено
            </span>
          </div>
          <Visualization
            display="line"
            labels={TENORS.map((t) => t.label)}
            series={[{ label: 'Доходность', values: CURVE_CURRENT.points.map((p) => p.yieldPct) }]}
            height={240}
            settings={{ 'graph.y_axis.format': (v) => `${v.toFixed(0)}%` }}
          />
          <div
            className="small muted"
            style={{ textAlign: 'center', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
          >
            Банк России / MOEX / Сценарный анализ
          </div>
        </div>
      </div>
      <div className="landing-foot">GCURVE / Анализ процентного риска</div>
    </div>
  );
}

/* ---------- login ---------- */

export function Login() {
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigate('/overview');
  };
  return (
    <AuthLayout>
      <h2 className="auth-title">С возвращением</h2>
      <p className="auth-sub">Войдите в свою рабочую область.</p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label className="label">Рабочая почта</label>
          <input className="input" type="email" defaultValue="sonya@company.ru" required />
        </div>
        <div className="field">
          <label className="label">Пароль</label>
          <input className="input" type="password" defaultValue="••••••••••" required />
        </div>
        <div className="checkbox-row">
          <label>
            <input type="checkbox" defaultChecked /> Запомнить меня
          </label>
          <button type="button" className="link" onClick={() => navigate('/recovery')}>
            Забыли пароль?
          </button>
        </div>
        <button className="btn btn-primary btn-block" type="submit">
          Войти <IconArrowRight size={15} />
        </button>
      </form>
      <div className="auth-foot">
        Нет аккаунта?{' '}
        <button className="link" onClick={() => navigate('/register')}>
          Зарегистрироваться
        </button>
      </div>
    </AuthLayout>
  );
}

/* ---------- register ---------- */

export function Register() {
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigate('/confirm-email');
  };
  return (
    <AuthLayout>
      <h2 className="auth-title">Создать аккаунт</h2>
      <p className="auth-sub">Один шаг до рабочей области аналитики ОФЗ.</p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label className="label">Имя и фамилия</label>
          <input className="input" type="text" placeholder="Соня Иванова" required />
        </div>
        <div className="field">
          <label className="label">Рабочая почта</label>
          <input className="input" type="email" placeholder="you@company.ru" required />
        </div>
        <div className="field">
          <label className="label">Пароль</label>
          <input className="input" type="password" placeholder="Минимум 8 символов" required minLength={8} />
        </div>
        <div className="field">
          <label className="label">Повторите пароль</label>
          <input className="input" type="password" placeholder="Повторите пароль" required minLength={8} />
        </div>
        <div className="checkbox-row" style={{ justifyContent: 'flex-start' }}>
          <label>
            <input type="checkbox" required /> Я принимаю условия использования
          </label>
        </div>
        <button className="btn btn-primary btn-block" type="submit">
          Создать аккаунт <IconArrowRight size={15} />
        </button>
      </form>
      <div className="auth-foot">
        Уже есть аккаунт?{' '}
        <button className="link" onClick={() => navigate('/login')}>
          Войти
        </button>
      </div>
    </AuthLayout>
  );
}

/* ---------- confirm email ---------- */

export function ConfirmEmail() {
  const [seconds, setSeconds] = useState(48);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [seconds]);

  return (
    <AuthLayout>
      <h2 className="auth-title">Подтвердите почту</h2>
      <p className="auth-sub">Остался один шаг до начала работы.</p>
      <div className="mail-icon">
        <IconMail size={26} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 18px' }}>
        Мы отправили письмо на <b style={{ color: 'var(--text)' }}>sonya@company.ru</b>
        <br />
        Перейдите по ссылке в письме, чтобы активировать аккаунт.
      </p>
      <button className="btn btn-ghost btn-block" disabled={seconds > 0} onClick={() => setSeconds(48)}>
        {seconds > 0 ? `Отправить повторно · 00:${String(seconds).padStart(2, '0')}` : 'Отправить повторно'}
      </button>
      <div className="auth-foot">
        <button className="link">Изменить адрес почты</button>
      </div>
    </AuthLayout>
  );
}

/* ---------- recovery ---------- */

export function Recovery() {
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout>
      <h2 className="auth-title">Восстановление доступа</h2>
      <p className="auth-sub">Отправим ссылку для сброса пароля.</p>
      {sent ? (
        <div className="notice notice-info" style={{ marginBottom: 16 }}>
          Если такой аккаунт существует, ссылка для сброса пароля будет отправлена на указанную
          почту. Проверьте входящие и папку «Спам».
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
        >
          <div className="field">
            <label className="label">Рабочая почта</label>
            <input className="input" type="email" defaultValue="sonya@company.ru" required />
          </div>
          <button className="btn btn-primary btn-block" type="submit">
            Отправить ссылку
          </button>
        </form>
      )}
      <div className="auth-foot">
        <button className="link" onClick={() => navigate('/login')}>
          ← Вернуться ко входу
        </button>
      </div>
    </AuthLayout>
  );
}
