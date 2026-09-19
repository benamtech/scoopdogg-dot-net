/**
 * money.ts — THE ONE PLACE THIS CODEBASE CREATES A CHARGE.
 *
 * notify.ts is the one place it talks to the mail provider, and the reason given there is exactly
 * the reason here: *"a demo check added to one of them is absent from the other two, and the
 * fourth one somebody writes next month forgets it entirely."* Every word of that is true of a
 * platform fee. A money path with no fee is a silent leak, and a leak that only shows up on a
 * statement Josue reads three months later.
 *
 * `gates/one-money-door.mjs` counts the files that call Stripe's charge APIs and requires the
 * answer to be one. It counts DOORS, not parameters, on purpose: a grep for a missing parameter
 * can be fooled by a variable, a grep for a door cannot.
 *
 * THE FEE COMES FROM THE ROWS, NOT FROM A CONSTANT. `stripe_connection.platform_fee_bps` is the
 * single writer; migrations 012 and 015 moved it (400 -> 700 -> 900) and no code anywhere types
 * a percentage. Each subscription freezes the percentage it was sold on, which is what makes
 * "a price change applies to new customers only" structural rather than a promise.
 *
 * THE TWO THINGS STRIPE DOES NOT DO BY DEFAULT, both of which cost money if they are forgotten:
 *
 *  1. `application_fee_percent` reaches subscription invoices and nothing else. Stripe, verbatim:
 *     it *"doesn't apply to invoices you create outside of a subscription billing period"*. So a
 *     $269 yard deep clean booked through the site would pay AMTECH nothing unless the one-time
 *     path sets `application_fee_amount` itself. That is `chargeOnce()`.
 *  2. A refund KEEPS the application fee unless the refund asks otherwise. The working agreement
 *     says, in Josue's copy, *"If a payment is refunded, the fee on it is refunded too."* A clause
 *     in a client agreement that the code does not keep is worse than no clause, so `refund()`
 *     sets `refund_application_fee: true` always, and takes no argument that could turn it off.
 *
 * NO PAYMENT HAS EVER BEEN TAKEN BY THIS SYSTEM. Everything below is code, not evidence, until
 * gates/checkout-e2e.mjs reaches PASS(paid).
 */
import type Stripe from 'stripe';
import { db } from './db.js';
import { resolve, type StripeMode } from './stripe.js';

/**
 * The platform's cut of an amount, in cents, read from the rows and CAPPED AT THE AMOUNT.
 *
 * The cap is not defensive decoration. Stripe: *"the application fee amount set directly on an
 * invoice ... is capped at the invoice's final charge amount"* — send more and the API answers an
 * error, not a rounding difference. A one-cent overflow on a refunded-to-zero invoice is the
 * shape that would do it.
 */
export async function feeCentsFor(amountCents: number, mode: StripeMode): Promise<number> {
  const { rows } = await db().query(
    `select platform_fee_bps from stripe_connection where livemode = $1`, [mode === 'live']);
  const bps = Number(rows[0]?.platform_fee_bps ?? 0);
  if (!Number.isFinite(bps) || bps < 0) throw new Error('platform_fee_bps_unreadable');
  if (amountCents <= 0) return 0;
  return Math.min(Math.round((amountCents * bps) / 10_000), amountCents);
}

/** The percentage Stripe wants on a subscription, from the same row, as a number like 9. */
export async function feePercentFor(mode: StripeMode): Promise<number> {
  const { rows } = await db().query(
    `select platform_fee_bps from stripe_connection where livemode = $1`, [mode === 'live']);
  const bps = Number(rows[0]?.platform_fee_bps ?? 0);
  if (!Number.isFinite(bps) || bps < 0) throw new Error('platform_fee_bps_unreadable');
  return bps / 100;
}

export type SubscriptionCheckout = {
  mode: StripeMode;
  /**
   * The `consents` row for this subscription. REQUIRED, and the reason is structural rather
   * than tidy: California's ARL (BPC §17602(a)(2)) makes it unlawful to charge for an automatic
   * renewal without having obtained express consent to its terms first, and §17602(a)(6) makes
   * us keep the evidence for three years. Putting it in the signature means the only way to
   * open a subscription Checkout is to have already written the record - a compliance rule that
   * fails at the type level and then again at runtime, instead of in a review nobody does.
   *
   * `chargeOnce()` deliberately has no equivalent. A one-time job neither renews nor continues,
   * so the article does not reach it, and demanding a renewal consent for one would mean
   * storing a record that a customer agreed to something they were never offered. R9 §0.
   */
  consentId: string;
  customerId: string;                 // the Stripe customer, on the connected account
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  couponId?: string | null;
  description: string;
  metadata: Record<string, string>;
  submitMessage: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  /** Lane B (P16 §5): the card is saved and nothing is charged until this many days out. */
  trialPeriodDays?: number | null;
};

/**
 * Lane A and lane B: a subscription Checkout on the connected account, with the fee on it.
 *
 * Lane B is the same session plus a trial. `payment_method_collection` stays at its default so
 * the card IS saved, and `missing_payment_method: 'cancel'` means a trial that reaches its end
 * with no card cancels rather than silently continuing unpaid.
 */
