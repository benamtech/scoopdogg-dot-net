/**
 * Payments: is Josue's Stripe account ready to take money, in each mode, and are the monthly
 * packages published to it. The status comes from Stripe with its time - never a bare boolean.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';

type ModeStatus = { account_id: string | null; display_name: string | null; ready: boolean; card_payments: string | null; requirements: string | null; probed_at: string | null };
type Pkg = { slug: string; name: string; monthly_price_cents: number; source: string; derivation: string; version: number; published_test: boolean; published_live: boolean };
type Data = { status: { live: ModeStatus; test: ModeStatus }; packages: Pkg[] };

const money = (c: number) => `$${(c / 100).toFixed(0)}`;

async function call(path: string, body?: unknown) {
  const r = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export default function AdminPaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = async () => { try { setData(await call('payments')); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);

  const onboard = async (mode: 'test' | 'live') => {
    setBusy(`onboard-${mode}`); setError('');
    try { const j = await call('payments/onboard', { mode }); window.location.href = j.url; } catch (e) { setError((e as Error).message); setBusy(''); }
  };
  const publish = async (mode: 'test' | 'live') => {
    setBusy(`publish-${mode}`); setError('');
    try { await call('payments/publish', { mode }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  const Mode = ({ mode, s }: { mode: 'test' | 'live'; s: ModeStatus }) => (
    <div className="rounded-lg border border-line bg-paper p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-forest-900">{mode === 'live' ? 'Live payments' : 'Test mode (demo)'}</h2>
        <span className={`rounded-sm px-2 py-1 text-micro font-semibold uppercase ${s.ready ? 'bg-success-100 text-success' : 'bg-amber-100 text-amber-700'}`}>{s.ready ? 'Ready' : s.account_id ? 'Needs onboarding' : 'Not connected'}</span>
      </div>
      <p className="mt-3 text-base text-ink-700">{s.account_id ? `Account ${s.account_id}${s.display_name ? ` · ${s.display_name}` : ''}` : 'No Stripe account connected yet.'}</p>
      {s.account_id && <p className="mt-1 text-sm text-ink-500">Card payments: {s.card_payments ?? 'unknown'} · requirements: {s.requirements ?? 'none due'}{s.probed_at ? ` · checked ${new Date(s.probed_at).toLocaleString()}` : ''}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {!s.ready && <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => onboard(mode)}>{busy === `onboard-${mode}` ? 'Opening Stripe…' : s.account_id ? 'Continue onboarding' : 'Onboard to collect payments'}</button>}
        {s.account_id && <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => publish(mode)}>{busy === `publish-${mode}` ? 'Publishing…' : 'Publish plan prices'}</button>}
        <button className="btn-ghost btn-sm" disabled={!!busy} onClick={load}>Re-check</button>
      </div>
    </div>
  );

  return (
    <AdminLayout>
      <div className="max-w-5xl">
        <h1 className="font-serif text-h2 text-forest-900">Payments</h1>
        <p className="mt-2 text-base text-ink-500">Customers pay their first month when they book, then monthly. Money goes to your Stripe account.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {!data ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : (
          <>
            <div className="mt-8 grid gap-4 md:grid-cols-2"><Mode mode="live" s={data.status.live} /><Mode mode="test" s={data.status.test} /></div>
            <h2 className="mt-12 text-xl font-semibold text-forest-900">Monthly plans</h2>
            <p className="mt-1 text-sm text-ink-500">Prices marked "derived" are arithmetic on your published prices, waiting for confirmation.</p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-cream text-ink-500"><tr><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Monthly</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Stripe</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.packages.map((p) => (
                    <tr key={p.slug}>
                      <td className="px-4 py-3"><span className="font-medium text-forest-900">{p.name}</span><span className="block text-ink-500">{p.derivation}</span></td>
                      <td className="px-4 py-3 font-semibold text-forest-900">{money(p.monthly_price_cents)}</td>
                      <td className="px-4 py-3">{p.source === 'confirmed' ? 'Confirmed' : 'Derived'}</td>
                      <td className="px-4 py-3">{p.published_live ? 'Live' : ''}{p.published_live && p.published_test ? ' · ' : ''}{p.published_test ? 'Test' : ''}{!p.published_live && !p.published_test ? '—' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
