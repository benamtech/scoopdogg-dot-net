/**
 * comms.ts — talking to customers after they have bought (P16 §7, loops 2 and 3).
 *
 * Loop 1, speed to lead, is `unfinished()` in growth.ts and predates this file: a prefilled
 * `sms:` link on the admin, sent from Josue's own phone. Loop 2 is the lifecycle messages and
 * loop 3 is the review request. `lifecycle.ts` is the neighbouring file and owns only the
 * California renewal-law notices; the split is by obligation, not by channel.
 *
 * FOUR THINGS SHAPE EVERY FUNCTION HERE, and all four are properties of this business rather
 * than opinions about messaging:
 *
 * 1. THERE IS NO SCHEDULER. `vercel.json` has no `crons` key. Anything that must happen on a
 *    date happens when somebody reads, exactly as `expireDuePauses()` does — so the sweeps here
 *    are called from the admin's own screens, and if nobody looks, nothing is sent. That is the
 *    safe direction: a message not sent is recoverable, a message sent twice is not.
 *
 * 2. ONCE ONLY, PROVEN ON THE OUTBOX. Every sender records `about` so `sentAlready()` can find
 *    its own previous send. Before 2026-09-19 `sendEmail()` wrote no such key and the identical
 *    mechanism in `lifecycle.ts` silently never matched — see the note there.
 *
 * 3. THE CHANNEL IS A ROW, AND ONE OF THE ROWS ASKS FOR SOMETHING WE CANNOT DO.
 *    `visit.completion_notify_channel` is `"sms"` and `notify.customer_channel_default` is
 *    `"sms"`, and this project has no SMS transport — deliberately: P16 §7 rules out Twilio
 *    until 10DLC registration, which takes weeks and is not a code problem. So `customerChannel()`
 *    returns the channel AND whether it can be delivered, and a message routed to a channel we
 *    do not have is written to `outbox` as a pending `sms` row for Josue to send from his own
 *    phone. It is NOT quietly emailed instead. Switching a customer's channel behind a settings
 *    row that says otherwise is how a system ends up disagreeing with its own configuration.
 *
 * 4. NOTHING HERE CHARGES A CARD. Every message is a message.
 */
import { db } from './db.js';
import { sendEmail } from './notify.js';
import { appendEvent } from './events.js';
import { loadCatalog } from './catalog-db.js';
import { safeError } from './http.js';
import { formatCents } from '../../src/shared/pricing.js';

/**
 * Anything that can run a query: the pool, or a client inside a transaction.
 *
 * The two selectors below take one so `gates/lead-comms.mjs` can plant rows, ask THE REAL
 * QUERY who is eligible, and roll back — without sending a single email. A gate that
 * re-implemented the eligibility rule would pass whenever the copy was right and the shipped
 * code was wrong, which is the one thing a gate must never do.
 */
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

const SITE = () => process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.net';
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const first = (name: unknown) => String(name ?? '').trim().split(' ')[0];

const shell = (title: string, body: string) => `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
  <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;color:#0F2A1F;margin:24px 0 12px">${title}</h1>${body}</div>`;

const signoff = (phone: string, email: string) =>
  `<p style="font-size:15px;line-height:1.6;color:#5B6660">Scoop Dogg${phone ? ` · ${phone}` : ''}${email ? ` · <a href="mailto:${esc(email)}" style="color:#24593F">${esc(email)}</a>` : ''}</p>`;

type Business = { phone: string; email: string; reviewUrl: string | null };

async function business(): Promise<Business> {
  const { settings } = await loadCatalog();
  const url = settings.get('reviews.google_profile_url');
  return {
    phone: String(settings.get('business.phone') ?? ''),
    email: String(settings.get('business.email') ?? ''),
    // No code default. The site has one in src/lib/catalog.ts and a second declaration of the
    // same URL here is the "one number, two homes" defect this project keeps paying for. If the
    // row is missing the review request does not go out, and says so, rather than mailing
    // customers a link somebody guessed.
    reviewUrl: typeof url === 'string' && url.startsWith('http') ? url : null,
  };
}

