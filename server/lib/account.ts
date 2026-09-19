/**
 * What a signed-in customer sees and can do. Every verb checks the subscription belongs to
 * the session's customer, changes Stripe first when money is involved, then the database, then
 * appends an event - so the account, Stripe and the admin never disagree about a plan.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { stripeFor, type StripeMode } from './stripe.js';
import { loadCatalog } from './catalog-db.js';
import { sendEmail } from './notify.js';
import { safeError } from './http.js';
import { catchUpForWeeks, formatCents, weekdayName, type CatchUp } from '../../src/shared/pricing.js';

export class AccountError extends Error {
  constructor(public userMessage: string, public status = 400) { super(userMessage); }
}

/**
 * The pause lengths the account screen offers. Two weeks is the plain one; four weeks is the
 * offer the cancel dialog makes to save a customer who is leaving.
 */
export const PAUSE_WEEKS = [2, 4] as const;

/**
 * WHAT A PAUSE COSTS WHEN YOU COME BACK — Josue's rule, on the door nobody had looked at.
 *
 * `catchUpFor` applies the rule at booking, from an answer the customer typed. Here there is no
 * answer to read: the system knows the plan is about to go N weeks without a visit, which is the
 * same fact measured instead of asked. Same rows, same bands, same numbers (migration 026).
 *
 * It is governed by the same settings row as booking, `booking.initial_cleanup_policy`, so the
 * rule has one switch and not two. When the policy is `offer_optional` — what the site did
 * until 2026-09-19 — a pause costs nothing to come back from, as before.
 */
export async function catchUpForPause(weeks: number, serviceSlug: string): Promise<CatchUp> {
  const catalog = await loadCatalog();
  const policy = String(catalog.settings.get('booking.initial_cleanup_policy') ?? 'offer_optional');
  if (policy !== 'required_beyond_two_weeks') return { kind: 'none' };
  return catchUpForWeeks(catalog, serviceSlug, weeks);
}

/** The shape the account screen renders. A tier id is of no use to a person. */
function publicCatchUp(c: CatchUp) {
  if (c.kind === 'none') return null;
  if (c.kind === 'quote') return { kind: 'quote' as const, label: c.tier.label, cents: null };
  return { kind: 'charge' as const, label: c.tier.label, cents: c.cents, band: c.band };
}

export async function overview(customerId: string) {
  // A pause that has reached its end date comes back here, because this is one of the two
  // places anybody looks. See expireDuePauses() for why the clock is ours and not Stripe's.
  await expireDuePauses(customerId);
  const { rows: [customer] } = await db().query(`select id, name, email, phone from customers where id = $1`, [customerId]);
  const { rows: subs } = await db().query(
    `select s.id, s.state, s.service_slug, s.frequency, s.service_weekday, s.starts_on::text as starts_on, s.monthly_price_cents,
            s.current_period_end, s.cancel_at_period_end, s.payment_state, s.paused_from::text as paused_from, s.paused_until::text as paused_until,
            s.livemode, s.resume_catch_up_cents, s.resume_catch_up_tier_id, pk.name as package_name, pk.short_label, p.address, p.city, p.gate_code is not null as has_gate_code, p.access_notes
       from subscriptions s join properties p on p.id = s.property_id left join packages pk on pk.id = s.package_id
      where s.customer_id = $1 and s.state in ('active','paused','deposit_pending','draft')
      order by s.created_at desc`, [customerId]);
  const ids = subs.map((s: Record<string, any>) => s.id);
  const { rows: visits } = ids.length ? await db().query(
    `select id, subscription_id, scheduled_for::text as date, state, completed_at, photo_urls
       from visits where subscription_id = any($1::uuid[]) and scheduled_for >= current_date - 30
      order by scheduled_for limit 40`, [ids]) : { rows: [] };
  const { rows: invoices } = await db().query(
    `select id, total_cents, state, paid_at, hosted_invoice_url, period_start::text as period_start
       from invoices where customer_id = $1 order by created_at desc limit 12`, [customerId]);
  // What each pause length would cost to come back from, priced from Josue's own rows so the
  // buttons can say it BEFORE the customer commits. A save offer that hides a consequence is
  // the thing the consent work in step 6 exists to stop us doing.
  const withOptions = await Promise.all(subs.map(async (s: Record<string, any>) => ({
    ...s,
    weekday: weekdayName(s.service_weekday),
    pause_options: await Promise.all(PAUSE_WEEKS.map(async (weeks) => ({
      weeks, catch_up: publicCatchUp(await catchUpForPause(weeks, s.service_slug)),
    }))),
  })));
  return {
    customer,
    subscriptions: withOptions,
    visits,
    invoices,
  };
}

