/**
 * POST /api/stripe-webhook — Connect events from Josue's account.
 *
 * NOT a verb and not behind the JSON router: signature verification is computed over the RAW
 * body, so this endpoint reads the stream itself and never touches req.body (0520 prompt, trap 2).
 * Deduped on Stripe's event id in stripe_events, so a retried delivery is a no-op.
 */
import type Stripe from 'stripe';
import { db } from '../server/lib/db.js';
import { stripeFor, probeAccount, publishPricesWhenReady, type StripeMode } from '../server/lib/stripe.js';
import { completeBooking } from '../server/lib/booking.js';
import { appendEvent } from '../server/lib/events.js';
import { sendPaymentFailed } from '../server/lib/comms.js';
import { CARD_EVENTS, handleCardEvent, markDefaultCard } from '../server/lib/cards.js';
import { sendJson, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';

async function rawBody(req: ApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  const body = await rawBody(req);
  const sig = String(req.headers['stripe-signature'] ?? '');
  let event: Stripe.Event | null = null;
  let mode: StripeMode = 'test';
  for (const m of ['live', 'test'] as StripeMode[]) {
    const secret = m === 'live' ? process.env.STRIPE_WEBHOOK_SECRET_LIVE : process.env.STRIPE_WEBHOOK_SECRET_TEST;
    if (!secret) continue;
    try { event = stripeFor(m).webhooks.constructEvent(body, sig, secret); mode = m; break; } catch { /* try the other mode */ }
  }
  if (!event) return sendJson(res, 400, { error: 'Invalid signature.' });

  const { rowCount } = await db().query(
    `insert into stripe_events (id, type, account_id, payload) values ($1,$2,$3,$4::jsonb) on conflict (id) do nothing`,
    [event.id, event.type, event.account ?? null, JSON.stringify(event.data.object)]);
  if (!rowCount) return sendJson(res, 200, { received: true, duplicate: true });

  try {
    const obj = event.data.object as unknown as Record<string, unknown>;
    if (event.type === 'checkout.session.completed') {
      const bookingId = (obj.metadata as Record<string, string> | undefined)?.booking_id;
      if (bookingId) await completeBooking(bookingId, String(obj.id), null);
    }
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const inv = obj as unknown as Stripe.Invoice;
      const subId = typeof inv.parent?.subscription_details?.subscription === 'string' ? inv.parent.subscription_details.subscription : null;
      if (subId) {
        const { rows } = await db().query(`select id, customer_id, property_id from subscriptions where stripe_subscription_id = $1`, [subId]);
        const sub = rows[0];
        if (sub && event.type === 'invoice.paid' && inv.billing_reason !== 'subscription_create') {
          await db().query(
            `insert into invoices (customer_id, subscription_id, subtotal_cents, platform_fee_cents, total_cents, state, issued_at, paid_at,
                                   stripe_invoice_id, collection_method, livemode, account_id, hosted_invoice_url)
             values ($1,$2,$3,0,$4,'paid',now(),now(),$5,'auto',$6,$7,$8) on conflict (stripe_invoice_id) where stripe_invoice_id is not null do update set state = 'paid', paid_at = now()`,
            [sub.customer_id, sub.id, inv.subtotal, inv.amount_paid, inv.id, mode === 'live', event.account, inv.hosted_invoice_url]);
          await db().query(`update subscriptions set payment_state = 'ok', updated_at = now() where id = $1`, [sub.id]);
          await appendEvent(db(), { subjectKind: 'subscription', subjectId: sub.id, type: 'invoice.paid', actorKind: 'system', payload: { invoice: inv.id, amount: inv.amount_paid } });
        }
        if (sub && event.type === 'invoice.payment_failed') {
          await db().query(`update subscriptions set payment_state = 'past_due', updated_at = now() where id = $1`, [sub.id]);
          await appendEvent(db(), { subjectKind: 'subscription', subjectId: sub.id, type: 'invoice.payment_failed', actorKind: 'system', payload: { invoice: inv.id } });
          // The webhook is the only place this is ever learned - nothing else watches a card.
          // It must not take the handler down: Stripe retries a non-2xx, and a retried webhook
          // whose only remaining work is an email would re-do the state change above.
          await sendPaymentFailed(sub.id, String(inv.id ?? '')).catch((e) => safeError('webhook:payment-failed-notify', e));
        }
      }
    }
    // THE CARD ON FILE. `payment_methods` had readers since migration 005 and no writer at all:
    // the card-expiry warning has never been able to fire because the table has never held a row
    // outside a gate's rolled-back transaction. This is the writer, and the events it needs are
    // named once in server/lib/cards.ts so `scripts/register-webhook.mjs` cannot drift from it.
    // A card is learned here and nowhere else — nothing else on this site watches one.
    if ((CARD_EVENTS as readonly string[]).includes(event.type)) {
      const r = await handleCardEvent(event, mode);
      console.log(`[stripe-webhook] ${event.type} -> ${r.recorded ? r.action : `skipped: ${r.reason}`}`);
    }

    // THE CONNECTED ACCOUNT'S OWN STATUS (P18 §1.3). The admin re-reads Stripe on every load of
    // the Payments screen, but nobody is looking at that screen the afternoon a document expires
    // and card_payments goes to 'inactive'. This is what notices in between. v2 accounts emit v1
    // `account.updated` on the Connected-accounts scope for merchant-configuration changes, which
    // is why a v1 snapshot endpoint can carry it at all.
    if (event.type === 'account.updated') {
      const fresh = await probeAccount(mode).catch(() => null);
      console.log(`[stripe-webhook] account.updated ${event.account ?? ''} -> card_payments=${fresh?.card_payments ?? 'unread'} ready=${fresh?.ready ?? 'unread'}`);
      // THE MOMENT THE ACCOUNT CAN TAKE A CARD, IT HAS PRICES. Before this, finishing Stripe
      // onboarding left the site live, pointed at a real account, and unable to take a booking
      // because no Price existed on it — and the only thing that fixed that was a button
      // somebody had to remember. Idempotent, and it does nothing until Stripe says active.
      const pub = await publishPricesWhenReady(mode, 'webhook:account.updated').catch((e) => {
        safeError('webhook:publish-prices', e);
        return null;
      });
      if (pub) console.log(`[stripe-webhook] prices: ${pub.attempted ? `${pub.created} created` : `skipped — ${pub.reason}`}`);
    }

    // LANE B, THREE DAYS OUT. Stripe sends this before it charges a trialing subscription. We
    // record it against the subscription rather than emailing from here: the customer already
    // knows the date (it is on the review screen, in the welcome mail and in their account), and
    // a second reminder belongs to the lifecycle loop in step 9, through notify.ts.
    if (event.type === 'customer.subscription.trial_will_end') {
      const s = obj as unknown as Stripe.Subscription;
      const { rows } = await db().query(`select id from subscriptions where stripe_subscription_id = $1`, [s.id]);
      if (rows[0]) {
        await appendEvent(db(), {
          subjectKind: 'subscription', subjectId: rows[0].id, type: 'booking.trial_will_end',
          actorKind: 'system', payload: { trial_end: s.trial_end, has_payment_method: Boolean(s.default_payment_method) },
        });
      }
    }

    // The trial converted: Stripe charged the first invoice and the subscription left 'trialing'.
    // invoice.paid writes the money rows; this is what moves OUR state off trialing, because a
    // row that says trialing forever would tell the customer's account screen the wrong story.
    if (event.type === 'customer.subscription.updated') {
      const s = obj as unknown as Stripe.Subscription;
      // Which card this plan bills, from the only authority on that question. `is_default` is
      // `not null default false`, so without this every card on file would read "not the
      // default" — true of nothing, and wrong the moment a customer has two.
      const dpm = typeof s.default_payment_method === 'string' ? s.default_payment_method : s.default_payment_method?.id;
      const scust = typeof s.customer === 'string' ? s.customer : s.customer?.id;
      if (dpm && scust) await markDefaultCard(scust, dpm).catch((e) => safeError('webhook:default-card', e));
      if (s.status === 'active') {
        const { rows } = await db().query(
          `update subscriptions set payment_state = 'ok', updated_at = now()
            where stripe_subscription_id = $1 and payment_state = 'trialing' returning id`, [s.id]);
        if (rows[0]) {
          await appendEvent(db(), {
            subjectKind: 'subscription', subjectId: rows[0].id, type: 'booking.trial_charged',
            from: 'trialing', to: 'ok', actorKind: 'system', payload: { stripe_subscription: s.id },
          });
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const s = obj as unknown as Stripe.Subscription;
      const { rows } = await db().query(
        `update subscriptions set state = 'cancelled', cancelled_at = now(), updated_at = now() where stripe_subscription_id = $1 and state <> 'cancelled' returning id`, [s.id]);
      if (rows[0]) {
        await db().query(`update visits set state = 'cancelled', updated_at = now() where subscription_id = $1 and state = 'scheduled' and scheduled_for > current_date`, [rows[0].id]);
        await appendEvent(db(), { subjectKind: 'subscription', subjectId: rows[0].id, type: 'subscription.cancelled', to: 'cancelled', actorKind: 'system' });
      }
    }
    await db().query(`update stripe_events set processed_at = now() where id = $1`, [event.id]);
  } catch (e) {
    safeError(`stripe-webhook:${event.type}`, e);
    await db().query(`update stripe_events set error = $2 where id = $1`, [event.id, String((e as Error).message).slice(0, 300)]);
    return sendJson(res, 500, { error: 'processing failed' });
  }
  return sendJson(res, 200, { received: true });
}