export async function startSubscription(p: SubscriptionCheckout): Promise<Stripe.Checkout.Session> {
  // TypeScript cannot see a `null!` that crossed an API boundary, so the runtime says no too.
  if (!p.consentId) throw new Error('startSubscription: refusing to charge a renewal with no consent record');
  const { stripe, account } = await resolve(p.mode);
  const trial = p.trialPeriodDays && p.trialPeriodDays > 0
    ? {
      trial_period_days: p.trialPeriodDays,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
    }
    : {};
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: p.customerId,
    line_items: p.lineItems,
    ...(p.couponId ? { discounts: [{ coupon: p.couponId }] } : { allow_promotion_codes: false }),
    subscription_data: {
      application_fee_percent: await feePercentFor(p.mode),
      description: p.description,
      // The consent id travels onto the Stripe object too, so a row in Stripe's dashboard can
      // be traced back to the sentence the customer read without opening our database.
      metadata: { ...p.metadata, consent_id: p.consentId },
      ...trial,
    },
    metadata: { ...p.metadata, consent_id: p.consentId },
    custom_text: { submit: { message: p.submitMessage } },
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
  }, { stripeAccount: account, idempotencyKey: p.idempotencyKey });
}

export type OneTimeCheckout = {
  mode: StripeMode;
  customerId: string;
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  amountCents: number;                // what the line items add up to, for the fee
  metadata: Record<string, string>;
  submitMessage: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

/**
 * A one-time job — a cleanup, a deep clean, a pressure wash — with `application_fee_amount`,
 * because the percentage parameter does not reach this path at all.
 *
 * NO CALLER YET. The funnel books 4 of 11 services today and sends the one-time work to /contact;
 * P16 §3 is what gives this a caller. It is written now because the fee decision and the money
 * door are one piece of thinking, and adding the door later is how the fourth call site forgets.
 */
export async function chargeOnce(p: OneTimeCheckout): Promise<Stripe.Checkout.Session> {
  const { stripe, account } = await resolve(p.mode);
  const fee = await feeCentsFor(p.amountCents, p.mode);
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: p.customerId,
    line_items: p.lineItems,
    payment_intent_data: { application_fee_amount: fee, metadata: p.metadata },
    metadata: p.metadata,
    custom_text: { submit: { message: p.submitMessage } },
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
  }, { stripeAccount: account, idempotencyKey: p.idempotencyKey });
}

export type SavedCardCharge = {
  mode: StripeMode;
  customerId: string;                 // the Stripe customer on the connected account
  paymentMethodId: string;            // a card already attached to that customer
  amountCents: number;
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

/**
 * Charge a card that is already on file, with nobody at the keyboard.
 *
 * P16 §5: a one-time job may be booked with a SetupIntent that saves the card, and charged when
 * the visit is marked complete — a crew that drives to a $269 deep clean and finds nobody home is
 * a real loss. That is this verb. Like `chargeOnce()` it sets `application_fee_amount` itself,
 * because the percentage parameter reaches subscription invoices and nothing else.
 *
 * `off_session: true` tells Stripe the customer is not present, which is what makes the card
 * networks treat a decline as a decline rather than as a request for authentication.
 *
 * NO CALLER IN THE FUNNEL YET — P16 §3 gives it one. It exists now because
 * gates/refund-returns-the-fee.mjs needs a real charge to refund, and a gate that reaches past
 * the money door to make one would be the second door the door-counting gate exists to forbid.
 */
export async function chargeSavedCard(p: SavedCardCharge): Promise<Stripe.PaymentIntent> {
  const { stripe, account } = await resolve(p.mode);
  const fee = await feeCentsFor(p.amountCents, p.mode);
  return stripe.paymentIntents.create({
    amount: p.amountCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    off_session: true,
    confirm: true,
    application_fee_amount: fee,
    description: p.description,
    metadata: p.metadata,
  }, { stripeAccount: account, idempotencyKey: p.idempotencyKey });
}

export type RefundRequest = {
  mode: StripeMode;
  /** The charge or payment intent to refund. */
  chargeId?: string;
  paymentIntentId?: string;
  /** Omit to refund the whole thing. */
  amountCents?: number;
  reason?: Stripe.RefundCreateParams.Reason;
  idempotencyKey: string;
};

/**
 * A refund that returns AMTECH's share too — in full on a full refund, proportionally on a
 * partial one. Stripe's own example: a $100 payment with a $5 fee, refunded $40, returns $2.
 *
 * `refund_application_fee` is set here and there is no parameter to turn it off. That is the
 * point: the agreement promises it, and a default that quietly keeps the fee on money the
 * customer got back is the single worst thing this integration could do by accident.
 */
export async function refund(p: RefundRequest): Promise<Stripe.Refund> {
  const { stripe, account } = await resolve(p.mode);
  if (!p.chargeId && !p.paymentIntentId) throw new Error('refund_needs_a_charge_or_payment_intent');
  return stripe.refunds.create({
    ...(p.chargeId ? { charge: p.chargeId } : {}),
    ...(p.paymentIntentId ? { payment_intent: p.paymentIntentId } : {}),
    ...(p.amountCents != null ? { amount: p.amountCents } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    refund_application_fee: true,
    reverse_transfer: false,
  }, { stripeAccount: account, idempotencyKey: p.idempotencyKey });
}
