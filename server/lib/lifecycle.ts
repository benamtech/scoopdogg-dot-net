/**
 * lifecycle.ts — the three notices California's renewal law requires AFTER the sale.
 *
 * Step 6 built the consent at the point of sale. These are the obligations that outlive it, and
 * R9 §6 and §8 are where each one's statutory text and day window are quoted.
 *
 * | Notice | Statute | When | Owed today? |
 * |---|---|---|---|
 * | `renewal_reminder`       | §17602(h)    | annually, from activation      | YES — (h) covers "continuous service", not only annual terms |
 * | `price_change_notice`    | §17602(g)(2) | 7–30 days before a fee change  | when a price on a LIVE subscription moves |
 * | `promo_or_term_notice`   | §17602(b)    | 3–21 days before a >31-day promo ends; 15–45 days before a ≥1-year term renews | NOT YET, and one product decision away |
 *
 * WHY THE THIRD ONE EXISTS BEFORE IT IS OWED. "First month half off" lasts at most 31 days and
 * §17602(b)(1) triggers at *more than* 31 — one day of margin. No package has a term of a year,
 * so §17602(b)(2) does not fire either. But P15 §9 ships an annual option on `/pricing` and R7 §5
 * recommends prepay, so both are live paths. A sentence in a plan saying "remember the notice if
 * you add an annual plan" is a writer with no reader; `gates/consent.mjs` reads the rows instead
 * and fails the build if either threshold is crossed while the sender is missing. This file is
 * what makes that gate's demand satisfiable.
 *
 * NOTHING HERE HAS EVER RUN AGAINST A REAL SUBSCRIPTION, because this system has never taken a
 * payment. The queries are exercised by the gate against planted rows; the sends are not.
 *
 * EVERY NOTICE IS IDEMPOTENT ON THE OUTBOX. A notice is "already sent" when a non-failed `outbox`
 * row exists for that purpose, that subscription and that window. So the runner can be a cron, a
 * command somebody types, or both, and running it twice in a minute sends nothing twice.
 */
import { db } from './db.js';
import { sendEmail } from './notify.js';
import { appendEvent } from './events.js';
import { loadCatalog } from './catalog-db.js';
import { formatCents } from '../../src/shared/pricing.js';

const niceDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

type Contact = { cancelEmail: string; phone: string; site: string };

async function contact(): Promise<Contact> {
  const settings = (await loadCatalog()).settings;
  return {
    cancelEmail: String(settings.get('business.email') ?? ''),
    phone: String(settings.get('business.phone') ?? ''),
    site: process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.net',
  };
}

/**
 * The block §17602(a)(8) requires every one of these notices to carry: that it renews unless
 * cancelled, the renewal period, the amount and frequency, a way to cancel, a LINK to the
 * cancellation process when sent electronically, and the business's contact details.
 *
 * One function, so a notice cannot ship with four of the six.
 */
function noticeBody(opts: {
  lead: string; amountCents: number; whenLabel: string; c: Contact;
}): string {
  const { lead, amountCents, whenLabel, c } = opts;
  return `
    <p style="font-size:16px;line-height:1.6">${lead}</p>
    <ul style="font-size:15px;line-height:1.7;color:#1A1A1A;padding-left:18px">
      <li>Your plan renews automatically unless you cancel it.</li>
      <li>It renews every month, and continues month to month with no fixed term.</li>
      <li>You will be charged <strong>${formatCents(amountCents, { forceDecimals: amountCents % 100 !== 0 })}</strong> a month${whenLabel ? `, ${whenLabel}` : ''}.</li>
      <li>To cancel: <a href="${c.site}/account" style="color:#24593F">open your account and press Cancel</a>${c.cancelEmail ? `, or reply to this email or write to <a href="mailto:${c.cancelEmail}" style="color:#24593F">${c.cancelEmail}</a>` : ''}. You do not need to sign in to cancel by email.</li>
    </ul>
    <p style="font-size:15px;line-height:1.6;color:#5B6660">Scoop Dogg${c.phone ? ` · ${c.phone}` : ''}${c.cancelEmail ? ` · ${c.cancelEmail}` : ''}</p>`;
}

const shell = (title: string, body: string) => `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
  <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;color:#0F2A1F;margin:24px 0 12px">${title}</h1>${body}</div>`;