async function ownSubscription(customerId: string, subscriptionId: string) {
  const { rows } = await db().query(`select * from subscriptions where id = $1 and customer_id = $2`, [subscriptionId, customerId]);
  if (!rows[0]) throw new AccountError('We could not find that plan on your account.', 404);
  return rows[0];
}

const mode = (s: { livemode: boolean }): StripeMode => (s.livemode ? 'live' : 'test');

export async function skipVisit(customerId: string, visitId: string) {
  const { rows } = await db().query(
    `update visits v set state = 'skipped', customer_note = 'Skipped by customer', updated_at = now()
       from subscriptions s where v.id = $1 and v.subscription_id = s.id and s.customer_id = $2
        and v.state = 'scheduled' and v.scheduled_for > current_date returning v.id, v.subscription_id, v.scheduled_for::text as date`,
    [visitId, customerId]);
  if (!rows[0]) throw new AccountError('That visit can no longer be skipped.', 409);
  await appendEvent(db(), { subjectKind: 'visit', subjectId: visitId, type: 'visit.skipped', from: 'scheduled', to: 'skipped', actorKind: 'customer', actorId: customerId, payload: { date: rows[0].date } });
  return rows[0];
}

export async function unskipVisit(customerId: string, visitId: string) {
  const { rows } = await db().query(
    `update visits v set state = 'scheduled', customer_note = '', updated_at = now()
       from subscriptions s where v.id = $1 and v.subscription_id = s.id and s.customer_id = $2
        and v.state = 'skipped' and v.scheduled_for > current_date returning v.id`, [visitId, customerId]);
  if (!rows[0]) throw new AccountError('That visit cannot be restored.', 409);
  await appendEvent(db(), { subjectKind: 'visit', subjectId: visitId, type: 'visit.unskipped', from: 'skipped', to: 'scheduled', actorKind: 'customer', actorId: customerId });
  return rows[0];
}

/**
 * Pause the plan — and say, before the customer commits, what coming back will cost.
 *
 * TWO THINGS CHANGED HERE ON 2026-09-19.
 *
 * 1. NO `resumes_at` GOES TO STRIPE. It used to. Stripe's own documentation defines it as "a
 *    Unix timestamp after which the subscription resumes collecting payments" — Stripe resumes
 *    by itself, with no call from us. Nothing on this side moved the row off 'paused': there is
 *    no cron in vercel.json, and the `customer.subscription.updated` handler only moves
 *    `payment_state` off 'trialing'. So on the day a pause ended, Stripe charged the card, no
 *    visits existed to work, and the account screen still read "No charges while paused." The
 *    customer paid for nothing and was told they were paying nothing.
 *
 *    There is one clock now and it is ours. Stripe pauses indefinitely; `paused_until` is our
 *    promise to the customer; `expireDuePauses()` keeps it. If nobody ever looks, the plan stays
 *    paused and the customer is not charged — the safe direction of the two.
 *
 * 2. THE RETURN VISIT IS PRICED AND FROZEN NOW. Josue: "when yard has not been cleaned longer
 *    than a couple weeks it would increase price because the default price is based on having a
 *    weekly clean." A four-week pause — the offer this system makes to save a cancelling
 *    customer — lands inside his "Heavy buildup (3-6 weeks)" band. It is decided here, from the
 *    rows, and written onto the subscription, so a price edit later cannot change a promise
 *    already made to somebody.
 */
export async function pausePlan(customerId: string, subscriptionId: string, weeks: number) {
  const s = await ownSubscription(customerId, subscriptionId);
  if (s.state !== 'active') throw new AccountError('Only an active plan can be paused.', 409);
  const w = Math.max(1, Math.min(12, Math.trunc(weeks)));
  const until = new Date(Date.now() + w * 7 * 86_400_000);
  const catchUp = await catchUpForPause(w, s.service_slug);
  if (s.stripe_subscription_id) {
    await stripeFor(mode(s)).subscriptions.update(s.stripe_subscription_id, {
      pause_collection: { behavior: 'void' },
    }, { stripeAccount: s.account_id });
  }
  await db().query(
    `update subscriptions set state = 'paused', paused_from = current_date, paused_until = $2::date,
            resume_catch_up_tier_id = $3, resume_catch_up_cents = $4, updated_at = now() where id = $1`,
    [subscriptionId, until.toISOString().slice(0, 10),
     catchUp.kind === 'none' ? null : catchUp.tier.id,
     catchUp.kind === 'charge' ? catchUp.cents : null]);
  await db().query(
    `update visits set state = 'skipped', customer_note = 'Plan paused', updated_at = now()
      where subscription_id = $1 and state = 'scheduled' and scheduled_for > current_date and scheduled_for <= $2::date`,
    [subscriptionId, until.toISOString().slice(0, 10)]);
  await appendEvent(db(), { subjectKind: 'subscription', subjectId: subscriptionId, type: 'subscription.paused', from: 'active', to: 'paused', actorKind: 'customer', actorId: customerId, payload: { weeks: w, catch_up_tier: catchUp.kind === 'none' ? null : catchUp.tier.id } });
  return { paused_until: until.toISOString().slice(0, 10), catch_up: publicCatchUp(catchUp) };
}

