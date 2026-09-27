/**
 * The customer's page for one custom job: /quote/<token>. It is the request status before there is
 * a quote, the quote while it is open, the contract once approved, and the receipt once paid.
 *
 * R21 IN ONE SCREEN. The wait is explained (who, by when, what next). The work is shown (their own
 * photos back, every line with its price). Extras are theirs to tick, with the total moving as
 * they do. Approval is a typed name against a sentence the server rebuilds and compares. No
 * countdowns and no pressure: a quote has a date because materials change, and it says so.
 *
 * THE NUMBERS COME FROM src/shared/quote-math — the same functions the server charges with, so the
 * deposit on this page is the deposit on the card.
 *
 * INSTALL WORK IS A CONTRACT. For a job Josue marked as building or installing something, this page
 * is the California home-improvement contract: the statute's headings and notices, verbatim, from
 * src/shared/quote-contract. The right to cancel sits next to the signature, as §7159 requires.
 */
import { useEffect, useMemo, useState } from 'react';
import { quoteTotals, depositFor, acceptanceTerms, money, needsWrittenContract, IMPROVEMENT_DEPOSIT_CEILING_CENTS } from '../../shared/quote-math';
import {
  ENTITLED_TO_COPY, DOWNPAYMENT_NOTICE, EXTRA_WORK_NOTE, EXTRA_WORK_BUYER_NOTICE, LIEN_RELEASE_STATEMENT, BOND_NOTICE,
  MECHANICS_LIEN_WARNING, CSLB_NOTICE, rightToCancel, noticeOfCancellation, cancelBy, cglStatement, workersCompStatement,
  type ContractFacts, type CglFact,
} from '../../shared/quote-contract';

type Line = { id: string; description: string; detail: string; amount_cents: number; optional: boolean; chosen: boolean | null };
type View = {
  stage: 'received' | 'quote' | 'accepted' | 'booked' | 'completed' | 'paid' | 'declined' | 'expired' | 'withdrawn';
  business: {
    name: string; phone: string | null; email: string | null; licence: string | null; licence_class: string | null;
    legal_name: string | null; mailing_address: string | null; cgl: CglFact | null; workers_comp: 'exempt' | 'carries' | null; reply_promise: string;
  };
  request: { first_name: string; job_kinds: string[]; description: string; where: string; created_at: string; photos: { id: string; url: string }[] };
  quote: null | {
    id: string; number: number; state: string; title: string; message: string; is_improvement: boolean;
    deposit: { mode: 'percent' | 'fixed' | 'none'; percent: number | null; fixed_cents: number | null };
    approx_start: string; approx_completion: string; valid_until: string | null; sent_at: string | null;
    lines: Line[]; accepted_at: string | null; accepted_name: string | null; total_cents: number | null; deposit_cents: number | null;
    deposit_paid_at: string | null; completed_at: string | null; balance_paid_at: string | null; has_card: boolean;
    balance_checkout_url: string | null; balance_cents: number | null;
  };
};

const day = (iso: string | null) => (iso ? new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '');
const isoDay = (iso: string | null) => (iso ? String(iso).slice(0, 10) : new Date().toISOString().slice(0, 10));
const smsLink = (phone: string | null, body: string) => (phone ? `sms:+1${phone.replace(/\D/g, '').slice(-10)}?&body=${encodeURIComponent(body)}` : '#');

