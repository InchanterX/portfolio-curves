import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { IconPlus } from '../components/Icons';
import { CURRENCIES, ROLE_LABELS, SOURCES, SOURCE_STATUS_LABELS, USERS } from '../data/mock';
import { useTheme, type Theme } from '../theme';
import { fmtDate } from '../utils/format';

type Tab = 'profile' | 'appearance' | 'sources' | 'users';

const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Профиль' },
  { key: 'appearance', label: 'Внешний вид' },
  { key: 'sources', label: 'Источники данных' },
  { key: 'users', label: 'Пользователи и роли' },
];

const STATUS_BADGE: Record<string, string> = {
  connected: 'badge-green',
  no_connection: 'badge-red',
  stale: 'badge-amber',
  error: 'badge-red',
};

const MARKET_SOURCES = ['cbr', 'moex'];

const ROLE_PERMISSIONS: { permission: string; admin: boolean; analyst: boolean; viewer: boolean }[] = [
  { permission: 'Просмотр данных и отчётов', admin: true, analyst: true, viewer: true },
  { permission: 'Запуск расчётов и сценариев', admin: true, analyst: true, viewer: false },
  { permission: 'Управление пользователями и ролями', admin: true, analyst: false, viewer: false },
  { permission: 'Изменение параметров подключения', admin: true, analyst: false, viewer: false },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile');
  const { theme, setTheme } = useTheme();

  const [saved, setSaved] = useState(false);
  const onSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const themeOption = (value: Theme, label: string) => (
    <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
      <input type="radio" name="theme" checked={theme === value} onChange={() => setTheme(value)} />
      {label}
    </label>
  );

  return (
    <AppShell
      crumb={{
        section: 'Рабочая область / Настройки',
        title: 'Настройки',
      }}
    >
      <div className="page-head">
        <div>
          <h1 className="h1">Настройки</h1>
          <p className="sub">Профиль, внешний вид и подключённые источники данных.</p>
        </div>
      </div>

      <div className="tabs-block">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
          <div className="card">
            <h3 className="card-title">Профиль пользователя</h3>
            <p className="card-sub">Данные учётной записи в организации</p>
            <div className="row mt-2" style={{ gap: 14, alignItems: 'center' }}>
              <span className="avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
                СИ
              </span>
              <button className="btn btn-ghost btn-sm">Изменить фото</button>
            </div>
            <div className="mt-2">
              <div className="kv">
                <span className="k">Имя</span>
                <span className="v">Соня Иванова</span>
              </div>
              <div className="kv">
                <span className="k">Почта</span>
                <span className="v">sonya@company.ru</span>
              </div>
              <div className="kv">
                <span className="k">Организация</span>
                <span className="v">ООО «ГКАПИТАЛ»</span>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              {saved && <span className="small pos">Сохранено</span>}
              <button className="btn btn-primary btn-sm" onClick={onSave}>
                Изменить
              </button>
            </div>
          </div>
          <div className="card">
            <h3 className="card-title">Безопасность</h3>
            <p className="card-sub">Пароль и активные сессии</p>
            <div className="mt-2">
              <div className="kv">
                <span className="k">Пароль</span>
                <span className="v muted">Последняя смена · 12 октября 2026</span>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm mt-2">Изменить пароль</button>
            <hr className="divider" />
            <div className="kv">
              <span className="k">Активные сессии</span>
              <span className="v">Windows 11 · Москва, Россия</span>
            </div>
            <button className="btn btn-ghost btn-sm mt-2">Завершить другие сессии</button>
          </div>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
          <div className="card">
            <h3 className="card-title">Оформление интерфейса</h3>
            <p className="card-sub">Настройка темы применяется ко всем разделам</p>
            <div className="grid grid-3 mt-2">
              <div className={`theme-preview ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
                <div className="tp-top tp-light">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="tp-body tp-light">
                  <div className="tp-side" />
                  <div className="tp-main">
                    <div className="tp-block" />
                    <div className="tp-line" />
                    <div className="tp-line" style={{ width: '45%' }} />
                  </div>
                </div>
              </div>
              <div className={`theme-preview ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
                <div className="tp-top tp-dark">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="tp-body tp-dark">
                  <div className="tp-side" />
                  <div className="tp-main">
                    <div className="tp-block" />
                    <div className="tp-line" />
                    <div className="tp-line" style={{ width: '45%' }} />
                  </div>
                </div>
              </div>
              <div className={`theme-preview ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')}>
                <div className="tp-top tp-dark">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="tp-body tp-light">
                  <div className="tp-side" />
                  <div className="tp-main">
                    <div className="tp-block" />
                    <div className="tp-line" />
                    <div className="tp-line" style={{ width: '45%' }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="row mt-2" style={{ gap: 24 }}>
              {themeOption('light', 'Светлая')}
              {themeOption('dark', 'Тёмная')}
              {themeOption('system', 'Как в системе')}
            </div>
          </div>
          <div className="card">
            <h3 className="card-title">Параметры отображения</h3>
            <p className="card-sub">Единицы и формат значений</p>
            <div className="field mt-2">
              <label className="label">Формат чисел</label>
              <select className="select" defaultValue="ru">
                <option value="ru">Россия · 1 234,56</option>
                <option value="us">США · 1,234.56</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Валюта отображения</label>
              <select className="select" defaultValue="RUB">
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="small muted">128 400 000,00 ₽ · 16,52 % · 29.10.2026</p>
          </div>
        </div>
      )}

      {tab === 'sources' && (
        <div className="card">
          <div className="row-between">
            <div>
              <h3 className="card-title">Подключённые источники</h3>
              <p className="card-sub">Доступность данных и время последнего успешного обновления</p>
            </div>
          </div>
          <div className="mt-1">
            {SOURCES.filter((s) => MARKET_SOURCES.includes(s.sourceCode)).map((s) => (
              <div className="list-row" key={s.sourceCode}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="small muted">{s.detail}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`badge ${STATUS_BADGE[s.status]}`}>
                    <span className="dot" /> {SOURCE_STATUS_LABELS[s.status]}
                  </span>
                  <div className="small muted mt-1">
                    Последнее обновление: {s.lastSuccessAt ? fmtDate(s.lastSuccessAt) : '—'}
                  </div>
                  <button className="btn btn-ghost btn-sm mt-1">Обновить сейчас</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <>
          <div className="card">
            <div className="row-between" style={{ marginBottom: 16 }}>
              <div>
                <h3 className="card-title">Команда и права доступа</h3>
                <p className="card-sub">Приглашения и роли доступа</p>
              </div>
              <button className="btn btn-primary btn-sm">
                <IconPlus size={14} /> Пригласить
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {USERS.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.fullName}</div>
                        <div className="small muted">{u.email}</div>
                      </td>
                      <td>
                        <span className={`badge ${u.roleCode === 'admin' ? 'badge-accent' : ''}`}>
                          {ROLE_LABELS[u.roleCode]}
                        </span>
                      </td>
                      <td>
                        {u.isActive ? (
                          <span className="badge badge-green">
                            <span className="dot" /> Активен
                          </span>
                        ) : (
                          <span className="badge">Приглашён</span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm">Изменить</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Права ролей</h3>
            <p className="card-sub">Что доступно каждой роли в организации</p>
            <div className="table-wrap mt-2">
              <table className="table">
                <thead>
                  <tr>
                    <th>Разрешение</th>
                    <th style={{ textAlign: 'center' }}>Администратор</th>
                    <th style={{ textAlign: 'center' }}>Аналитик</th>
                    <th style={{ textAlign: 'center' }}>Наблюдатель</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_PERMISSIONS.map((p) => (
                    <tr key={p.permission}>
                      <td>{p.permission}</td>
                      <td style={{ textAlign: 'center' }} className={p.admin ? 'pos' : 'muted'}>
                        {p.admin ? '✓' : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }} className={p.analyst ? 'pos' : 'muted'}>
                        {p.analyst ? '✓' : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }} className={p.viewer ? 'pos' : 'muted'}>
                        {p.viewer ? '✓' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="footer-note">GCURVE / Анализ процентного риска</div>
    </AppShell>
  );
}
