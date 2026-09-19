/**
 * consent.ts (server) — writing down what the customer was shown, in the transaction that
 * created the thing they were shown it for.
 *
 * The words are `src/shared/consent.ts`, which the browser renders from the same function. This
 * file is only the record: §17602(a)(6) requires verification of the consent to be kept for
 * "at least three years, or one year after the contract is terminated, whichever period is
 * longer", which is why `consents` is a table and not a boolean on `subscriptions` that the
 * first cancellation would overwrite (migration 023 says this at length).
 *
 * THE ROW GOES IN THE SAME TRANSACTION AS THE BOOKING. Not before it — a consent for a booking
 * that then failed is a record of nothing. Not after — a commit that succeeds and a follow-up
 * insert that fails leaves a live subscription with no evidence behind it, which is the single
 * state this table exists to make impossible. `createBooking` already holds a client open;
 * `recordConsent` takes it.
 *
 * WHAT IT REFUSES. A one-time job has no renewal to consent to (R9 §0), so `assertConsent`
 * demands a consent id for a subscription and forbids one for a one-time charge. Both halves
 * matter: the missing row is the compliance failure, and the spurious row is a claim that a
 * customer agreed to a renewal that was never offered.
 */
import type { PoolClient } from 'pg';
import { db } from './db.js';

export type ConsentKind = 'renewal' | 'price_change' | 'marketing';

export type ConsentRecord = {
  customerId: string;
  subscriptionId: string;
  kind: ConsentKind;
  /** The sentence as rendered, from `renewalTerms().sentence`. Never composed here. */
  textShown: string;
  /** The recurring amount the sentence names, so a stored row can be checked against a price. */
  priceCents: number;
  lane: 'prepay' | 'payafter' | 'onetime' | null;
  ip: string | null;
  userAgent: string | null;
};

/** Writes the consent inside a transaction the caller owns. Returns the row id. */
export async function recordConsent(client: PoolClient, r: ConsentRecord): Promise<string> {
  if (!r.textShown.trim()) throw new Error('recordConsent: refusing to store an empty consent');
  if (!Number.isInteger(r.priceCents) || r.priceCents < 0) {
    throw new Error(`recordConsent: price_cents must be a non-negative integer, got ${r.priceCents}`);
  }
  const { rows } = await client.query(
    `insert into consents (customer_id, subscription_id, kind, text_shown, price_cents, lane, ip, user_agent)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [r.customerId, r.subscriptionId, r.kind, r.textShown, r.priceCents, r.lane, r.ip, r.userAgent]);
  return rows[0].id as string;
}

/**
 * The gate money.ts asks before it opens a subscription Checkout.
 *
 * `startSubscription()` will not create a session without the id this returns, so the failure
 * mode is a booking that stops rather than a customer who is charged for a renewal they never
 * agreed to. `chargeOnce()` does not call this and must not — see the header.
 */
export async function consentIdFor(subscriptionId: string): Promise<string> {
  const { rows } = await db().query(
    `select id from consents where subscription_id = $1 and kind = 'renewal' order by agreed_at desc limit 1`,
    [subscriptionId]);
  if (!rows[0]) throw new Error(`no_consent_for_subscription:${subscriptionId}`);
  return rows[0].id as string;
}

/** The trimmed request metadata the statute's "verification" is made of. Never the whole header. */
export function requestFingerprint(headers: Headers | Record<string, string | undefined>): {
  ip: string | null; userAgent: string | null;
} {
  const get = (k: string) =>
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get(k)
      : (headers as Record<string, string | undefined>)[k] ?? null;
  // Vercel puts the client address in x-forwarded-for, first entry.
  const fwd = get('x-forwarded-for');
  const ip = fwd ? String(fwd).split(',')[0].trim().slice(0, 64) : null;
  const ua = get('user-agent');
  return { ip: ip || null, userAgent: ua ? String(ua).slice(0, 400) : null };
}