/**
 * Bring a paused plan back. Shared by the customer's "Resume now" and by `expireDuePauses()`,
 * because a pause that ends on its own date must do exactly what a pause a customer ends does —
 * two code paths for one transition is how Stripe and this database came to disagree in the
 * first place.
 */
async function applyResume(s: Record<string, any> & { livemode: boolean }, actor: { kind: 'customer' | 'system'; id?: string }) {
  if (s.stripe_subscription_id) {
    await stripeFor(mode(s)).subscriptions.update(s.stripe_subscription_id, { pause_collection: '' as never }, { stripeAccount: s.account_id });
  }
  const owed = s.resume_catch_up_tier_id
    ? { tier_id: s.resume_catch_up_tier_id as string, cents: (s.resume_catch_up_cents ?? null) as number | null }
    : null;
  await db().query(
    `update subscriptions set state = 'active', paused_from = null, paused_until = null,
            resume_catch_up_tier_id = null, resume_catch_up_cents = null, updated_at = now() where id = $1`, [s.id]);
  await db().query(
    `update visits set state = 'scheduled', customer_note = '', updated_at = now()
      where subscription_id = $1 and state = 'skipped' and customer_note = 'Plan paused' and scheduled_for > current_date`, [s.id]);
  await appendEvent(db(), { subjectKind: 'subscription', subjectId: s.id, type: 'subscription.resumed', from: 'paused', to: 'active', actorKind: actor.kind, actorId: actor.id, payload: { ended_by: actor.kind, catch_up_owed_cents: owed?.cents ?? null } });
  if (owed) {
    await appendEvent(db(), { subjectKind: 'subscription', subjectId: s.id, type: 'subscription.resume_catch_up_owed', actorKind: 'system', payload: owed });
    await notifyOwnerOfCatchUp(s, owed).catch((e) => safeError('account:resume_catch_up_notify', e));
  }
  return owed;
}

/**
 * JOSUE IS TOLD, AND NO CARD IS TOUCHED. He is paid in cash and Venmo today and he is the one
 * standing in the yard, so the working answer for his business is that the catch-up arrives as
 * a line on his own list rather than as an off-session charge the customer chose weeks ago and
 * has had time to forget. Charging it automatically is a money feature with its own consent
 * question; `chargeSavedCard()` in money.ts is the door when that is decided.
 */
