/**
 * One quote, from the owner's side: build it, send it, see whether it was opened, and take the
 * balance when the job is done.
 *
 * BUILT FOR A PHONE IN A YARD (R21 §3, and the plan's "better than opening Stripe"): the request,
 * the photos and the drive time are already on the screen; lines are two taps each; the deposit and
 * the balance recompute as he types, from the same `depositFor()` the server charges with; Send
 * hands him a text already written, to go from his own number.
 *
 * The numbers he sees after a save come back from the server (`quoteForOwner`), so the builder
 * never disagrees with the charge. The live preview while typing uses the shared module for the
 * same reason — one function, three callers.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type QuoteOwnerView, type QuotePatch } from '../../lib/adminApi';
import { quoteTotals, depositFor, needsWrittenContract, money, IMPROVEMENT_DEPOSIT_CEILING_CENTS, WRITTEN_CONTRACT_OVER_CENTS, type QuoteLine } from '../../shared/quote-math';
import { jobKindLabel } from '../../shared/quote-contract';

type EditLine = { key: string; description: string; amount: string; optional: boolean };

const toCents = (s: string) => {
  const n = Number(String(s).trim().replace(/[$,]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const card = 'bg-white rounded-card shadow-card p-5 sm:p-6';
const input = 'w-full border border-sage-light rounded-xl px-4 py-3 text-base focus:outline-none focus:border-forest';
const btn = 'inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all disabled:opacity-60';
const STATE_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired',
};

export default function AdminQuotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<QuoteOwnerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ url: string; sms_href: string | null; email: string } | null>(null);
  const [balanceLink, setBalanceLink] = useState<{ checkout_url?: string; sms_href?: string | null } | null>(null);

  // The editable draft.
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [install, setInstall] = useState(false);
  const [mode, setMode] = useState<'percent' | 'fixed' | 'none'>('percent');
  const [pct, setPct] = useState('25');
  const [fixed, setFixed] = useState('');
  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');

  const adopt = (v: QuoteOwnerView) => {
    setView(v);
    const q = v.quote;
    setTitle(q.title); setMessage(q.message); setInstall(q.is_improvement); setMode(q.deposit_mode);
    setPct(q.deposit_percent == null ? '' : String(q.deposit_percent));
    setFixed(q.deposit_fixed_cents == null ? '' : String(q.deposit_fixed_cents / 100));
    setStart(q.approx_start); setFinish(q.approx_completion);
    setLines(v.lines.length
      ? v.lines.map((l) => ({ key: l.id, description: l.description, amount: String(l.amount_cents / 100), optional: l.optional }))
      : [{ key: 'new-0', description: '', amount: '', optional: false }]);
  };

  useEffect(() => {
    if (!id) return;
    adminApi.quote(id).then(adopt).catch((e) => setError((e as Error).message));
  }, [id]);

  // The live preview, from the same function the server charges with.
  const preview = useMemo(() => {
    const ql: QuoteLine[] = lines
      .map((l, i) => ({ id: String(i), description: l.description || '—', amount_cents: toCents(l.amount), optional: l.optional }))
      .filter((l) => Number.isFinite(l.amount_cents));
    const base = quoteTotals(ql);
    const all = quoteTotals(ql, ql.filter((l) => l.optional).map((l) => l.id));
    const rule = { mode, percent: Number(pct || 0), fixedCents: toCents(fixed || '0') };
    return { base, all, dep: depositFor(base.total, rule, install), depAll: depositFor(all.total, rule, install) };
  }, [lines, mode, pct, fixed, install]);

  const patch = (): QuotePatch => ({
    title, message, is_improvement: install, deposit_mode: mode,
    deposit_percent: mode === 'percent' ? Number(pct || 0) : null,
    deposit_fixed_cents: mode === 'fixed' ? toCents(fixed || '0') : null,
    approx_start: start, approx_completion: finish,
    lines: lines.filter((l) => l.description.trim() || l.amount.trim())
      .map((l) => ({ description: l.description.trim(), amount_cents: toCents(l.amount), optional: l.optional })),
  });

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const save = () => act(async () => { if (id) adopt(await adminApi.saveQuote(id, patch())); });
  const send = () => act(async () => {
    if (!id) return;
    adopt(await adminApi.saveQuote(id, patch()));
    const r = await adminApi.sendQuote(id);
    setSent(r);
    adopt(await adminApi.quote(id));
  });

  if (error && !view) return <AdminLayout><div className={card}><p className="text-red-700">{error}</p></div></AdminLayout>;
  if (!view) return <AdminLayout><div className="flex justify-center py-24"><div className="w-8 h-8 border-4 border-sage border-t-forest rounded-full animate-spin" /></div></AdminLayout>;

  const q = view.quote;
  const lead = view.lead;
  const draft = q.state === 'draft';
  const first = lead.name.replace(/^DEMO—/, '').split(' ')[0];
  const fullLink = view.link ? `${window.location.origin}${view.link}` : '';
  const smsAgain = lead.phone && fullLink
    ? `sms:+1${lead.phone.replace(/\D/g, '').slice(-10)}?&body=${encodeURIComponent(`Hi ${first}, it's Josue from Scoop Dogg. Your quote is here: ${fullLink}`)}`
    : null;
  const balance = (q.total_cents ?? 0) - (q.deposit_paid_at ? q.deposit_cents ?? 0 : 0);

  return (
    <AdminLayout>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(`/admin/leads/${lead.id}`)} className="text-sm text-dark/50 hover:text-forest">← {lead.name}</button>
        <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold uppercase tracking-wider text-forest">Quote #{q.number} · {STATE_LABEL[q.state] ?? q.state}</span>
      </div>
      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* What they asked for */}
          <div className={card}>
            <h2 className="font-semibold text-dark">What {first} asked for</h2>
            {(lead.job_kinds?.length ?? 0) > 0 && <p className="mt-2 text-sm text-dark/70">{lead.job_kinds!.map(jobKindLabel).join(' · ')}</p>}
            {lead.notes && <p className="mt-3 whitespace-pre-wrap text-base text-dark">{lead.notes}</p>}
            <p className="mt-3 text-sm text-dark/60">{[lead.address, lead.city].filter(Boolean).join(', ')}
              {view.road && <> · about {view.road.minutes} min drive ({view.road.miles} mi){view.road.place ? `, ${view.road.place}` : ''}</>}</p>
            {view.photos.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4" data-quote-photos>
                {view.photos.map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="Customer photo" className="aspect-square w-full rounded-lg object-cover" /></a>)}
              </div>
            )}
          </div>

          {draft ? (
            <>
              <div className={card}>
                <label className="block text-sm font-semibold text-dark" htmlFor="q-title">What the job is</label>
                <input id="q-title" className={`${input} mt-2`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Back yard clean-up and haul-away" />
                <label className="mt-4 block text-sm font-semibold text-dark" htmlFor="q-msg">A note to {first}</label>
                <textarea id="q-msg" className={`${input} mt-2`} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Priced from your photos. Happy to walk it with you first." />
              </div>

              <div className={card} data-quote-lines>
                <h2 className="font-semibold text-dark">Lines</h2>
                <p className="mt-1 text-sm text-dark/60">Optional lines are extras the customer can tick on their quote.</p>
                <div className="mt-4 flex flex-col gap-3">
                  {lines.map((l, i) => (
                    <div key={l.key} className="rounded-xl border border-sage-light p-3">
                      <input className={input} value={l.description} placeholder="Describe the work" aria-label={`Line ${i + 1} description`}
                        onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                      <div className="mt-2 flex items-center gap-3">
                        <span className="text-dark/60">$</span>
                        <input className={`${input} max-w-[10rem]`} inputMode="decimal" value={l.amount} placeholder="0" aria-label={`Line ${i + 1} amount`}
                          onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                        <label className="flex items-center gap-2 text-sm text-dark">
                          <input type="checkbox" className="h-5 w-5" checked={l.optional}
                            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, optional: e.target.checked } : x)))} /> Optional
                        </label>
                        <button className="ml-auto text-sm text-dark/50 hover:text-red-700" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className={`${btn} bg-cream text-forest hover:bg-sage-light`} onClick={() => setLines([...lines, { key: `new-${Date.now()}`, description: '', amount: '', optional: false }])}>+ Add a line</button>
                  <button className={`${btn} bg-cream text-forest hover:bg-sage-light`} onClick={() => setLines([...lines, { key: `new-${Date.now()}`, description: '', amount: '', optional: true }])}>+ Add an optional extra</button>
                </div>
              </div>

              <div className={card}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={install} onChange={(e) => setInstall(e.target.checked)} data-install-switch />
                  <span>
                    <span className="block font-semibold text-dark">This job builds or installs something</span>
                    <span className="block text-sm text-dark/60">Turf, planting, irrigation, gravel, pavers. California treats that as a home-improvement contract: the deposit is capped at {money(IMPROVEMENT_DEPOSIT_CEILING_CENTS)} or 10%, and the quote carries the contract terms for you. Clean-ups, hauling and washing are not.</span>
                  </span>
                </label>
                {install && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div><label className="text-sm font-semibold text-dark" htmlFor="q-start">Roughly when you start</label>
                      <input id="q-start" className={`${input} mt-1`} value={start} onChange={(e) => setStart(e.target.value)} placeholder="Within two weeks of approval" /></div>
                    <div><label className="text-sm font-semibold text-dark" htmlFor="q-finish">Roughly when you finish</label>
                      <input id="q-finish" className={`${input} mt-1`} value={finish} onChange={(e) => setFinish(e.target.value)} placeholder="Two working days after starting" /></div>
                  </div>
                )}
              </div>

              <div className={card}>
                <h2 className="font-semibold text-dark">Deposit</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['percent', 'fixed', 'none'] as const).map((m) => (
                    <button key={m} className={`${btn} ${mode === m ? 'bg-forest text-white' : 'bg-cream text-dark'}`} onClick={() => setMode(m)}>
                      {m === 'percent' ? 'A percentage' : m === 'fixed' ? 'A set amount' : 'No deposit'}
                    </button>
                  ))}
                </div>
                {mode === 'percent' && <div className="mt-3 flex items-center gap-2"><input className={`${input} max-w-[6rem]`} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Deposit percent" /> <span>% of the job</span></div>}
                {mode === 'fixed' && <div className="mt-3 flex items-center gap-2"><span>$</span><input className={`${input} max-w-[8rem]`} inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} aria-label="Deposit amount" /></div>}
              </div>
            </>
          ) : (
            <div className={card}>
              <h2 className="font-semibold text-dark">{q.title || 'The job'}</h2>
              {q.message && <p className="mt-2 whitespace-pre-wrap text-dark/80">{q.message}</p>}
              <ul className="mt-4 divide-y divide-sage-light">
                {view.lines.map((l) => (
                  <li key={l.id} className="flex justify-between gap-4 py-2 text-base">
                    <span className={l.optional && l.chosen === false ? 'text-dark/40 line-through' : 'text-dark'}>{l.description}{l.optional ? ' (optional)' : ''}</span>
                    <span className="font-semibold">{money(l.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* The side: the numbers and the one next action */}
        <div className="flex flex-col gap-4">
          <div className={`${card} lg:sticky lg:top-4`} data-quote-numbers>
            {draft ? (
              <>
                <p className="text-sm text-dark/60">The job</p>
                <p className="font-serif text-3xl text-dark">{money(preview.base.total)}</p>
                {preview.all.optionalAvailable > 0 && <p className="text-sm text-dark/60">{money(preview.all.total)} with every extra</p>}
                <div className="mt-4 rounded-xl bg-cream p-4 text-sm">
                  <p className="flex justify-between"><span>Deposit to book</span><strong>{money(preview.dep.cents)}</strong></p>
                  <p className="mt-1 flex justify-between"><span>When the work is done</span><strong>{money(preview.dep.balance)}</strong></p>
                  {preview.dep.capped && <p className="mt-2 text-dark/70">Cut from {money(preview.dep.asked)} to California's cap for install work.</p>}
                </div>
                {needsWrittenContract(install, preview.all.total) && view.contract.gaps.length > 0 && (
                  <ContractFacts gaps={view.contract.gaps} onSaved={() => id && adminApi.quote(id).then(adopt)} />
                )}
                <div className="mt-5 flex flex-col gap-2">
                  <button className={`${btn} bg-forest text-white hover:bg-forest-dark`} disabled={busy} onClick={send} data-send-quote>Send to {first}</button>
                  <button className={`${btn} bg-cream text-dark hover:bg-sage-light`} disabled={busy} onClick={save}>Save draft</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-dark/60">{q.state === 'accepted' ? 'Approved' : 'Quoted'}</p>
                <p className="font-serif text-3xl text-dark">{money(q.total_cents ?? view.numbers.required)}</p>
                <dl className="mt-4 space-y-1 text-sm">
                  <div className="flex justify-between"><dt>Sent</dt><dd>{when(q.sent_at)}</dd></div>
                  <div className="flex justify-between"><dt>Opened</dt><dd>{q.view_count ? `${q.view_count}× · last ${when(q.last_viewed_at)}` : 'Not yet'}</dd></div>
                  {q.valid_until && q.state === 'sent' && <div className="flex justify-between"><dt>Good until</dt><dd>{String(q.valid_until).slice(0, 10)}</dd></div>}
                  {q.accepted_at && <div className="flex justify-between"><dt>Approved by</dt><dd>{q.accepted_name}, {when(q.accepted_at)}</dd></div>}
                  {q.deposit_cents != null && q.state === 'accepted' && <div className="flex justify-between"><dt>Deposit</dt><dd>{money(q.deposit_cents)} {q.deposit_paid_at ? '· paid' : '· not paid yet'}</dd></div>}
                  {q.balance_paid_at && <div className="flex justify-between"><dt>Balance</dt><dd>paid {when(q.balance_paid_at)}</dd></div>}
                </dl>
                {sent && (
                  <div className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-900" data-quote-sent>
                    Sent. {sent.email === 'failed' ? 'The email did not go — text it.' : 'Emailed too.'}
                  </div>
                )}
                <div className="mt-5 flex flex-col gap-2">
                  {q.state === 'sent' && smsAgain && <a className={`${btn} bg-forest text-white`} href={sent?.sms_href ?? smsAgain}>Text {first} the link</a>}
                  {q.state === 'sent' && q.view_count > 0 && !q.accepted_at && smsAgain && (
                    <a className={`${btn} bg-cream text-dark`} href={`sms:+1${lead.phone.replace(/\D/g, '').slice(-10)}?&body=${encodeURIComponent(`Hi ${first}, just checking you saw the quote — happy to answer anything. ${fullLink}`)}`}>Send a friendly nudge</a>
                  )}
                  {q.state === 'accepted' && !q.balance_paid_at && (q.deposit_paid_at || !q.deposit_cents) && (
                    <>
                      {q.payment_method_id && (
                        <button className={`${btn} bg-forest text-white`} disabled={busy} data-charge-balance
                          onClick={() => { if (confirm(`Charge ${money(balance)} to ${first}'s card on file?`)) act(async () => { await adminApi.completeQuote(q.id, 'card'); adopt(await adminApi.quote(q.id)); }); }}>
                          Job done — charge {money(balance)} to their card
                        </button>
                      )}
                      <button className={`${btn} bg-cream text-dark`} disabled={busy}
                        onClick={() => act(async () => { setBalanceLink(await adminApi.completeQuote(q.id, 'link')); adopt(await adminApi.quote(q.id)); })}>
                        Job done — text a balance link
                      </button>
                      {balanceLink?.sms_href && <a className={`${btn} bg-forest text-white`} href={balanceLink.sms_href}>Send the balance link</a>}
                    </>
                  )}
                  {q.state === 'sent' && (
                    <>
                      <button className={`${btn} bg-cream text-dark`} disabled={busy} onClick={() => act(async () => { const v = await adminApi.reviseQuote(q.id); navigate(`/admin/quotes/${v.quote.id}`); })}>Change it</button>
                      <button className="text-sm text-dark/50 hover:text-red-700" disabled={busy} onClick={() => { if (confirm('Withdraw this quote?')) act(async () => { await adminApi.withdrawQuote(q.id); adopt(await adminApi.quote(q.id)); }); }}>Withdraw</button>
                    </>
                  )}
                  {['declined', 'expired', 'withdrawn'].includes(q.state) && (
                    <button className={`${btn} bg-cream text-dark`} disabled={busy} onClick={() => act(async () => { const v = await adminApi.reviseQuote(q.id); navigate(`/admin/quotes/${v.quote.id}`); })}>Start a new quote from this one</button>
                  )}
                  {q.state === 'accepted' && q.deposit_paid_at && !q.balance_paid_at && (
                    <button className="mt-2 text-sm text-dark/50 hover:text-red-700" disabled={busy}
                      onClick={() => { if (confirm(`Cancel the job and refund the ${money(q.deposit_cents ?? 0)} deposit?`)) act(async () => { await adminApi.refundQuote(q.id); adopt(await adminApi.quote(q.id)); }); }}>
                      Cancel and refund the deposit
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {view.events.length > 0 && (
            <div className={card}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-dark/50">History</h2>
              <ul className="mt-3 space-y-1 text-sm text-dark/70">
                {view.events.map((e, i) => <li key={i}>{when(e.created_at)} · {e.event_type.replace('quote.', '').replace(/_/g, ' ')}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

/**
 * The six facts California puts on an install contract, asked for on the screen where they are
 * missing — once, for every install quote after this one. Service work never needs them.
 */
function ContractFacts({ gaps, onSaved }: { gaps: string[]; onSaved: () => void }) {
  const [licence, setLicence] = useState('');
  const [klass, setKlass] = useState('C-27');
  const [legal, setLegal] = useState('');
  const [address, setAddress] = useState('');
  const [cgl, setCgl] = useState<'none' | 'carries' | 'self' | 'llc' | ''>('');
  const [insurer, setInsurer] = useState('');
  const [insPhone, setInsPhone] = useState('');
  const [wc, setWc] = useState<'exempt' | 'carries' | ''>('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = 'w-full border border-sage-light rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-forest';
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await adminApi.saveContractFacts({
        ...(licence ? { license_number: licence, license_class: klass } : {}),
        ...(legal ? { legal_name: legal } : {}),
        ...(address ? { mailing_address: address } : {}),
        ...(cgl ? { cgl: cgl === 'carries' || cgl === 'llc' ? { mode: cgl, insurer, phone: insPhone } : { mode: cgl } } : {}),
        ...(wc ? { workers_comp: wc } : {}),
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    setSaving(false);
  };
  return (
    <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950" data-contract-gaps>
      <p className="font-semibold">Install work over {money(WRITTEN_CONTRACT_OVER_CENTS)} is a written contract in California. It still needs {gaps.join(', ')}.</p>
      <p className="mt-1">Fill these in once and every install quote after this carries them. Clean-up work sends without them.</p>
      <div className="mt-3 grid gap-2">
        <input className={field} placeholder="CSLB licence number" inputMode="numeric" value={licence} onChange={(e) => setLicence(e.target.value)} />
        <input className={field} placeholder="Licence class, e.g. C-27" value={klass} onChange={(e) => setKlass(e.target.value)} />
        <input className={field} placeholder="Name on the licence" value={legal} onChange={(e) => setLegal(e.target.value)} />
        <input className={field} placeholder="Mailing address for cancellation notices" value={address} onChange={(e) => setAddress(e.target.value)} />
        <select className={field} value={cgl} onChange={(e) => setCgl(e.target.value as typeof cgl)}>
          <option value="">Liability insurance…</option>
          <option value="carries">Carries commercial general liability insurance</option>
          <option value="none">Does not carry it</option>
          <option value="self">Self-insured</option>
          <option value="llc">An LLC with insurance or other security</option>
        </select>
        {(cgl === 'carries' || cgl === 'llc') && (
          <>
            <input className={field} placeholder="Insurance company" value={insurer} onChange={(e) => setInsurer(e.target.value)} />
            <input className={field} placeholder="Insurance company phone" value={insPhone} onChange={(e) => setInsPhone(e.target.value)} />
          </>
        )}
        <select className={field} value={wc} onChange={(e) => setWc(e.target.value as typeof wc)}>
          <option value="">Employees…</option>
          <option value="exempt">No employees (exempt from workers' comp)</option>
          <option value="carries">Has employees, carries workers' comp</option>
        </select>
      </div>
      {err && <p className="mt-2 text-red-800">{err}</p>}
      <button className="mt-3 rounded-full bg-forest px-4 py-2 font-semibold text-white disabled:opacity-60" disabled={saving} onClick={save}>Save these</button>
    </div>
  );
}