/**
 * Has this notice already gone out for this subscription inside this window?
 *
 * IT DEPENDS ON THE SENDER PASSING `about`. This reads `payload->>'subscription_id'`, and until
 * 2026-09-19 `sendEmail()` never wrote that key — measured across every outbox row in the
 * database, zero carried it — so this returned false every time and the "idempotent on the
 * outbox" promise in this file's header was not kept by anything. It had never misfired only
 * because no subscription is a year old yet.
 *
 * `gates/lead-comms.mjs` now pins the pair: a sender whose `purpose` is checked here must pass
 * `about`, or the gate names it. The two halves lived in different files, which is the same
 * shape as the tsconfig/`_compile.mjs` split that killed the funnel on every deployment.
 *
 * `state <> 'failed'` is deliberate: a refused send must not block the retry.
 */
async function alreadySent(purpose: string, subscriptionId: string, sinceDays: number): Promise<boolean> {
  const { rows } = await db().query(
    `select 1 from outbox
      where purpose = $1
        and payload->>'subscription_id' = $2
        and state <> 'failed'
        and created_at > now() - ($3 || ' days')::interval
      limit 1`, [purpose, subscriptionId, String(sinceDays)]);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------
// §17602(h) — the annual reminder. Applies to a continuous service, not only an annual term.
// ---------------------------------------------------------------------------------------

export async function sendAnnualReminders(): Promise<{ considered: number; sent: number }> {
  const { rows } = await db().query(`
    select s.id, s.monthly_price_cents, c.email, c.name
      from subscriptions s
      join customers c on c.id = s.customer_id
     where s.state = 'active'
       and s.frequency <> 'one_time'
       and s.activated_at is not null
       and s.activated_at < now() - interval '1 year'`);
  const c = await contact();
  let sent = 0;
  for (const s of rows) {
    if (await alreadySent('renewal_reminder', s.id, 300)) continue;
    const r = await sendEmail({
      purpose: 'renewal_reminder',
      about: { subscription_id: s.id },
      recipients: { explicit: [s.email] },
      fromName: 'Scoop Dogg',
      subject: 'Your Scoop Dogg plan — your yearly reminder',
      html: shell(`A quick yearly note, ${String(s.name).split(' ')[0]}.`, noticeBody({
        lead: 'Nothing is changing. California asks us to remind you once a year what your plan is and how to stop it, so here it is.',
        amountCents: s.monthly_price_cents, whenLabel: 'on the same day each month', c,
      })),
    });
    if (r.state !== 'failed') {
      sent++;
      await appendEvent(db(), {
        subjectKind: 'subscription', subjectId: s.id, type: 'notice.renewal_reminder',
        actorKind: 'system', payload: { outbox_id: r.outboxId, statute: '17602(h)' },
      });
    }
  }
  return { considered: rows.length, sent };
}

// ---------------------------------------------------------------------------------------
// §17602(g)(2) — a fee change: 7 to 30 days' notice, with cancellation instructions.
// ---------------------------------------------------------------------------------------

/**
 * Called when a price on a LIVE subscription is about to move. It does not change the price —
 * it is the notice that has to precede one. §17602(i)(3): the requirement is fulfilled BEFORE
 * the change is implemented, so the caller sends this, waits out the window, then applies it.
 *
 * Note what this is NOT for. A change to the published ladder never touches a live subscription
 * — `stripe_prices` is keyed on `packages.version`, so grandfathering is structural — and that
 * is exactly why this path is rare and explicit rather than automatic.
 */
export async function sendPriceChangeNotice(p: {
  subscriptionId: string; newMonthlyCents: number; effectiveOn: string; reason: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const days = Math.round((Date.parse(`${p.effectiveOn}T12:00:00Z`) - Date.now()) / 86_400_000);
  if (days < 7 || days > 30) {
    // Refusing is the correct behaviour: a notice outside the window does not satisfy the
    // statute, and sending one anyway would produce a record that looks like compliance.
    return { sent: false, reason: `effective_on is ${days} days away; §17602(g)(2) requires 7 to 30` };
  }
  const { rows } = await db().query(
    `select s.id, s.monthly_price_cents, c.email, c.name
       from subscriptions s join customers c on c.id = s.customer_id where s.id = $1`, [p.subscriptionId]);
  const s = rows[0];
  if (!s) return { sent: false, reason: 'no such subscription' };
  const c = await contact();
  const was = formatCents(s.monthly_price_cents, { forceDecimals: s.monthly_price_cents % 100 !== 0 });
  const r = await sendEmail({
    purpose: 'price_change_notice',
    about: { subscription_id: p.subscriptionId },
    recipients: { explicit: [s.email] },
    fromName: 'Scoop Dogg',
    subject: `Your Scoop Dogg price is changing on ${niceDate(p.effectiveOn)}`,
    html: shell('A change to your price', noticeBody({
      lead: `From <strong>${niceDate(p.effectiveOn)}</strong> your plan changes from ${was} a month to ` +
            `<strong>${formatCents(p.newMonthlyCents, { forceDecimals: p.newMonthlyCents % 100 !== 0 })}</strong> a month. ${p.reason} ` +
            `If you would rather not continue, you can cancel before then and you will not be charged the new amount.`,
      amountCents: p.newMonthlyCents, whenLabel: `from ${niceDate(p.effectiveOn)}`, c,
    })),
  });
  if (r.state === 'failed') return { sent: false, reason: r.error ?? 'send failed' };
  await appendEvent(db(), {
    subjectKind: 'subscription', subjectId: s.id, type: 'notice.price_change',
    actorKind: 'system',
    payload: { outbox_id: r.outboxId, from_cents: s.monthly_price_cents, to_cents: p.newMonthlyCents, effective_on: p.effectiveOn, statute: '17602(g)(2)' },
  });
  return { sent: true };
}

// ---------------------------------------------------------------------------------------
// §17602(b) — the promo-ending and pre-renewal notices. Not owed today; see the header.
// ---------------------------------------------------------------------------------------

/**
 * §17602(b)(1): a promotional price lasting MORE than 31 days needs notice 3–21 days before it
 * ends. §17602(b)(2): an initial term of a year or longer needs notice 15–45 days before it
 * renews. Both carry the §17602(a)(8) content, which is why they share `noticeBody`.
 *
 * Returns `{ owed: 0 }` while no offer and no package crosses either threshold — which is the
 * state today, and is a measurement rather than an assumption: it reads the rows.
 */
export async function sendPromoOrTermNotices(): Promise<{ owed: number; sent: number }> {
  const { rows } = await db().query(`
    select s.id, s.monthly_price_cents, s.promo_ends_on::text as promo_ends_on,
           s.term_renews_on::text as term_renews_on, c.email, c.name
      from subscriptions s
      join customers c on c.id = s.customer_id
     where s.state = 'active'
       and (
         (s.promo_ends_on is not null
            and s.promo_ends_on between current_date + 3 and current_date + 21)
         or
         (s.term_renews_on is not null
            and s.term_renews_on between current_date + 15 and current_date + 45)
       )`);
  const c = await contact();
  let sent = 0;
  for (const s of rows) {
    if (await alreadySent('promo_or_term_notice', s.id, 60)) continue;
    const endsOn: string = s.promo_ends_on ?? s.term_renews_on;
    const isPromo = Boolean(s.promo_ends_on);
    const r = await sendEmail({
      purpose: 'promo_or_term_notice',
      about: { subscription_id: s.id },
      recipients: { explicit: [s.email] },
      fromName: 'Scoop Dogg',
      subject: isPromo
        ? `Your introductory price ends on ${niceDate(endsOn)}`
        : `Your Scoop Dogg plan renews on ${niceDate(endsOn)}`,
      html: shell(isPromo ? 'Your introductory price is ending' : 'Your plan is about to renew', noticeBody({
        lead: isPromo
          ? `Your introductory price runs until <strong>${niceDate(endsOn)}</strong>. After that the normal price applies.`
          : `Your plan renews on <strong>${niceDate(endsOn)}</strong> unless you cancel before then.`,
        amountCents: s.monthly_price_cents, whenLabel: `from ${niceDate(endsOn)}`, c,
      })),
    });
    if (r.state !== 'failed') {
      sent++;
      await appendEvent(db(), {
        subjectKind: 'subscription', subjectId: s.id, type: 'notice.promo_or_term',
        actorKind: 'system',
        payload: { outbox_id: r.outboxId, ends_on: endsOn, kind: isPromo ? 'promo' : 'term', statute: isPromo ? '17602(b)(1)' : '17602(b)(2)' },
      });
    }
  }
  return { owed: rows.length, sent };
}