/** Has this message already gone out for this subject, inside this window? */
async function sentAlready(purpose: string, key: 'subscription_id' | 'customer_id' | 'visit_id', id: string, sinceDays: number): Promise<boolean> {
  const { rows } = await db().query(
    `select 1 from outbox
      where purpose = $1 and payload->>$2 = $3 and state <> 'failed'
        and created_at > now() - ($4 || ' days')::interval
      limit 1`, [purpose, key, id, String(sinceDays)]);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------
// The channel, and the one we cannot deliver on
// ---------------------------------------------------------------------------------------

export type Channel = { name: string; deliverable: boolean; why: string | null };

/**
 * What channel a customer message should use, and whether this system can actually deliver it.
 *
 * `deliverable` is the half that matters. `sms` is configured and has no transport, so a caller
 * that ignores this field would either crash or silently email somebody who asked for a text.
 */
export async function customerChannel(settingKey: string): Promise<Channel> {
  const { settings } = await loadCatalog();
  const name = String(settings.get(settingKey) ?? 'email');
  if (name === 'email') return { name, deliverable: true, why: null };
  if (name === 'sms') {
    return { name, deliverable: false, why: 'no SMS transport on this project (P16 §7: Twilio waits on 10DLC registration)' };
  }
  return { name, deliverable: false, why: `unknown channel "${name}"` };
}

/**
 * Queue a message on a channel we cannot send ourselves, so it becomes a line on Josue's list
 * rather than nothing at all. `outbox.kind` already allows 'sms'; the row is the record.
 */
async function queueForOwner(args: {
  purpose: string; body: string; phone: string | null;
  about: { subscription_id?: string; customer_id?: string; visit_id?: string };
  why: string;
}): Promise<number | null> {
  const digits = String(args.phone ?? '').replace(/\D/g, '');
  const href = digits.length >= 10 ? `sms:+1${digits.slice(-10)}?&body=${encodeURIComponent(args.body)}` : null;
  try {
    const { rows } = await db().query(
      `insert into outbox (kind, purpose, provider, payload, state, demo, attempts)
       values ('sms', $1, 'owner_handset', $2::jsonb, 'pending', false, 0) returning id`,
      [args.purpose, JSON.stringify({ body: args.body, sms_href: href, to: args.phone ?? null, reason: args.why, ...args.about })]);
    return Number(rows[0].id);
  } catch (e) {
    safeError('comms:queue-owner', e);
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Loop 2 — the lifecycle messages
// ---------------------------------------------------------------------------------------

/**
 * A visit is done. Told on the channel `visit.completion_notify_channel` names, which today is
 * `sms` and therefore lands on Josue's phone as a prefilled text rather than in an inbox.
 *
 * The photo rides along when there is one. `visits.photo_urls` is on the row and is shown on the
 * customer's account page; there is no photo STORAGE on this project, so in practice the array
 * is empty until one exists. The message does not claim a photo it does not have.
 */
export async function sendVisitComplete(visitId: string): Promise<{ sent: boolean; channel: string; reason?: string }> {
  const { rows } = await db().query(
    `select v.id, v.photo_urls, v.crew_notes, v.scheduled_for::text as day,
            s.id as subscription_id, c.id as customer_id, c.name, c.email, c.phone, p.address
       from visits v
       join subscriptions s on s.id = v.subscription_id
       join customers c on c.id = s.customer_id
       join properties p on p.id = v.property_id
      where v.id = $1 and v.completed_at is not null`, [visitId]);
  const v = rows[0];
  if (!v) return { sent: false, channel: 'none', reason: 'no such completed visit' };
  if (await sentAlready('visit_complete', 'visit_id', v.id, 30)) return { sent: false, channel: 'none', reason: 'already sent' };

  const b = await business();
  const channel = await customerChannel('visit.completion_notify_channel');
  const photos: string[] = v.photo_urls ?? [];

  if (!channel.deliverable) {
    const body = `Hi${first(v.name) ? ` ${first(v.name)}` : ''} — Josue from Scoop Dogg. All done at ${v.address} today, gate closed behind me.`;
    const id = await queueForOwner({
      purpose: 'visit_complete', body, phone: v.phone,
      about: { visit_id: v.id, subscription_id: v.subscription_id, customer_id: v.customer_id },
      why: channel.why ?? 'channel not deliverable',
    });
    await appendEvent(db(), {
      subjectKind: 'visit', subjectId: v.id, type: 'notice.visit_complete_queued',
      actorKind: 'system', payload: { outbox_id: id, channel: channel.name, reason: channel.why },
    });
    return { sent: false, channel: channel.name, reason: channel.why ?? undefined };
  }

  const r = await sendEmail({
    purpose: 'visit_complete',
    about: { visit_id: v.id, subscription_id: v.subscription_id, customer_id: v.customer_id },
    recipients: { explicit: [v.email] },
    fromName: 'Scoop Dogg',
    subject: 'Your yard is done',
    html: shell(`All done${first(v.name) ? `, ${first(v.name)}` : ''}.`, `
      <p style="font-size:16px;line-height:1.6">We were at <strong>${esc(v.address)}</strong> today and the yard is clean. The gate is closed behind us.</p>
      ${v.crew_notes ? `<p style="font-size:15px;line-height:1.6;color:#5B6660">${esc(v.crew_notes)}</p>` : ''}
      ${photos.length ? `<p style="font-size:15px">${photos.map((u) => `<img src="${esc(u)}" alt="Your yard after today's visit" style="max-width:100%;border-radius:8px;margin:6px 0" />`).join('')}</p>` : ''}
      <p style="font-size:15px;line-height:1.6"><a href="${SITE()}/account" style="color:#24593F">See your plan and your visits</a></p>
      ${signoff(b.phone, b.email)}`),
  });
  if (r.state !== 'failed') {
    await appendEvent(db(), {
      subjectKind: 'visit', subjectId: v.id, type: 'notice.visit_complete',
      actorKind: 'system', payload: { outbox_id: r.outboxId, photos: photos.length },
    });
  }
  return { sent: r.state !== 'failed', channel: channel.name };
}

/**
 * A payment failed. Called from the Stripe webhook, which is the only place that learns of it.
 *
 * It does not say "we will retry on the 14th", because Stripe's retry schedule is Stripe's and
 * this system does not read it. It says what is true: the card was declined, and here is where
 * to change it.
 */
export async function sendPaymentFailed(subscriptionId: string, invoiceId: string): Promise<{ sent: boolean; reason?: string }> {
  const { rows } = await db().query(
    `select s.id, s.monthly_price_cents, c.id as customer_id, c.name, c.email
       from subscriptions s join customers c on c.id = s.customer_id where s.id = $1`, [subscriptionId]);
  const s = rows[0];
  if (!s) return { sent: false, reason: 'no such subscription' };
  // Seven days: Stripe retries a failed invoice several times over about that window, and one
  // message per failed invoice is the intent, not one per retry.
  if (await sentAlready('payment_failed', 'subscription_id', s.id, 7)) return { sent: false, reason: 'already sent' };

  const b = await business();
  const r = await sendEmail({
    purpose: 'payment_failed',
    about: { subscription_id: s.id, customer_id: s.customer_id },
    recipients: { explicit: [s.email] },
    fromName: 'Scoop Dogg',
    subject: 'Your card was declined',
    html: shell(`A payment did not go through${first(s.name) ? `, ${first(s.name)}` : ''}.`, `
      <p style="font-size:16px;line-height:1.6">Your bank declined the ${formatCents(s.monthly_price_cents, { forceDecimals: s.monthly_price_cents % 100 !== 0 })} monthly payment for your Scoop Dogg plan. It happens — usually an expired card or a new number.</p>
      <p style="font-size:16px;line-height:1.6"><a href="${SITE()}/account" style="color:#24593F"><strong>Update your card</strong></a> and we will carry on as normal. Your visits are still on the calendar.</p>
      ${signoff(b.phone, b.email)}`),
  });
  if (r.state !== 'failed') {
    await appendEvent(db(), {
      subjectKind: 'subscription', subjectId: s.id, type: 'notice.payment_failed',
      actorKind: 'system', payload: { outbox_id: r.outboxId, invoice: invoiceId },
    });
  }
  return { sent: r.state !== 'failed' };
}

/**
 * Cards that expire at the end of this month or next. A sweep, run on read.
 *
 * `payment_methods.exp_month` and `exp_year` are our own columns, written when the card was
 * saved, so this needs nothing from Stripe. A card expires at the END of its month, so the
 * comparison is against the first of the month after it.
 */
export async function cardsExpiringSoon(q: Queryable = db()) {
  const { rows } = await q.query(`
    select pm.id, pm.brand, pm.last4, pm.exp_month, pm.exp_year,
           c.id as customer_id, c.name, c.email, s.id as subscription_id
      from payment_methods pm
      join customers c on c.id = pm.customer_id
      join subscriptions s on s.customer_id = c.id and s.state = 'active'
     where pm.detached_at is null
       and make_date(pm.exp_year, pm.exp_month, 1) + interval '1 month'
             between now() and now() + interval '60 days'`);
  return rows;
}

export async function sendCardExpiring(): Promise<{ considered: number; sent: number }> {
  const rows = await cardsExpiringSoon();
  const b = await business();
  let sent = 0;
  for (const pm of rows) {
    if (await sentAlready('card_expiring', 'customer_id', pm.customer_id, 60)) continue;
    const r = await sendEmail({
      purpose: 'card_expiring',
      about: { customer_id: pm.customer_id, subscription_id: pm.subscription_id },
      recipients: { explicit: [pm.email] },
      fromName: 'Scoop Dogg',
      subject: 'Your card is about to expire',
      html: shell(`A heads-up${first(pm.name) ? `, ${first(pm.name)}` : ''}.`, `
        <p style="font-size:16px;line-height:1.6">The ${esc(pm.brand ?? 'card')} ending <strong>${esc(pm.last4 ?? '••••')}</strong> on your Scoop Dogg plan expires at the end of ${String(pm.exp_month).padStart(2, '0')}/${esc(pm.exp_year)}.</p>
        <p style="font-size:16px;line-height:1.6"><a href="${SITE()}/account" style="color:#24593F"><strong>Add the new one</strong></a> whenever suits you — nothing changes until then.</p>
        ${signoff(b.phone, b.email)}`),
    });
    if (r.state !== 'failed') {
      sent++;
      await appendEvent(db(), {
        subjectKind: 'subscription', subjectId: pm.subscription_id, type: 'notice.card_expiring',
        actorKind: 'system', payload: { outbox_id: r.outboxId, last4: pm.last4 },
      });
    }
  }
  return { considered: rows.length, sent };
}

/**
 * A cancellation was requested. Confirms what was actually agreed: the plan runs to the end of
 * the period already paid for, and the date it stops.
 *
 * `cancelPlan` sets `cancel_at_period_end` rather than ending the plan on the spot, so a message
 * saying "your plan has been cancelled" would be wrong on the day it is read.
 */
export async function sendCancelConfirmation(subscriptionId: string): Promise<{ sent: boolean; reason?: string }> {
  const { rows } = await db().query(
    `select s.id, s.current_period_end::text as ends_on, c.id as customer_id, c.name, c.email
       from subscriptions s join customers c on c.id = s.customer_id where s.id = $1`, [subscriptionId]);
  const s = rows[0];
  if (!s) return { sent: false, reason: 'no such subscription' };
  if (await sentAlready('cancel_confirmation', 'subscription_id', s.id, 30)) return { sent: false, reason: 'already sent' };

  const b = await business();
  const ends = s.ends_on
    ? new Date(`${String(s.ends_on).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  const r = await sendEmail({
    purpose: 'cancel_confirmation',
    about: { subscription_id: s.id, customer_id: s.customer_id },
    recipients: { explicit: [s.email] },
    fromName: 'Scoop Dogg',
    subject: 'Your Scoop Dogg plan is cancelled',
    html: shell('That is all sorted.', `
      <p style="font-size:16px;line-height:1.6">Your plan will not renew${ends ? `, and your last visit is covered through <strong>${ends}</strong>` : ''}. You will not be charged again.</p>
      <p style="font-size:16px;line-height:1.6">If you change your mind you can start again from <a href="${SITE()}/account" style="color:#24593F">your account</a>, and nothing is lost.</p>
      <p style="font-size:15px;line-height:1.6">Thanks for having us in your yard.</p>
      ${signoff(b.phone, b.email)}`),
  });
  if (r.state !== 'failed') {
    await appendEvent(db(), {
      subjectKind: 'subscription', subjectId: s.id, type: 'notice.cancel_confirmation',
      actorKind: 'system', payload: { outbox_id: r.outboxId },
    });
  }
  return { sent: r.state !== 'failed' };
}

// ---------------------------------------------------------------------------------------
// Loop 3 — the review request
// ---------------------------------------------------------------------------------------

/**
 * Ask for a review once a customer has had enough visits to have an opinion worth writing.
 *
 * The threshold is `growth.review_request_after_visits`, a row that has existed since migration
 * 018 with the value 3 and has had NO reader until now — found by reading the settings rows
 * rather than by asking Josue what the number should be.
 *
 * It fires on the count of completed visits and on nothing else, once per customer, and offers
 * no incentive. There is no sentiment check anywhere in the query because there is nothing in
 * this system that knows how a customer feels — the only signal it has is that three visits
 * happened.
 *
 * It needs `reviews.google_profile_url` in settings. Without it there is no link to send and
 * the sweep reports that rather than inventing one.
 */
export async function eligibleForReviewRequest(after: number, q: Queryable = db()) {
  const { rows } = await q.query(`
    select c.id as customer_id, c.name, c.email, count(v.id) as done
      from customers c
      join subscriptions s on s.customer_id = c.id
      join visits v on v.subscription_id = s.id and v.state = 'completed' and v.completed_at is not null
     group by c.id, c.name, c.email
    having count(v.id) >= $1`, [after]);
  return rows;
}

export async function sendReviewRequests(): Promise<{ eligible: number; sent: number; blocked?: string }> {
  const { settings } = await loadCatalog();
  const after = Number(settings.get('growth.review_request_after_visits') ?? 0);
  if (!Number.isFinite(after) || after < 1) {
    return { eligible: 0, sent: 0, blocked: 'growth.review_request_after_visits is not a positive number' };
  }
  const b = await business();
  if (!b.reviewUrl) {
    return { eligible: 0, sent: 0, blocked: 'reviews.google_profile_url is not set, so there is no link to send' };
  }

  const rows = await eligibleForReviewRequest(after);

  let sent = 0;
  for (const c of rows) {
    // 3650 days: once per customer, not once per period. Asking the same person again next year
    // is a decision somebody should make on purpose.
    if (await sentAlready('review_request', 'customer_id', c.customer_id, 3650)) continue;
    const r = await sendEmail({
      purpose: 'review_request',
      about: { customer_id: c.customer_id },
      recipients: { explicit: [c.email] },
      fromName: 'Scoop Dogg',
      subject: 'How are we doing?',
      html: shell(`${first(c.name) ? `${first(c.name)}, ` : ''}would you write us a line?`, `
        <p style="font-size:16px;line-height:1.6">We have been out to your yard ${Number(c.done)} times now. If it has been going well, a short review on Google helps other dog owners nearby find us — it is how most of them do.</p>
        <p style="font-size:16px;line-height:1.6"><a href="${esc(b.reviewUrl)}" style="color:#24593F"><strong>Leave a review</strong></a></p>
        <p style="font-size:15px;line-height:1.6;color:#5B6660">And if something has not been right, reply to this email instead and Josue will sort it.</p>
        ${signoff(b.phone, b.email)}`),
    });
    if (r.state !== 'failed') {
      sent++;
      await appendEvent(db(), {
        subjectKind: 'customer', subjectId: c.customer_id, type: 'notice.review_request',
        actorKind: 'system', payload: { outbox_id: r.outboxId, completed_visits: Number(c.done), after },
      });
    }
  }
  return { eligible: rows.length, sent };
}

/**
 * The sweeps that have no scheduler behind them, run together from the admin on read.
 *
 * Failures are caught per sweep: a card-expiry query that throws must not stop the review
 * requests, and neither must stop the screen that called this from rendering.
 */
export async function runCommsSweeps(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of [
    ['card_expiring', sendCardExpiring],
    ['review_request', sendReviewRequests],
  ] as const) {
    try { out[name] = await fn(); }
    catch (e) { safeError(`comms:${name}`, e); out[name] = { error: true }; }
  }
  return out;
}
