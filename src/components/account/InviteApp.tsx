/**
 * The invite link a cash customer opens (P18 §3).
 *
 * The whole screen is one promise: nothing changes. Same service, same price, same day — the only
 * difference is that the card pays instead of them remembering. So the price is printed large and
 * as THEIR price, the day is printed, and the way out is offered in the same breath as the way in:
 * ignore this and keep paying cash. An invite that reads like a demand is how a small business
 * loses a customer it already had.
 */
import { useEffect, useState } from 'react';
import type { RenewalTerms } from '../../shared/consent';

type Invite = {
  name: string; price_cents: number; address: string | null; area: string | null;
  starts_on: string; weekday: string; accepted: boolean;
  /**
   * The renewal terms, rendered by the server from the same module the funnel uses. They arrive
   * with the invite rather than being composed here, because the price on an invite is the one
   * Josue typed for this customer and only the server has it.
   */
  terms: RenewalTerms;
};

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

async function api(path: string, token: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`/api/account/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

export default function InviteApp({ phone, phoneHref }: { phone: string; phoneHref: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  /** §17602(a)(4), exactly as on the funnel's review step. Starts false, never restored. */
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get('t') ?? '';
    setToken(t);
    if (!t) { setError('That link is missing its code. Ask Josue to send it again.'); return; }
    api('invite/read', t).then(setInvite).catch((e) => setError((e as Error).message));
  }, []);

  const addCard = async () => {
    if (!invite || !agreed) return;
    setBusy(true); setError('');
    try {
      const j = await api('invite/accept', token, { consent_text: invite.terms.sentence });
      if (j.url) { window.location.href = j.url as string; return; }
      setError('Your plan is already set up. Check your account.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (error && !invite) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-line bg-paper p-8">
        <h1 className="text-h3 text-forest-900">We could not open that link</h1>
        <p className="mt-3 text-base text-ink-700">{error}</p>
        <p className="mt-4 text-base text-ink-700">Call Josue on <a className="link" href={phoneHref}>{phone}</a> and he will sort it out.</p>
      </div>
    );
  }
  if (!invite) return <div className="mx-auto h-64 max-w-lg animate-pulse rounded-xl bg-line/50" />;

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-paper p-8 shadow-md">
      <h1 className="text-h3 text-forest-900">You're all set, {invite.name.split(' ')[0]}.</h1>
      <p className="mt-3 text-lg text-ink-700">
        Josue's added you to online billing. Add a card and you're done — <strong className="font-semibold text-forest-900">same service, same price, same day</strong>.
      </p>
      <dl className="mt-6 divide-y divide-line rounded-lg bg-forest-50">
        <div className="flex justify-between px-5 py-4"><dt className="text-base text-ink-500">Your price</dt>
          <dd className="font-serif text-h3 text-forest-900">{money(invite.price_cents)}<span className="text-base text-ink-500">/month</span></dd></div>
        <div className="flex justify-between px-5 py-4"><dt className="text-base text-ink-500">Your day</dt>
          <dd className="text-base font-medium text-forest-900">{invite.weekday}</dd></div>
        {invite.address && (
          <div className="flex justify-between gap-4 px-5 py-4"><dt className="text-base text-ink-500">Where</dt>
            <dd className="text-right text-base text-forest-900">{invite.address}{invite.area ? `, ${invite.area}` : ''}</dd></div>
        )}
      </dl>
      {/*
        The same disclosures the funnel shows, for the same reason: moving a cash customer onto a
        card is a continuous service offer, and §17602 does not care that they were already a
        customer. It reads gently here because nothing about their arrangement is changing —
        which is exactly what the terms say.
      */}
      <div className="mt-6 rounded-lg border-2 border-forest-300 bg-paper p-5" data-consent-block>
        <p className="text-base font-semibold text-forest-900">What you're agreeing to</p>
        <ul className="mt-3 space-y-2">
          {invite.terms.disclosures.map((d) => (
            <li key={d.cite} data-consent-cite={d.cite} className="flex gap-2.5 text-base text-ink-700">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-forest-500" />
              <span>{d.text}</span>
            </li>
          ))}
        </ul>
        <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-line pt-4">
          <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-sm border-line-strong text-forest-600 focus-visible:shadow-focus"
            aria-describedby="invite-consent-sentence" />
          <span id="invite-consent-sentence" data-consent-sentence className="text-base text-forest-900">
            {invite.terms.sentence}
          </span>
        </label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-100 px-4 py-3 text-base text-danger">{error}</p>}
      <button type="button" className="btn-primary btn-lg mt-6 w-full" disabled={busy || !agreed} onClick={addCard}>
        {busy ? 'One moment…' : 'Add my card'}
      </button>
      {!agreed && <p className="mt-2 text-center text-sm text-ink-500" role="status">Tick the box above to continue.</p>}
      <p className="mt-3 text-center text-sm text-ink-500">Cancel anytime · Your price is not going up</p>
      <p className="mt-6 border-t border-line pt-5 text-base text-ink-700">
        Rather keep paying cash or Venmo? That's completely fine — just tell Josue and ignore this.
        Questions: <a className="link" href={phoneHref}>{phone}</a>.
      </p>
    </div>
  );
}
