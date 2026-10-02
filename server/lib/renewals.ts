/**
 * renewals.ts — what a renewal writes into the books, and the fee Stripe actually took on it.
 *
 * WHY THIS IS ITS OWN FILE. Until 2026-09-27 the webhook wrote every `invoice.paid` that was not a
 * subscription's first invoice with `platform_fee_cents` as the literal 0, and wrote no `payments`
 * row at all. Stripe took the right fee every time; the books recorded none of it. And because the
 * fee report Josue's accountant reads (`growth.ts`) sums `payments`, every renewal was not merely
 * fee-less but ABSENT — as was every pay-after customer's first real charge, which Stripe bills as
 * a `subscription_cycle` invoice when the trial ends. The first payment was right only because
 * `completeBooking()` writes it by a different route.
 *
 * THE FEE IS READ BACK FROM STRIPE, NOT RECOMPUTED. `application_fee_percent` times the amount is
 * what we asked for; the PaymentIntent's `application_fee_amount` is what happened. On API version
 * dahlia an invoice's money sits on its InvoicePayments, each pointing at a PaymentIntent.
 * `gates/renewal-books-the-fee.mjs` compares this reading with the platform's own ApplicationFee
 * object for the same charge, which is a different path to the same fact.
 *
 * Every function takes the query client it should use, so the gate can run the shipped code inside
 * a transaction it rolls back, and the webhook passes the pool.
 */
import type Stripe from 'stripe';
import type pg from 'pg';
import { appendEvent } from './events.js';
import type { StripeMode } from './stripe.js';

type Q = pg.Pool | pg.PoolClient;

export type FeeReading = { feeCents: number; paymentIntentId: string | null; chargeId: string | null };

/**
 * The platform fee Stripe took on a paid invoice, in cents.
 *
 * Throws rather than returning 0 when it cannot find the payment. A webhook that fails is retried
 * by Stripe (and, since `claimEvent()`, actually re-processed); a webhook that writes 0 is the
 * defect this file exists to end.
 */
export async function feeStripeTook(stripe: Stripe, account: string, invoiceId: string): Promise<FeeReading> {
  const list = await stripe.invoicePayments.list(
    { invoice: invoiceId, status: 'paid', expand: ['data.payment.payment_intent'] },
    { stripeAccount: account });
  let fee = 0;
  let intentId: string | null = null;
  let chargeId: string | null = null;
  let seen = 0;
  for (const ip of list.data) {
    const intent = typeof ip.payment?.payment_intent === 'object' ? ip.payment.payment_intent as Stripe.PaymentIntent : null;
    if (!intent) continue;
    seen++;
    intentId = intent.id;
    chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id ?? null;
    if (intent.application_fee_amount != null) {
      fee += intent.application_fee_amount;
    } else if (chargeId) {
      // The fee object lives on the PLATFORM, so this read carries no Stripe-Account header.
      const af = await stripe.applicationFees.list({ charge: chargeId, limit: 1 });
      fee += af.data[0]?.amount ?? 0;
    }
  }
  if (!seen) throw new Error(`renewal_fee_unreadable: invoice ${invoiceId} has no paid PaymentIntent`);
  return { feeCents: fee, paymentIntentId: intentId, chargeId };
}

export type RenewalInvoice = {
  id: string;
  subtotal: number;
  amount_paid: number;
  hosted_invoice_url?: string | null;
  period_start?: number | null;
  period_end?: number | null;
};

/**
 * The invoice row and the payment row for one paid renewal. Idempotent on the Stripe invoice id:
 * a second delivery updates nothing it should not and adds no second payment.
 */
