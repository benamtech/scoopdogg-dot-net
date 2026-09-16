import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquare, LogOut, Menu, X, CreditCard } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/leads', label: 'Leads', icon: Users, exact: false },
  { to: '/admin/messages', label: 'Messages', icon: MessageSquare, exact: false },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard, exact: false },
];

/**
 * The demo banner and its switch.
 *
 * It is here, in the shell, so it is on every admin screen without any screen having to
 * remember it. A demo mode you cannot see from the screen you are looking at is a demo
 * mode that ships - and the consequence of shipping in it is that every customer
 * notification is silently swallowed.
 *
 * The switch says WHEN each surface changes, because the four surfaces do not change at
 * the same moment. Mail, the booking journey and this admin read the setting on every
 * request. The public pages are statically built, so their banner and their `noindex` are
 * part of the published bytes and change on the next publish. A control that appears to do
 * nothing to the public site is how somebody concludes it is broken and turns it off.
 */
function DemoBanner() {
  const { demoMode, demoAddress, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await adminApi.setDemo(!demoMode);
      setNote(
        `Demo mode is ${r.demo_mode ? 'ON' : 'OFF'}. ` +
        `${r.effective_now.join(', ')} changed now; ` +
        `${r.effective_on_publish.join(', ')} change on the next publish.`,
      );
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!demoMode) {
    return (
      <div className="bg-white border-b border-black/10 px-4 py-2 flex items-center justify-between gap-3 text-xs">
        <span className="text-dark/60">
          Live. Notifications go to the real recipients.
        </span>
        <button
          onClick={toggle}
          disabled={busy}
          className="border border-forest text-forest px-3 py-1.5 font-semibold hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
        >
          {busy ? 'Switching…' : 'Turn demo mode on'}
        </button>
      </div>
    );
  }

  return (
    <div
      data-demo-banner
      role="status"
      className="bg-[#FFF4D6] border-b-2 border-[#E0B000] text-[#6B4E00] px-4 py-2.5 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong>DEMO MODE.</strong> No message reaches a customer
          {demoAddress ? <> — everything goes to <strong>{demoAddress}</strong></> : null}.
          Bookings made now are marked and removable.
        </span>
        <button
          onClick={toggle}
          disabled={busy}
          className="border-2 border-[#6B4E00] px-3 py-1.5 text-xs font-semibold hover:bg-[#6B4E00] hover:text-[#FFF4D6] transition-colors disabled:opacity-50"
        >
          {busy ? 'Switching…' : 'Turn demo mode off'}
        </button>
      </div>
      {note && <p className="mt-1.5 text-xs opacity-80">{note}</p>}
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await adminApi.logout();
    navigate('/admin/login');
  };

  const navLinks = (
    <>
      <div className="p-5 border-b border-white/10">
        <p className="font-serif text-xl">Scoop Dogg</p>
        <p className="text-sage text-xs mt-0.5">Admin Portal</p>
      </div>
      <nav className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-white/20 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/10">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-all w-full"
        >
          <LogOut size={17} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-cream flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 bg-forest text-white flex-col fixed top-0 bottom-0 left-0 z-20">
        {navLinks}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-forest text-white flex items-center justify-between px-4 py-3 shadow-md">
        <p className="font-serif text-lg">Scoop Dogg</p>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-20 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed top-0 left-0 bottom-0 z-30 w-64 bg-forest text-white flex flex-col transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="pt-14 flex flex-col flex-1 min-h-0">
          {navLinks}
        </div>
      </aside>

      {/* Main content */}
      <main className="md:ml-56 flex-1 min-w-0 w-full pt-12 md:pt-0">
        <DemoBanner />
        <div className="p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