export default function QuoteApp({ phone, phoneHref }: { phone: string; phoneHref: string }) {
  const token = typeof window === 'undefined' ? '' : decodeURIComponent(window.location.pathname.replace(/\/+$/, '').split('/').pop() || '');
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [senior, setSenior] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const load = async (count: boolean) => {
    const r = await fetch(`/api/quote/view?token=${encodeURIComponent(token)}${count ? '' : '&peek=1'}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'This link could not be opened.');
    setView(j as View);
  };

  useEffect(() => {
    (async () => {
      try {
        const paid = new URLSearchParams(window.location.search).get('paid');
        if (paid) {
          await fetch('/api/quote/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: paid }) }).catch(() => {});
          window.history.replaceState(null, '', window.location.pathname);
          await load(false);
        } else {
          await load(true);
        }
      } catch (e) { setError((e as Error).message); }
    })();
  }, []);

  const q = view?.quote ?? null;
  const numbers = useMemo(() => {
    if (!q) return null;
    const lines = q.lines.map((l) => ({ id: l.id, description: l.description, amount_cents: l.amount_cents, optional: l.optional }));
    const t = quoteTotals(lines, chosen);
    const d = depositFor(t.total, { mode: q.deposit.mode, percent: q.deposit.percent, fixedCents: q.deposit.fixed_cents }, q.is_improvement);
    const terms = acceptanceTerms({ businessName: view!.business.name, number: q.number, totalCents: t.total, depositCents: d.cents, isImprovement: q.is_improvement });
    return { ...t, deposit: d, terms };
  }, [q, chosen, view]);

  if (error) return <Card><p className="text-h3 text-forest-900">We could not open this page</p><p className="mt-3 text-base text-ink-700">{error}</p></Card>;
  // What the server renders, and what a visitor without JavaScript keeps: what this page is, and
  // the phone number. Never a bare loading state (gates/build-gates.mjs no-loading-fallback).
  if (!view) return <Card><p className="text-h3 text-forest-900">Your quote from Scoop Dogg</p><p className="mt-3 text-base text-ink-700">This page opens your request or quote. If it does not appear, call or text Josue on <a className="link" href={phoneHref}>{phone}</a>.</p></Card>;

  const b = view.business;
  const text = (body: string) => smsLink(b.phone, body);
  const facts: ContractFacts = {
    legalName: b.legal_name, licenceNumber: b.licence, licenceClass: b.licence_class, mailingAddress: b.mailing_address,
    email: b.email, phone: b.phone, cgl: b.cgl, workersComp: b.workers_comp,
  };

  const approve = async () => {
    if (!q || !numbers) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/quote/accept', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, quote_id: q.id, name, chosen: [...chosen], terms: numbers.terms, senior }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not go through. Please text Josue.');
      if (j.checkout_url) { window.location.assign(j.checkout_url); return; }
      await load(false);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  // ── before there is a quote
  if (view.stage === 'received' || !q) {
    return (
      <Card>
        <p className="eyebrow">Your request</p>
        <h1 className="mt-2 text-h2 text-forest-900">Josue has it, {view.request.first_name}</h1>
        <p className="mt-3 text-statement text-ink-700">He reads every request himself and will reply {b.reply_promise}, usually by text{b.phone ? ` from ${b.phone}` : ''}.</p>
        <ol className="mt-6 space-y-2 text-base text-ink-700">
          <li><strong>1.</strong> He looks at what you sent, and may ask a question or stop by.</li>
          <li><strong>2.</strong> He sends a quote to this page: every line itemised, and any extras you can add.</li>
          <li><strong>3.</strong> You approve it here and pay a deposit to book. The rest is paid when the work is done.</li>
        </ol>
        <Sent view={view} />
        <a className="btn-ghost mt-6" href={text(`Hi Josue, about my request on scoopdogg.net: `)}>Text Josue</a>
      </Card>
    );
  }

  const closed = view.stage === 'declined' || view.stage === 'expired' || view.stage === 'withdrawn';
  if (closed) {
    return (
      <Card>
        <p className="eyebrow">Quote #{q.number}</p>
        <h1 className="mt-2 text-h2 text-forest-900">
          {view.stage === 'expired' ? 'This quote has expired' : view.stage === 'declined' ? 'You passed on this quote' : 'Josue has withdrawn this quote'}
        </h1>
        <p className="mt-3 text-base text-ink-700">{view.stage === 'expired' ? 'Prices on materials move, so quotes have a date. Text Josue and he will refresh it.' : 'If anything changes, Josue is a text away.'}</p>
        <a className="btn-primary mt-6" href={text(`Hi Josue, about quote #${q.number}: `)}>Text Josue</a>
      </Card>
    );
  }

  const open = view.stage === 'quote';
  const total = open ? numbers!.total : q.total_cents ?? numbers!.total;
  const deposit = open ? numbers!.deposit.cents : q.deposit_cents ?? 0;
  const contract = q.is_improvement && needsWrittenContract(true, total);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="eyebrow">Quote #{q.number} from {b.name}</p>
        <h1 className="mt-2 text-h2 text-forest-900">{q.title || 'Your job'}</h1>
        {q.message && <p className="mt-3 whitespace-pre-wrap text-statement text-ink-700">{q.message}</p>}
        {view.stage === 'booked' && <Banner>You're booked. Your {money(q.deposit_cents ?? 0)} deposit is paid{q.has_card ? ', and the balance will be charged to the same card when the work is done' : ''}.</Banner>}
        {view.stage === 'accepted' && deposit > 0 && <Banner>Approved. Pay the {money(deposit)} deposit to book the job.</Banner>}
        {view.stage === 'accepted' && deposit === 0 && <Banner>Approved. Josue will be in touch to schedule the work.</Banner>}
        {view.stage === 'completed' && <Banner>The work is done. The balance is {money(q.balance_cents ?? 0)}.</Banner>}
        {view.stage === 'paid' && <Banner>Paid in full. Thank you for choosing {b.name}.</Banner>}

        <ul className="mt-6 divide-y divide-line border-y border-line" data-quote-lines>
          {q.lines.map((l) => {
            const on = !l.optional || (open ? chosen.has(l.id) : l.chosen === true);
            return (
              <li key={l.id} className="flex items-start justify-between gap-4 py-4">
                <div className="flex items-start gap-3">
                  {l.optional && open && (
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-forest-700" checked={chosen.has(l.id)} aria-label={`Add ${l.description}`}
                      onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(l.id); else n.delete(l.id); setChosen(n); }} />
                  )}
                  <div>
                    <p className={`text-base ${on ? 'text-ink-900' : 'text-ink-500'}`}>{l.description}{l.optional && <span className="ml-2 text-sm text-orange-700">optional</span>}</p>
                    {l.detail && <p className="mt-1 text-sm text-ink-500">{l.detail}</p>}
                  </div>
                </div>
                <p className={`shrink-0 font-semibold ${on ? 'text-forest-900' : 'text-ink-500 line-through'}`}>{money(l.amount_cents)}</p>
              </li>
            );
          })}
        </ul>
        <dl className="mt-5 space-y-2 text-base" data-quote-totals>
          <div className="flex justify-between text-h3 text-forest-900"><dt>Total</dt><dd>{money(total)}</dd></div>
          {view.stage !== 'paid' && <>
            <div className="flex justify-between text-ink-700"><dt>{view.stage === 'booked' || view.stage === 'completed' ? 'Deposit paid' : 'Deposit to book'}</dt><dd>{money(deposit)}</dd></div>
            <div className="flex justify-between text-ink-700"><dt>When the work is done</dt><dd>{money(total - deposit)}</dd></div>
          </>}
          {open && numbers!.deposit.capped && <p className="text-sm text-ink-500">California limits the deposit on install work to {money(IMPROVEMENT_DEPOSIT_CEILING_CENTS)} or 10% of the job, whichever is less.</p>}
        </dl>
        {open && q.valid_until && <p className="mt-4 text-sm text-ink-500">This price is good until {day(q.valid_until)}.</p>}
      </Card>

      {view.request.photos.length > 0 && <Card><Sent view={view} /></Card>}

      {contract && <Contract view={view} facts={facts} total={total} deposit={deposit} senior={senior} />}

      {open && (
        <Card>
          <h2 className="text-h3 text-forest-900">Approve the quote</h2>
          {contract && (
            <div className="mt-4 rounded-lg border-2 border-forest-700 p-4" data-right-to-cancel>
              <p className="font-bold text-forest-900">{rightToCancel(senior).heading}</p>
              {rightToCancel(senior).paragraphs.map((t, i) => <p key={i} className="mt-2 text-base font-bold text-ink-900">{t}</p>)}
              <label className="mt-3 flex items-center gap-2 text-base"><input type="checkbox" className="h-5 w-5" checked={senior} onChange={(e) => setSenior(e.target.checked)} /> I am 65 or older</label>
            </div>
          )}
          {contract && <p className="mt-4 text-base font-semibold text-ink-900">{BOND_NOTICE}</p>}
          <p className="mt-4 rounded-lg bg-sand p-4 text-base text-ink-900" data-terms>{numbers!.terms}</p>
          <label className="field-label mt-5" htmlFor="q-sign">Type your full name to approve</label>
          <input id="q-sign" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          {error && <p className="mt-3 rounded-md bg-danger-100 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          <button className="btn-primary mt-5 w-full sm:w-auto" disabled={busy || name.trim().length < 2} onClick={approve} data-approve>
            {deposit > 0 ? `Approve and pay the ${money(deposit)} deposit` : 'Approve'}
          </button>
          {deposit > 0 && <p className="mt-3 text-sm text-ink-500">You pay the deposit on the next page, through Stripe.{total - deposit > 0 ? ' Your card is kept for the balance, which is charged only when the work is done.' : ''}</p>}
          <div className="mt-6 flex flex-wrap gap-4 text-base">
            <a className="link" href={text(`Hi Josue, a question about quote #${q.number}: `)}>Ask Josue a question</a>
            {!declining && <button className="link" onClick={() => setDeclining(true)}>This isn't for me</button>}
          </div>
          {declining && (
            <div className="mt-4">
              <label className="field-label" htmlFor="q-reason">Anything Josue should know? (optional)</label>
              <textarea id="q-reason" className="field min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn-ghost mt-3" disabled={busy} onClick={async () => {
                setBusy(true);
                await fetch('/api/quote/decline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, reason }) }).catch(() => {});
                await load(false); setBusy(false);
              }}>Pass on this quote</button>
            </div>
          )}
        </Card>
      )}

      {view.stage === 'accepted' && deposit > 0 && (
        <Card>
          {error && <p className="mb-3 rounded-md bg-danger-100 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try {
              const r = await fetch('/api/quote/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, quote_id: q.id }) });
              const j = await r.json().catch(() => ({}));
              if (j.checkout_url) window.location.assign(j.checkout_url); else throw new Error(j.error || 'Please text Josue to pay the deposit.');
            } catch (e) { setError((e as Error).message); setBusy(false); }
          }}>Pay the {money(deposit)} deposit</button>
        </Card>
      )}

      {view.stage === 'completed' && q.balance_checkout_url && (
        <Card><a className="btn-primary" href={q.balance_checkout_url}>Pay the {money(q.balance_cents ?? 0)} balance</a></Card>
      )}

      {!open && q.accepted_at && (
        <Card>
          <p className="text-sm text-ink-500">Approved by {q.accepted_name} on {day(q.accepted_at)}. <button className="link" onClick={() => window.print()}>Print or save this page</button></p>
          <a className="btn-ghost mt-4" href={text(`Hi Josue, about quote #${q.number}: `)}>Text Josue</a>
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="tone-white rounded-xl bg-paper p-6 shadow-lg ring-1 ring-black/5 sm:p-8">{children}</section>;
}
function Banner({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 rounded-lg bg-forest-50 p-4 text-base font-semibold text-forest-900" role="status">{children}</p>;
}
function Sent({ view }: { view: View }) {
  const r = view.request;
  if (!r.photos.length && !r.description) return null;
  return (
    <div className="mt-6">
      <p className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-500">What you sent</p>
      {r.job_kinds.length > 0 && <p className="mt-2 text-base text-ink-700">{r.job_kinds.join(' · ')}</p>}
      {r.description && <p className="mt-2 whitespace-pre-wrap text-base text-ink-700">{r.description}</p>}
      {r.photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {r.photos.map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="Your photo" className="aspect-square w-full rounded-lg object-cover" /></a>)}
        </div>
      )}
    </div>
  );
}

/** The California home-improvement contract, in the order §7159(d)–(e) lists it. */
function Contract({ view, facts, total, deposit, senior }: { view: View; facts: ContractFacts; total: number; deposit: number; senior: boolean }) {
  const q = view.quote!;
  const signed = q.accepted_at ? isoDay(q.accepted_at) : null;
  const lastDay = cancelBy(signed ?? isoDay(null), senior ? 5 : 3);
  return (
    <section className="tone-white rounded-xl bg-paper p-6 text-base text-ink-900 shadow-lg ring-1 ring-black/5 sm:p-8" data-contract>
      <details open={Boolean(q.accepted_at)}>
        <summary className="cursor-pointer text-h3 text-forest-900">The contract, and your rights under California law</summary>
        <div className="mt-5 space-y-4">
          <p className="font-bold">Home Improvement</p>
          <p>{facts.legalName}{facts.mailingAddress ? `, ${facts.mailingAddress}` : ''}. Contractor's licence #{facts.licenceNumber}{facts.licenceClass ? ` (${facts.licenceClass})` : ''}.</p>
          <p>The Notice of Cancellation may be sent to the contractor at the address or email address noted on this contract: {facts.mailingAddress}{facts.email ? ` · ${facts.email}` : ''}. For help locating and filling out the Notice of Cancellation, call {facts.phone}.</p>
          {signed && <p>Date the buyer signed: {day(signed)}.</p>}
          <p className="text-lg font-bold">{ENTITLED_TO_COPY}</p>
          <p><strong>Contract Price:</strong> {money(total)}</p>
          <p className="font-bold">Description of the Project and Description of the Significant Materials to be Used and Equipment to be Installed</p>
          <ul className="list-disc pl-6">{q.lines.filter((l) => !l.optional || l.chosen !== false).map((l) => <li key={l.id}>{l.description}{l.detail ? ` — ${l.detail}` : ''}{l.optional ? ' (if chosen)' : ''}</li>)}</ul>
          {deposit > 0 && (<>
            <p><strong>Downpayment:</strong> {money(deposit)}</p>
            <p className="text-lg font-bold">{DOWNPAYMENT_NOTICE}</p>
          </>)}
          <p>No other payment is made before the work is completed. The balance of {money(total - deposit)} is due on completion.</p>
          <p>Work is substantially commenced when the contractor begins removing, preparing or installing at the property.</p>
          <p><strong>Approximate Start Date:</strong> {q.approx_start || 'To be agreed with you before work begins'}</p>
          <p><strong>Approximate Completion Date:</strong> {q.approx_completion || 'To be agreed with you before work begins'}</p>
          <p className="font-bold">Note About Extra Work and Change Orders</p>
          <p>{EXTRA_WORK_NOTE}</p>
          <p>Subcontractors: [X] No — no subcontractors will be used on this project.</p>
          <p>{LIEN_RELEASE_STATEMENT}</p>
          <p className="font-bold">Commercial General Liability Insurance (CGL)</p>
          <p>{cglStatement(facts)}</p>
          <p className="font-bold">Workers' Compensation Insurance</p>
          <p>{workersCompStatement(facts)}</p>
          <p className="font-bold">Extra or change-order work</p>
          {EXTRA_WORK_BUYER_NOTICE.map((t, i) => <p key={i}>{t}</p>)}
          <div className="rounded-lg border border-line p-4">{MECHANICS_LIEN_WARNING.map((t, i) => <p key={i} className={i === 0 ? 'font-bold' : 'mt-2'}>{t}</p>)}</div>
          <div className="rounded-lg border border-line p-4 text-lg">{CSLB_NOTICE.map((t, i) => <p key={i} className={i ? 'mt-2' : ''}>{t}</p>)}</div>
          <div className="rounded-lg border-2 border-dashed border-line-strong p-4" data-notice-of-cancellation>
            {noticeOfCancellation({
              senior, transactionDate: signed ? day(signed) : '(the date you approve)', sellerName: facts.legalName ?? '',
              sellerAddress: facts.mailingAddress ?? '', sellerEmail: facts.email ?? '', lastDay: day(lastDay),
            }).map((t, i) => <p key={i} className={i === 0 ? 'font-bold' : 'mt-2'}>{t}</p>)}
          </div>
          {q.sent_at && <p className="text-sm text-ink-500">Signed and sent by the contractor, {facts.legalName}, on {day(q.sent_at)}.{q.accepted_at ? ` Signed by the buyer, ${q.accepted_name}, on ${day(q.accepted_at)}.` : ''}</p>}
        </div>
      </details>
    </section>
  );
}