export async function recordRenewal(q: Q, r: {
  subscriptionId: string;
  customerId: string;
  invoice: RenewalInvoice;
  fee: FeeReading;
  livemode: boolean;
  accountId: string | null;
}): Promise<{ invoiceRowId: string; paymentWritten: boolean }> {
  const day = (s?: number | null) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : null);
  const { rows: [inv] } = await q.query(
    `insert into invoices (customer_id, subscription_id, period_start, period_end, subtotal_cents, platform_fee_cents, total_cents,
                           state, issued_at, paid_at, stripe_invoice_id, collection_method, livemode, account_id, hosted_invoice_url)
     values ($1,$2,$3::date,$4::date,$5,$6,$7,'paid',now(),now(),$8,'auto',$9,$10,$11)
     on conflict (stripe_invoice_id) where stripe_invoice_id is not null
     do update set state = 'paid', paid_at = coalesce(invoices.paid_at, now()), platform_fee_cents = excluded.platform_fee_cents
     returning id`,
    [r.customerId, r.subscriptionId, day(r.invoice.period_start), day(r.invoice.period_end), r.invoice.subtotal,
     r.fee.feeCents, r.invoice.amount_paid, r.invoice.id, r.livemode, r.accountId, r.invoice.hosted_invoice_url ?? null]);
  const { rowCount } = await q.query(
    `insert into payments (customer_id, invoice_id, kind, amount_cents, currency, stripe_payment_id, stripe_account_id,
                           platform_fee_cents, state, livemode)
     values ($1,$2,'charge',$3,'usd',$4,$5,$6,'succeeded',$7) on conflict do nothing`,
    [r.customerId, inv.id, r.invoice.amount_paid, r.invoice.id, r.accountId, r.fee.feeCents, r.livemode]);
  return { invoiceRowId: inv.id, paymentWritten: (rowCount ?? 0) > 0 };
}

/**
 * The whole `invoice.paid` branch for a subscription invoice after the first, as the webhook runs it.
 * The first invoice (`subscription_create`) belongs to `completeBooking()`.
 */
export async function handleInvoicePaid(q: Q, stripe: Stripe, e: {
  mode: StripeMode; account: string | null; invoice: Stripe.Invoice;
}): Promise<{ recorded: boolean; reason?: string; feeCents?: number }> {
  const inv = e.invoice;
  const subRef = inv.parent?.subscription_details?.subscription;
  const stripeSubId = typeof subRef === 'string' ? subRef : subRef?.id ?? null;
  if (!stripeSubId) return { recorded: false, reason: 'not a subscription invoice' };
  if (inv.billing_reason === 'subscription_create') return { recorded: false, reason: 'first invoice: completeBooking writes it' };
  if (!e.account) return { recorded: false, reason: 'no connected account on the event' };
  const { rows: [sub] } = await q.query(
    `select id, customer_id from subscriptions where stripe_subscription_id = $1`, [stripeSubId]);
  if (!sub) return { recorded: false, reason: 'no subscription row for it' };

  const fee = await feeStripeTook(stripe, e.account, String(inv.id));
  await recordRenewal(q, {
    subscriptionId: sub.id, customerId: sub.customer_id, fee, livemode: e.mode === 'live', accountId: e.account,
    invoice: {
      id: String(inv.id), subtotal: inv.subtotal, amount_paid: inv.amount_paid, hosted_invoice_url: inv.hosted_invoice_url ?? null,
      period_start: inv.period_start, period_end: inv.period_end,
    },
  });
  await q.query(`update subscriptions set payment_state = 'ok', updated_at = now() where id = $1`, [sub.id]);
  await appendEvent(q, {
    subjectKind: 'subscription', subjectId: sub.id, type: 'invoice.paid', actorKind: 'system',
    payload: { invoice: inv.id, amount: inv.amount_paid, fee: fee.feeCents, billing_reason: inv.billing_reason },
  });
  return { recorded: true, feeCents: fee.feeCents };
}

/**
 * Whether to process a webhook delivery: `new`, a `retry` of one whose first processing failed,
 * or a `duplicate` of one already done.
 *
 * The earlier dedupe treated ANY seen event id as a duplicate. Stripe retries a delivery we
 * answered with a 500 — and the retry was then answered "duplicate" and dropped, so a payment
 * whose first processing hit a transient error was never recorded at all. Two deliveries of an
 * unprocessed event can now both run; every handler they reach is idempotent on a Stripe id.
 */
export async function claimEvent(q: Q, ev: { id: string; type: string; account: string | null; payload: unknown }):
  Promise<'new' | 'retry' | 'duplicate'> {
  const { rowCount } = await q.query(
    `insert into stripe_events (id, type, account_id, payload) values ($1,$2,$3,$4::jsonb) on conflict (id) do nothing`,
    [ev.id, ev.type, ev.account, JSON.stringify(ev.payload)]);
  if (rowCount) return 'new';
  const { rows: [seen] } = await q.query(`select processed_at from stripe_events where id = $1`, [ev.id]);
  return seen?.processed_at ? 'duplicate' : 'retry';
}
