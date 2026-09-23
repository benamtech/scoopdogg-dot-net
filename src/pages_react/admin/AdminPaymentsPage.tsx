/**
 * Payments: connecting Josue's own Stripe account, and whether it can actually take money.
 *
 * Ben, 2026-09-19: *"josue connecting his stripe account isnt a step in the development plan,
 * its a feature."* This is the feature. One button, Stripe's own hosted onboarding, and a card
 * that says what Stripe says.
 *
 * THREE THINGS THIS CARD MUST NEVER DO (P18 §1.3), each of which is a real failure somebody has
 * shipped before:
 *
 *  - Never show a secret. The only identifier here is `acct_…`, which is not one.
 *  - Never say "connected" while Stripe says card payments are not active. `ready` is re-read
 *    from Stripe on every load of this screen, with the time it was read, because a stored
 *    boolean is right until the day a document expires and then it is wrong silently.
 *  - Never hide a requirement. If Stripe wants something, it is printed in Stripe's own words.
 *    An account that quietly stops paying out because a document lapsed is the worst silent
 *    failure in this system.
 *
 * Disconnecting clears AMTECH's 9% from every live subscription FIRST and only then records that
 * we stopped (P17 §8) - Stripe keeps collecting it otherwise. It does not close the account:
 * Stripe refuses to close a full-dashboard account it is loss-liable for, and it is his account.
 *
 * PRICES GO UP BY THEMSELVES (server/lib/stripe.ts publishPricesWhenReady). Loading this screen
 * publishes the plan prices to his account the first time Stripe says card payments are on —
 * this is where Stripe's onboarding returns him, so it is the first thing that runs after he
 * connects. Before, that was a button nobody had written down, and a connected account with no
 * prices on it is a live site that cannot take a booking. The button survives as a re-publish,
 * and only once the account can charge: publishing to an account that cannot is exactly what the
 * automatic path refuses to do.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import type { ModeStatus, PaymentsData as Data } from '../../lib/adminApi';

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
  const [note, setNote] = useState('');
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

  const disconnect = async (mode: 'test' | 'live') => {
    if (!confirm('Stop taking card payments through this account? Our 9% comes off every live plan first, and your Stripe account stays yours.')) return;
    setBusy(`disconnect-${mode}`); setError('');
    try { const j = await call('payments/disconnect', { mode }); setNote(j.message); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  const Mode = ({ mode, s }: { mode: 'test' | 'live'; s: ModeStatus }) => {
    const pub = data?.published?.[mode];
    // The label is Stripe's answer, not ours. "Connected" is reserved for card_payments active.
    const state = s.revoked_at ? { label: 'Disconnected', cls: 'bg-line text-ink-500' }
      : s.ready ? { label: 'Connected', cls: 'bg-success-100 text-success' }
      : s.account_id ? { label: 'Not finished', cls: 'bg-amber-100 text-amber-700' }
      : { label: 'Not connected', cls: 'bg-amber-100 text-amber-700' };
    const due = s.requirement_entries ?? [];
    return (
      <div className="rounded-lg border border-line bg-paper p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-forest-900">{mode === 'live' ? 'Live payments' : 'Test mode (demo)'}</h2>
          <span className={`rounded-sm px-2 py-1 text-micro font-semibold uppercase ${state.cls}`}>{state.label}</span>
        </div>
        <p className="mt-3 text-base text-ink-700">
          {s.account_id ? `Account ${s.account_id}${s.display_name ? ` · ${s.display_name}` : ''}` : 'Connect the Stripe account you want your customers\u2019 money to land in.'}
        </p>
        {s.account_id && (
          <dl className="mt-4 grid gap-2 text-base">
            <div className="flex justify-between gap-4"><dt className="text-ink-500">Card payments</dt>
              <dd className="text-forest-900">{s.card_payments === 'active' ? 'On' : s.card_payments ?? 'not started'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-500">AMTECH's share</dt>
              <dd className="text-forest-900">{s.platform_fee_bps == null ? '—' : `${s.platform_fee_bps / 100}% of each payment`}</dd></div>
            {s.probed_at && (
              <div className="flex justify-between gap-4"><dt className="text-ink-500">Checked with Stripe</dt>
                <dd className="text-ink-700">{new Date(s.probed_at).toLocaleString()}</dd></div>
            )}
          </dl>
        )}
        {/* Stripe's own words, never a summary. A hidden requirement is a stopped payout. */}
        {due.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-100/50 p-4">
            <p className="text-base font-semibold text-amber-700">Stripe still needs:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-base text-ink-700">
              {due.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>
        )}
        {/* What happened to the prices, said in one sentence. Silence would read as "nothing to do". */}
        {pub?.attempted && pub.created > 0 && (
          <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-base text-success">
            Your {pub.created} plan {pub.created === 1 ? 'price was' : 'prices were'} put on your Stripe account just now.
            Customers can book.
          </p>
        )}
        {s.account_id && !s.ready && !s.revoked_at && (
          <p className="mt-4 text-sm text-ink-500">
            Your plan prices go onto your Stripe account by themselves as soon as Stripe turns card payments on.
          </p>
        )}
        {s.requirement_entries === null && (
          <p className="mt-4 text-sm text-ink-500">We could not read what Stripe wants just now, so this may be incomplete.</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {!s.ready && <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => onboard(mode)}>
            {busy === `onboard-${mode}` ? 'Opening Stripe…' : s.account_id ? 'Finish connecting' : 'Connect Stripe'}</button>}
          {s.ready && !s.revoked_at && <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => publish(mode)}>
            {busy === `publish-${mode}` ? 'Publishing…' : 'Publish prices again'}</button>}
          <button className="btn-ghost btn-sm" disabled={!!busy} onClick={load}>Re-check</button>
          {s.account_id && !s.revoked_at && <button className="btn-ghost btn-sm text-danger" disabled={!!busy} onClick={() => disconnect(mode)}>
            {busy === `disconnect-${mode}` ? 'Stopping…' : 'Disconnect'}</button>}
        </div>
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl">
        <h1 className="font-serif text-h2 text-forest-900">Payments</h1>
        <p className="mt-2 text-base text-ink-500">Customers pay their first month when they book, then monthly. Money goes to your Stripe account.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}
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
