import { ThemeProvider } from './theme';
import { useHashRoute } from './router';
import { ConfirmEmail, Landing, Login, Recovery, Register } from './pages/AuthPages';
import { OverviewPage } from './pages/OverviewPage';
import { HistoryPage } from './pages/HistoryPage';
import { ComparePage } from './pages/ComparePage';
import { PortfoliosPage } from './pages/PortfoliosPage';
import { InstrumentCardPage } from './pages/InstrumentCardPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { RunCalculationPage } from './pages/RunCalculationPage';
import { ResultsPage } from './pages/ResultsPage';
import { ResultDetailPage } from './pages/ResultDetailPage';
import { AIAnalyticsPage } from './pages/AIAnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { EmptyState } from './components/AppShell';
import { IconInbox } from './components/Icons';

function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <EmptyState icon={<IconInbox size={22} />} title="Страница не найдена" hint="Проверьте адрес или вернитесь в рабочую область." />
        <a className="btn btn-primary btn-sm" href="#/overview">
          В рабочую область
        </a>
      </div>
    </div>
  );
}

function Router() {
  const route = useHashRoute();

  if (route === '/' || route === '') return <Landing />;
  if (route === '/login') return <Login />;
  if (route === '/register') return <Register />;
  if (route === '/confirm-email') return <ConfirmEmail />;
  if (route === '/recovery') return <Recovery />;

  if (route === '/overview') return <OverviewPage />;
  if (route === '/history') return <HistoryPage />;
  if (route === '/compare') return <ComparePage />;
  if (route === '/portfolios') return <PortfoliosPage />;
  if (route.startsWith('/portfolios/')) return <InstrumentCardPage />;
  if (route === '/scenarios') return <ScenariosPage />;
  if (route === '/run') return <RunCalculationPage />;
  if (route === '/results') return <ResultsPage />;
  if (route === '/results/detail') return <ResultDetailPage />;
  if (route === '/ai') return <AIAnalyticsPage />;
  if (route === '/settings') return <SettingsPage />;

  return <NotFound />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Router />
    </ThemeProvider>
  );
}
