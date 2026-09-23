/**
 * cards.ts — the writer for `payment_methods`.
 *
 * WHY THIS FILE EXISTS, and it is the third time this project has paid for the same shape.
 * `payment_methods` has been in the schema since migration 005. Measured against the live
 * database on 2026-09-23: **zero rows.** The only `insert into payment_methods` in the whole
 * repository was inside `gates/lead-comms.mjs`, which plants a card, asks `cardsExpiringSoon()`
 * to find it, and rolls back. Per file that gate is correct. Across files it meant the
 * card-expiry warning — written, styled, wired into the sweep the admin board runs on read, and
 * covered by a passing check — **has never been able to send one message**, because nothing in
 * production ever put a card in the table for it to find.
 *
 * `gates/writers-outside-gates.mjs` is the check that can see that, and this file is what makes
 * it green honestly rather than by exception.
 *
 * WHY IT MATTERS IN MONEY. The card-expiry warning is the one message that prevents INVOLUNTARY
 * churn — a customer who never chose to leave, whose card simply ran out. Losing them costs
 * Josue the subscription and costs AMTECH 9% of every payment it would have carried.
 *
 * WHERE THE FACTS COME FROM. Stripe, and only Stripe. `exp_month` and `exp_year` are our own
 * columns — `cardsExpiringSoon()` reads them without calling the API, which is what lets the
 * sweep run on every admin page load — but they are COPIES, written here from the card Stripe
 * reports. Nothing in this file invents, infers or defaults a card fact. A payment method that
 * is not a card, or is not attached to a customer we know, is recorded as skipped and said so.
 *
 * DIRECT CHARGES, SO THE CUSTOMER IS ON JOSUE'S ACCOUNT. Migration 005's own column comment says
 * it: with direct charges the Stripe Customer and its payment methods belong to the CONNECTED
 * account, so the join back to a customer of ours goes through `stripe_customers`, which is the
 * only table that holds that correspondence.
 *
 * THIS FILE DOES NOT CHARGE ANYTHING. `money.ts` owns every verb that moves money; this owns the
 * record of what is on file.
 */
import type Stripe from 'stripe';
import { db } from './db.js';
import type { StripeMode } from './stripe.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * The Stripe events that reach this file, named ONCE.
 *
 * `scripts/register-webhook.mjs` subscribes the endpoint to a list, and `api/stripe-webhook.ts`
 * handles a list, and for the whole life of this project those were two lists that happened to
 * agree. They stopped agreeing the moment a handler was added. `gates/card-on-file.mjs` reads
 * this constant and pins both to it, so a writer can no longer land without its trigger.
 *
 *   attached               a card was put on file. THE ROW IS BORN HERE.
 *   automatically_updated  the card network reissued it — new number, new expiry, same customer.
 *                          This is the event that keeps `exp_year` from going stale, and it is
 *                          the reason the expiry warning can be trusted at all.
 *   updated                a detail changed (billing address, nickname). Cheap to fold in.
 *   detached               the card came off. `detached_at` is what takes it out of the sweep.
 */
export const CARD_EVENTS = [
  'payment_method.attached',
  'payment_method.automatically_updated',
  'payment_method.updated',
  'payment_method.detached',
] as const;

export type CardEventType = (typeof CARD_EVENTS)[number];

export type CardWriteResult =
  | { recorded: true; action: 'attached' | 'updated' | 'detached'; paymentMethodId: string; customerId: string | null }
  | { recorded: false; reason: string };

/**
 * Put a card on file, or bring the one on file up to date.
 *
 * Idempotent on `stripe_pm_id`, which already carries a unique index — Stripe retries webhooks,
 * and `payment_method.attached` arriving twice must not produce two cards on one plan.
 *
 * RE-ATTACHING CLEARS `detached_at`. A customer who removes a card and adds the same one back is
 * a customer with a card, and a row left marked detached would drop them out of the expiry sweep
 * for the rest of the plan's life.
 */
