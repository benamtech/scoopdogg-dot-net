/**
 * What a signed-in customer sees and can do. Every verb checks the subscription belongs to
 * the session's customer, changes Stripe first when money is involved, then the database, then
 * appends an event - so the account, Stripe and the admin never disagree about a plan.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { stripeFor, type StripeMode } from './stripe.js';
import { weekdayName } from '../../src/shared/pricing.js';

export class AccountError extends Error {
  constructor(public userMessage: string, public status = 400) { super(userMessage); }
}

export async function overview(customerId: string) {
  const { rows: [customer] } = await db().query(`select id, name, email, phone from customers where id = $1`, [customerId]);
  const { rows: subs } = await db().query(
    `select s.id, s.state, s.service_slug, s.frequency, s.service_weekday, s.starts_on::text as starts_on, s.monthly_price_cents,
            s.current_period_end, s.cancel_at_period_end, s.payment_state, s.paused_from::text as paused_from, s.paused_until::text as paused_until,
            s.livemode, pk.name as package_name, pk.short_label, p.address, p.city, p.gate_code is not null as has_gate_code, p.access_notes
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
  return {
    customer,
    subscriptions: subs.map((s: Record<string, any>) => ({ ...s, weekday: weekdayName(s.service_weekday) })),
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

export async function pausePlan(customerId: string, subscriptionId: string, weeks: number) {
  const s = await ownSubscription(customerId, subscriptionId);
  if (s.state !== 'active') throw new AccountError('Only an active plan can be paused.', 409);
  const w = Math.max(1, Math.min(12, Math.trunc(weeks)));
  const until = new Date(Date.now() + w * 7 * 86_400_000);
  if (s.stripe_subscription_id) {
    await stripeFor(mode(s)).subscriptions.update(s.stripe_subscription_id, {
      pause_collection: { behavior: 'void', resumes_at: Math.floor(until.getTime() / 1000) },
    }, { stripeAccount: s.account_id });
  }
  await db().query(
    `update subscriptions set state = 'paused', paused_from = current_date, paused_until = $2::date, updated_at = now() where id = $1`,
    [subscriptionId, until.toISOString().slice(0, 10)]);
  await db().query(
    `update visits set state = 'skipped', customer_note = 'Plan paused', updated_at = now()
      where subscription_id = $1 and state = 'scheduled' and scheduled_for > current_date and scheduled_for <= $2::date`,
    [subscriptionId, until.toISOString().slice(0, 10)]);
  await appendEvent(db(), { subjectKind: 'subscription', subjectId: subscriptionId, type: 'subscription.paused', from: 'active', to: 'paused', actorKind: 'customer', actorId: customerId, payload: { weeks: w } });
  return { paused_until: until.toISOString().slice(0, 10) };
}

export async function resumePlan(customerId: string, subscriptionId: string) {
  const s = await ownSubscription(customerId, subscriptionId);
  if (s.state !== 'paused') throw new AccountError('That plan is not paused.', 409);
  if (s.stripe_subscription_id) {
    await stripeFor(mode(s)).subscriptions.update(s.stripe_subscription_id, { pause_collection: '' as never }, { stripeAccount: s.account_id });
  }
  await db().query(`update subscriptions set state = 'active', paused_from = null, paused_until = null, updated_at = now() where id = $1`, [subscriptionId]);
  await db().query(
    `update visits set state = 'scheduled', customer_note = '', updated_at = now()
      where subscription_id = $1 and state = 'skipped' and customer_note = 'Plan paused' and scheduled_for > current_date`, [subscriptionId]);
  await appendEvent(db(), { subjectKind: 'subscription', subjectId: subscriptionId, type: 'subscription.resumed', from: 'paused', to: 'active', actorKind: 'customer', actorId: customerId });
  return { ok: true };
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
