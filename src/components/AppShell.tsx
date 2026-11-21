import type { ReactNode } from 'react';
import { SOURCES } from '../data/mock';
import { navigate, useHashRoute } from '../router';
import {
  IconBriefcase,
  IconCompare,
  IconHistory,
  IconLogo,
  IconOverview,
  IconResults,
  IconSettings,
  IconShock,
  IconSparkle,
} from './Icons';

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Аналитика кривой ОФЗ',
    items: [
      { path: '/overview', label: 'Обзор', icon: <IconOverview /> },
      { path: '/history', label: 'История кривых', icon: <IconHistory /> },
      { path: '/compare', label: 'Сравнение дат', icon: <IconCompare /> },
    ],
  },
  {
    title: 'Рабочая область',
    items: [
      { path: '/portfolios', label: 'Портфели', icon: <IconBriefcase /> },
      { path: '/scenarios', label: 'Сценарии сдвигов', icon: <IconShock /> },
      { path: '/results', label: 'Результаты', icon: <IconResults /> },
      { path: '/ai', label: 'AI-аналитика', icon: <IconSparkle /> },
      { path: '/settings', label: 'Настройки', icon: <IconSettings /> },
    ],
  },
];

function connectedSourcesCount() {
  return SOURCES.filter((s) => ['cbr', 'moex'].includes(s.sourceCode) && s.status === 'connected').length;
}

const MARKET_SOURCES = ['cbr', 'moex'];

export function Sidebar() {
  const route = useHashRoute();
  const ok = connectedSourcesCount() === MARKET_SOURCES.length;
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <IconLogo />
        GCURVE
      </div>

      {SECTIONS.map((sec) => (
        <div key={sec.title}>
          <div className="nav-section">{sec.title}</div>
          {sec.items.map((item) => {
            const active = route === item.path || route.startsWith(item.path + '/');
            return (
              <button
                key={item.path}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      ))}

      <div className="sidebar-foot">
        <div className="source-pill">
          <span className="pulse" style={ok ? undefined : { background: 'var(--amber)', boxShadow: '0 0 0 4px var(--amber-soft)' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {ok ? 'Источники подключены' : 'Есть замечания'}
            </div>
            <div className="small muted">Банк России · MOEX</div>
          </div>
        </div>
        <button className="user-chip" onClick={() => navigate('/settings')}>
          <span className="avatar">СИ</span>
          <div className="grow" style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Соня Иванова</div>
            <div className="small muted">Администратор</div>
          </div>
        </button>
      </div>
    </aside>
  );
}

interface Crumb {
  section: string;
  title: string;
  actions?: ReactNode;
}

export function AppShell({ crumb, children }: { crumb: Crumb; children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <div className="topbar-crumb">
            <span className="crumb">{crumb.section}</span>
            <span className="title">{crumb.title}</span>
          </div>
          <div className="topbar-actions">{crumb.actions}</div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? '∅'}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {hint && <div className="small muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