export async function recordCard(
  pm: Stripe.PaymentMethod,
  ctx: { mode: StripeMode; accountId?: string | null },
  q: Queryable = db(),
): Promise<CardWriteResult> {
  const id = String(pm?.id ?? '');
  if (!id.startsWith('pm_')) return { recorded: false, reason: 'not a payment method' };
  if (pm.type !== 'card' || !pm.card) return { recorded: false, reason: `not a card (${pm.type})` };

  const stripeCustomerId = typeof pm.customer === 'string' ? pm.customer : (pm.customer?.id ?? null);
  if (!stripeCustomerId) return { recorded: false, reason: 'not attached to a customer' };

  // The correspondence lives in one table. No fallback, no fuzzy match on email: a card written
  // against the wrong customer would tell the wrong person their card is expiring.
  const { rows } = await q.query(
    `select customer_id from stripe_customers where stripe_customer_id = $1`, [stripeCustomerId]);
  const ours = rows[0]?.customer_id ?? null;
  if (!ours) return { recorded: false, reason: `no customer of ours for ${stripeCustomerId}` };

  const { rows: written } = await q.query(
    `insert into payment_methods
       (customer_id, stripe_customer_id, stripe_pm_id, brand, last4, exp_month, exp_year, livemode, account_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (stripe_pm_id) do update set
       brand       = excluded.brand,
       last4       = excluded.last4,
       exp_month   = excluded.exp_month,
       exp_year    = excluded.exp_year,
       livemode    = excluded.livemode,
       account_id  = coalesce(excluded.account_id, payment_methods.account_id),
       detached_at = null
     returning id, (xmax = 0) as inserted`,
    [ours, stripeCustomerId, id, pm.card.brand ?? null, pm.card.last4 ?? null,
     pm.card.exp_month ?? null, pm.card.exp_year ?? null, ctx.mode === 'live', ctx.accountId ?? null]);

  return {
    recorded: true,
    action: written[0]?.inserted ? 'attached' : 'updated',
    paymentMethodId: id,
    customerId: ours,
  };
}

/** The card came off the customer. It stops counting the moment `detached_at` is set. */
export async function detachCard(pmId: string, q: Queryable = db()): Promise<CardWriteResult> {
  const id = String(pmId ?? '');
  if (!id.startsWith('pm_')) return { recorded: false, reason: 'not a payment method' };
  const { rows } = await q.query(
    `update payment_methods set detached_at = now()
      where stripe_pm_id = $1 and detached_at is null
      returning customer_id`, [id]);
  return rows.length
    ? { recorded: true, action: 'detached', paymentMethodId: id, customerId: rows[0].customer_id }
    : { recorded: false, reason: 'no card on file with that id' };
}

/**
 * Which card the plan actually bills, from the subscription Stripe says it bills.
 *
 * `is_default` is declared `not null default false` and had no writer either, so every row this
 * file writes would have read "not the default" forever — true of nothing, and misleading on a
 * customer with two cards. Stripe's subscription is the authority, so this is only ever called
 * with what a subscription event reported.
 */
export async function markDefaultCard(stripeCustomerId: string, stripePmId: string, q: Queryable = db()): Promise<boolean> {
  if (!String(stripePmId ?? '').startsWith('pm_') || !String(stripeCustomerId ?? '')) return false;
  const { rows } = await q.query(
    `update payment_methods
        set is_default = (stripe_pm_id = $2)
      where stripe_customer_id = $1 and detached_at is null
      returning stripe_pm_id, is_default`, [stripeCustomerId, stripePmId]);
  return rows.some((r) => r.is_default);
}

/**
 * The webhook's card branch, as a function rather than as four `if`s in an HTTP handler.
 *
 * `api/stripe-webhook.ts` calls this and `gates/card-on-file.mjs` calls this, which is the point:
 * the gate exercises the SAME dispatch the live endpoint uses, so "the event is handled" and "the
 * row lands" are one claim instead of two that can drift. A gate that re-implemented the routing
 * would pass on a day the webhook had stopped routing.
 */
export async function handleCardEvent(
  event: { type: string; account?: string | null; data: { object: unknown } },
  mode: StripeMode,
  q: Queryable = db(),
): Promise<CardWriteResult> {
  if (!(CARD_EVENTS as readonly string[]).includes(event.type)) {
    return { recorded: false, reason: `not a card event (${event.type})` };
  }
  const pm = event.data.object as Stripe.PaymentMethod;
  if (event.type === 'payment_method.detached') return detachCard(String(pm?.id ?? ''), q);
  return recordCard(pm, { mode, accountId: event.account ?? null }, q);
}