async function notifyOwnerOfCatchUp(s: Record<string, any>, owed: { tier_id: string; cents: number | null }) {
  const catalog = await loadCatalog();
  const tier = catalog.tiers.find((t) => t.id === owed.tier_id);
  const { rows: [c] } = await db().query(
    `select c.name, c.phone, c.email, p.address, p.city from subscriptions s
       join customers c on c.id = s.customer_id join properties p on p.id = s.property_id where s.id = $1`, [s.id]);
  const price = owed.cents == null ? 'you price it — his Severe band takes no card' : formatCents(owed.cents);
  await sendEmail({
    purpose: 'subscription_change',
    recipients: { settingKey: 'notify.lead_recipients' },
    ccSettingKey: 'notify.lead_cc',
    fromName: 'Scoop Dogg',
    subject: `Catch-up due on the first visit back — ${c?.name ?? 'a customer'}`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
      <p style="font-size:15px">A paused plan just came back on. The yard has been sitting long enough that the
      weekly price does not cover the first visit — the same rule the booking form applies.</p>
      <table style="width:100%;border-collapse:collapse;background:#FAF8F5">
        <tr><td style="padding:6px 12px;color:#5B6660">Customer</td><td style="padding:6px 12px;font-weight:600">${String(c?.name ?? '').replace(/</g, '&lt;')}</td></tr>
        <tr><td style="padding:6px 12px;color:#5B6660">Address</td><td style="padding:6px 12px;font-weight:600">${[c?.address, c?.city].filter(Boolean).join(', ').replace(/</g, '&lt;')}</td></tr>
        <tr><td style="padding:6px 12px;color:#5B6660">Phone</td><td style="padding:6px 12px;font-weight:600">${String(c?.phone ?? '').replace(/</g, '&lt;')}</td></tr>
        <tr><td style="padding:6px 12px;color:#5B6660">Catch-up</td><td style="padding:6px 12px;font-weight:600">${String(tier?.label ?? 'catch-up clean').replace(/</g, '&lt;')}</td></tr>
        <tr><td style="padding:6px 12px;color:#5B6660">Amount</td><td style="padding:6px 12px;font-weight:600">${price}</td></tr>
      </table>
      <p style="font-size:13px;color:#5B6660">The customer was shown this amount when they chose the pause length. Their weekly price is unchanged.</p>
    </div>`,
  });
}

export async function resumePlan(customerId: string, subscriptionId: string) {
  const s = await ownSubscription(customerId, subscriptionId);
  if (s.state !== 'paused') throw new AccountError('That plan is not paused.', 409);
  const owed = await applyResume(s, { kind: 'customer', id: customerId });
  return { ok: true, catch_up_cents: owed?.cents ?? null };
}

/**
 * THE CLOCK. A pause carries a date we promised the customer; nothing on Vercel runs on a
 * schedule to honour it (there is no `crons` key in vercel.json), so it is honoured on read,
 * from the customer's own account page and from the admin's business board. Whichever happens
 * first brings the plan back.
 *
 * This is deliberately not "resume whatever Stripe resumed". Stripe was told to pause
 * indefinitely precisely so that it has no opinion about when the plan comes back — one clock,
 * and a plan that stays paused too long is visible on Josue's board rather than silently
 * billed.
 */
export async function expireDuePauses(customerId?: string) {
  const { rows } = await db().query(
    `select * from subscriptions
      where state = 'paused' and paused_until is not null and paused_until <= current_date
      ${customerId ? 'and customer_id = $1' : ''}`, customerId ? [customerId] : []);
  let resumed = 0;
  for (const s of rows) {
    try { await applyResume(s, { kind: 'system' }); resumed += 1; }
    catch (e) { safeError('account:expire_due_pause', e); }
  }
  return resumed;
}

export async function cancelPlan(customerId: string, subscriptionId: string, reason: string) {
  const s = await ownSubscription(customerId, subscriptionId);
  if (!['active', 'paused'].includes(s.state)) throw new AccountError('That plan is not active.', 409);
  if (s.stripe_subscription_id) {
    await stripeFor(mode(s)).subscriptions.update(s.stripe_subscription_id, { cancel_at_period_end: true }, { stripeAccount: s.account_id });
  }
  await db().query(
    `update subscriptions set cancel_at_period_end = true, cancel_reason = $2, updated_at = now() where id = $1`,
    [subscriptionId, reason.slice(0, 500)]);
  await appendEvent(db(), { subjectKind: 'subscription', subjectId: subscriptionId, type: 'subscription.cancel_requested', actorKind: 'customer', actorId: customerId, payload: { reason: reason.slice(0, 200) } });
  return { ends_at: s.current_period_end };
}

export async function keepPlan(customerId: string, subscriptionId: string) {
  const s = await ownSubscription(customerId, subscriptionId);
  if (!s.cancel_at_period_end) return { ok: true };
  if (s.stripe_subscription_id) {
    await stripeFor(mode(s)).subscriptions.update(s.stripe_subscription_id, { cancel_at_period_end: false }, { stripeAccount: s.account_id });
  }
  await db().query(`update subscriptions set cancel_at_period_end = false, cancel_reason = null, updated_at = now() where id = $1`, [subscriptionId]);
  await appendEvent(db(), { subjectKind: 'subscription', subjectId: subscriptionId, type: 'subscription.cancel_withdrawn', actorKind: 'customer', actorId: customerId });
  return { ok: true };
}

/** Card updates and receipts through Stripe's own billing portal, on Josue's account. */
export async function billingPortalUrl(customerId: string, returnUrl: string) {
  const { rows } = await db().query(
    `select livemode, account_id, stripe_customer_id from subscriptions
      where customer_id = $1 and stripe_customer_id is not null order by created_at desc limit 1`, [customerId]);
  if (!rows[0]) throw new AccountError('There is no card on this account yet.', 404);
  const session = await stripeFor(rows[0].livemode ? 'live' : 'test').billingPortal.sessions.create(
    { customer: rows[0].stripe_customer_id, return_url: returnUrl }, { stripeAccount: rows[0].account_id });
  return session.url;
}
