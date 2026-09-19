/**
 * The customer's account (P2 stage 4, P13). Sign in with an emailed code; then one sentence at
 * the top - the next visit - and the plan, visits and payments under it. Skip, pause and cancel
 * are one tap away and never buried: "cancel anytime" is a promise the site makes.
 */
import { useEffect, useState } from 'react';

type CatchUp = { kind: 'charge'; label: string; cents: number; band: string } | { kind: 'quote'; label: string; cents: null };
type PauseOption = { weeks: number; catch_up: CatchUp | null };
type Sub = {
  id: string; state: string; package_name: string | null; short_label: string | null; weekday: string; starts_on: string;
  monthly_price_cents: number; current_period_end: string | null; cancel_at_period_end: boolean; payment_state: string;
  paused_until: string | null; address: string; city: string;
  /** What each offered pause length costs to come back from, priced from Josue's own rows. */
  pause_options?: PauseOption[]; resume_catch_up_cents: number | null; resume_catch_up_tier_id: string | null;
};
type Visit = { id: string; subscription_id: string; date: string; state: string; photo_urls: string[] };
type Invoice = { id: string; total_cents: number; state: string; paid_at: string | null; hosted_invoice_url: string | null };
type Overview = { customer: { name: string; email: string; phone: string }; subscriptions: Sub[]; visits: Visit[]; invoices: Invoice[] };

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

/**
 * WHAT A PAUSE COSTS TO COME BACK FROM, said next to the button that offers it.
 *
 * Josue's rule is that the weekly price is priced off a weekly yard. A four-week pause leaves a
 * month of buildup, and that first visit back is a different job. The rule was enforced at
 * booking on 2026-09-19 and not here, so this screen was offering a pause - as the save offer
 * when somebody tried to cancel - with a consequence it did not mention. The numbers come from
 * the server, which reads them from Josue's own catch-up tiers; nothing is typed here.
 */
const pauseNote = (sub: Sub, weeks: number): string | null => {
  const c = (sub.pause_options ?? []).find((o) => o.weeks === weeks)?.catch_up;
  if (!c) return null;
  return c.kind === 'quote'
    ? 'Josue prices your first visit back himself — a yard that far behind is a bigger job than a weekly visit.'
    : `Your first visit back is ${money(c.cents)} more — ${c.band} of buildup to reset. Your weekly price does not change.`;
};
const nice = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/account/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { status: r.status });
  return j;
}

