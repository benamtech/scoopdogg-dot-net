import { AuthProvider } from '../../lib/auth';
import ProtectedRoute from '../ProtectedRoute';
import AdminLoginPage from '../../pages_react/admin/AdminLoginPage';
import AdminDashboardPage from '../../pages_react/admin/AdminDashboardPage';
import AdminLeadsPage from '../../pages_react/admin/AdminLeadsPage';
import AdminLeadDetailPage from '../../pages_react/admin/AdminLeadDetailPage';
import AdminMessagesPage from '../../pages_react/admin/AdminMessagesPage';
import AdminMessageDetailPage from '../../pages_react/admin/AdminMessageDetailPage';
import AdminPaymentsPage from '../../pages_react/admin/AdminPaymentsPage';
import AdminChecklistPage from '../../pages_react/admin/AdminChecklistPage';
import AdminCustomersPage from '../../pages_react/admin/AdminCustomersPage';
import AdminGrowthPage from '../../pages_react/admin/AdminGrowthPage';
import AdminTodayPage from '../../pages_react/admin/AdminTodayPage';

/**
 * One admin screen, hydrated — the whole screen, not a shell around it.
 *
 * It replaces a shell that took the screen as Astro children. That does not work, and
 * the failure is silent: children passed to a `client:load` component are rendered by
 * Astro into an `<astro-slot>` and handed to the island as static HTML. React never owns
 * them, so no `useEffect` inside them ever runs. Every admin page served a build-time
 * snapshot — "Loading…" forever, every stat an em-dash, Sign Out inert — while the API,
 * the session cookie and the server HTML were all correct. `curl` cannot see that and
 * neither can a gate that reads the built bytes. `gates/admin-browser.mjs` is the check
 * that can, and it is how this was found.
 *
 * The screen is named by a prop rather than picked from the URL because a prop survives
 * the island boundary as data and renders identically on the server and in the browser.
 * There is no client-side router here on purpose: `react-router-dom` is aliased to
 * `src/shims/react-router-dom.tsx`, where a Link is an anchor and navigation is a real
 * document load. The detail screens' ids come from the path, which is why /admin/lead
 * and /admin/message sit behind a vercel.json rewrite that keeps the id in the URL.
 */
const SCREENS = {
  login: AdminLoginPage,
  dashboard: AdminDashboardPage,
  leads: AdminLeadsPage,
  lead: AdminLeadDetailPage,
  messages: AdminMessagesPage,
  message: AdminMessageDetailPage,
  payments: AdminPaymentsPage,
  setup: AdminChecklistPage,
  customers: AdminCustomersPage,
  growth: AdminGrowthPage,
  today: AdminTodayPage,
} as const;

export type AdminScreen = keyof typeof SCREENS;

export default function AdminIsland({ screen }: { screen: AdminScreen }) {
  const Screen = SCREENS[screen];
  return (
    <AuthProvider>
      {screen === 'login' ? <Screen /> : <ProtectedRoute><Screen /></ProtectedRoute>}
    </AuthProvider>
  );
}