export default function AccountApp({ phone, phoneHref }: { phone: string; phoneHref: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const load = async () => {
    try { setData(await api('overview')); setNeedLogin(false); }
    catch (e) { if ((e as { status?: number }).status === 401) setNeedLogin(true); else setErr((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const act = async (key: string, path: string, body: unknown, done: string) => {
    setBusy(key); setErr(''); setMsg('');
    try { await api(path, body); setMsg(done); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };

  if (needLogin) return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-paper p-8 shadow-md">
      <h1 className="text-h2 text-forest-900">Sign in</h1>
      <p className="mt-2 text-base text-ink-500">We'll email you a six-digit code. No password needed.</p>
      {err && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-3 py-2 text-sm text-danger">{err}</p>}
      {!codeSent ? (
        <form className="mt-6" onSubmit={async (e) => { e.preventDefault(); setBusy('send'); setErr(''); try { await api('login/start', { email }); setCodeSent(true); } catch (x) { setErr((x as Error).message); } finally { setBusy(''); } }}>
          <label htmlFor="acct-email" className="field-label">Email</label>
          <input id="acct-email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-primary mt-6 w-full" disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : 'Email me a code'}</button>
        </form>
      ) : (
        <form className="mt-6" onSubmit={async (e) => { e.preventDefault(); setBusy('verify'); setErr(''); try { await api('login/verify', { email, code }); await load(); } catch (x) { setErr((x as Error).message); } finally { setBusy(''); } }}>
          <p className="text-base text-ink-700">If <strong>{email}</strong> has an account, a code is on its way.</p>
          <label htmlFor="acct-code" className="field-label mt-5">Six-digit code</label>
          <input id="acct-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="field text-center text-xl tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn-primary mt-6 w-full" disabled={busy === 'verify'}>{busy === 'verify' ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="mt-3 w-full text-sm font-medium text-forest-700 underline underline-offset-4" onClick={() => { setCodeSent(false); setCode(''); }}>Use a different email</button>
        </form>
      )}
      <p className="mt-8 border-t border-line pt-6 text-sm text-ink-500">New to Scoop Dogg? <a href="/book" className="link">See your price</a></p>
    </div>
  );

  if (!data) return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-line/50" role="status" aria-label="Loading your account" />;

  const sub = data.subscriptions[0];
  const upcoming = data.visits.filter((v) => (!sub || v.subscription_id === sub.id) && v.date >= new Date().toISOString().slice(0, 10));
  const next = upcoming.find((v) => v.state === 'scheduled');
  const first = data.customer.name.split(' ')[0];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-base text-ink-500">Hi {first}</p>
          <h1 className="mt-1 text-h1 text-forest-900">{next ? <>Next visit: {nice(next.date, { weekday: 'long', month: 'short', day: 'numeric' })}</> : sub?.state === 'paused' ? 'Your plan is paused' : 'Your account'}</h1>
        </div>
        <button className="text-sm font-medium text-forest-700 underline underline-offset-4" onClick={async () => { await api('logout', {}); location.reload(); }}>Sign out</button>
      </div>

      {msg && <p role="status" className="mt-6 rounded-md bg-success-100 px-4 py-3 text-base text-success">{msg}</p>}
      {err && <p role="alert" className="mt-6 rounded-md bg-danger-100 px-4 py-3 text-base text-danger">{err}</p>}
      {sub?.payment_state === 'past_due' && (
        <div className="mt-6 flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base text-danger"><strong>Your last payment didn't go through.</strong> Update your card to keep your visits coming.</p>
          <button className="btn-primary btn-sm" onClick={async () => { const j = await api('billing', {}); location.href = j.url; }}>Update card</button>
        </div>
      )}

      {!sub && (
        <div className="mt-8 rounded-xl border border-line bg-paper p-8 text-center">
          <p className="text-lg text-forest-900">You don't have an active plan.</p>
          <a href="/book" className="btn-primary mt-5">See your price</a>
        </div>
      )}

      {sub && (
        <>
          <section className="mt-8 rounded-xl border border-line bg-paper p-6 shadow-sm sm:p-8" aria-labelledby="plan-h">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-micro font-semibold uppercase text-ink-400">Your plan</p>
                <h2 id="plan-h" className="mt-2 text-h3 text-forest-900">{sub.package_name}</h2>
                <p className="mt-1 text-base text-ink-500">Every {sub.weekday} · {sub.address}, {sub.city}</p>
              </div>
              <p className="text-right"><span className="font-serif text-h3 text-forest-900">{money(sub.monthly_price_cents)}</span><span className="block text-sm text-ink-500">per month</span></p>
            </div>
            {sub.cancel_at_period_end && (
              <div className="mt-6 flex flex-col gap-3 rounded-md bg-amber-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-base text-amber-700">Your plan ends {sub.current_period_end ? nice(sub.current_period_end) : 'at the end of this month'}.</p>
                <button className="btn-secondary btn-sm" disabled={busy === 'keep'} onClick={() => act('keep', 'plan/keep', { subscription_id: sub.id }, "Great — your plan will keep going.")}>Keep my plan</button>
              </div>
            )}
            {sub.state === 'paused' && (
              <div className="mt-6 flex flex-col gap-3 rounded-md bg-forest-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-base text-forest-900">Paused{sub.paused_until ? ` until ${nice(sub.paused_until)}` : ''}. No charges while paused.</p>
                  {sub.resume_catch_up_tier_id && (
                    <p className="mt-1 text-sm text-ink-600" data-resume-catch-up>
                      {sub.resume_catch_up_cents == null
                        ? 'Josue will price your first visit back himself.'
                        : `Your first visit back carries a ${money(sub.resume_catch_up_cents)} catch-up clean.`}
                    </p>
                  )}
                </div>
                <button className="btn-secondary btn-sm" disabled={busy === 'resume'} onClick={() => act('resume', 'plan/resume', { subscription_id: sub.id }, 'Welcome back — your visits are back on.')}>Resume now</button>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-6">
              {sub.state === 'active' && !sub.cancel_at_period_end && (
                <>
                  <span className="inline-flex flex-col gap-1">
                    <button data-pause={2} className="btn-ghost btn-sm" disabled={!!busy} onClick={() => act('pause', 'plan/pause', { subscription_id: sub.id, weeks: 2 }, 'Paused for two weeks. You won’t be charged while paused.')}>Pause 2 weeks</button>
                    {pauseNote(sub, 2) && <span className="max-w-xs text-sm text-ink-600">{pauseNote(sub, 2)}</span>}
                  </span>
                  <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => setConfirmCancel(sub.id)}>Cancel plan</button>
                </>
              )}
              <button className="btn-ghost btn-sm" disabled={!!busy} onClick={async () => { setBusy('billing'); try { const j = await api('billing', {}); location.href = j.url; } catch (e) { setErr((e as Error).message); setBusy(''); } }}>Cards & receipts</button>
            </div>
            {confirmCancel === sub.id && (
              <div className="mt-5 rounded-lg border border-line bg-forest-50 p-5" role="dialog" aria-labelledby="cancel-h">
                <h3 id="cancel-h" className="text-lg font-semibold text-forest-900">Before you go — would a pause help?</h3>
                <p className="mt-1 text-base text-ink-700">Going away or tight this month? Pause instead and pick up where you left off. Or cancel — no questions asked.</p>
                {/*
                  THE CANCEL COMES FIRST AND IS THE STRONGER BUTTON. §17602(e)(2) permits a
                  retention offer here only while a "click to cancel" control is "prominently
                  located and continuously and proximately displayed" alongside it.

                  Until 2026-09-19 this was the other way round: the pause was `btn-secondary`
                  and the cancel was `btn-ghost`, so the save offer was the more prominent of the
                  two. R6 §B4 had recorded the dialog as already correct, having read its shape
                  and not its classes. The randomised evidence on why the statute cares is in
                  R9 §5 — mild dark patterns more than doubled sign-ups in Luguri & Strahilevitz,
                  which is why a filled button beside an outline one is not a neutral choice.

                  `data-cancel-control` and `data-save-offer` are what gates/consent.mjs compares,
                  so the ordering cannot quietly revert.
                */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button data-cancel-control className="btn-secondary btn-sm" onClick={() => { setConfirmCancel(null); act('cancel', 'plan/cancel', { subscription_id: sub.id, reason: 'customer portal' }, 'Your plan is set to end at the end of this billing month.'); }}>Cancel my plan</button>
                  <span className="inline-flex flex-col gap-1">
                    <button data-save-offer data-pause={4} className="btn-ghost btn-sm" onClick={() => { setConfirmCancel(null); act('pause', 'plan/pause', { subscription_id: sub.id, weeks: 4 }, 'Paused for four weeks instead.'); }}>Pause 4 weeks instead</button>
                    {pauseNote(sub, 4) && <span className="max-w-xs text-sm text-ink-600" data-pause-note={4}>{pauseNote(sub, 4)}</span>}
                  </span>
                  <button className="text-sm font-medium text-forest-700 underline underline-offset-4" onClick={() => setConfirmCancel(null)}>Never mind</button>
                </div>
              </div>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-line bg-paper p-6 sm:p-8" aria-labelledby="visits-h">
            <h2 id="visits-h" className="text-xl font-semibold text-forest-900">Upcoming visits</h2>
            {upcoming.length === 0 && <p className="mt-3 text-base text-ink-500">No visits scheduled right now.</p>}
            <ul className="mt-4 divide-y divide-line">
              {upcoming.slice(0, 6).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-4 py-3">
                  <span className={`text-base ${v.state === 'skipped' ? 'text-ink-400 line-through' : 'text-forest-900'}`}>{nice(v.date)}</span>
                  {v.state === 'scheduled' && <button className="text-sm font-medium text-forest-700 underline underline-offset-4 disabled:opacity-50" disabled={!!busy} onClick={() => act(`skip-${v.id}`, 'visit/skip', { visit_id: v.id }, `Skipped ${nice(v.date, { month: 'short', day: 'numeric' })}.`)}>Skip</button>}
                  {v.state === 'skipped' && <button className="text-sm font-medium text-forest-700 underline underline-offset-4 disabled:opacity-50" disabled={!!busy} onClick={() => act(`unskip-${v.id}`, 'visit/unskip', { visit_id: v.id }, 'Visit is back on.')}>Undo skip</button>}
                </li>
              ))}
            </ul>
          </section>

          {data.invoices.length > 0 && (
            <section className="mt-6 rounded-xl border border-line bg-paper p-6 sm:p-8" aria-labelledby="pay-h">
              <h2 id="pay-h" className="text-xl font-semibold text-forest-900">Payments</h2>
              <ul className="mt-4 divide-y divide-line">
                {data.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-4 py-3 text-base">
                    <span className="text-forest-900">{i.paid_at ? nice(i.paid_at, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pending'}</span>
                    <span className="flex items-center gap-4"><span className="text-ink-700">{money(i.total_cents)}</span>{i.hosted_invoice_url && <a className="link text-sm" href={i.hosted_invoice_url} target="_blank" rel="noopener">Receipt</a>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="mt-10 text-center text-base text-ink-500">Need anything? Call or text <a href={phoneHref} className="link">{phone}</a>.</p>
    </div>
  );
}
