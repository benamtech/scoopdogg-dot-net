/**
 * Booking: address -> package -> price -> start day -> contact -> pay the first month -> account.
 *
 * Ben, 2026-09-16: "the whole point is that they can book directly ... the goal of course is
 * to get them to pay the deposit for the month of service." P13 §3 is the journey; this file is
 * the part a browser cannot fake.
 *
 * THREE RULES
 *  1. The server re-prices everything from its own rows with the shared resolver. The browser
 *     sends choices, never amounts.
 *  2. A booking is written BEFORE money moves, as `deposit_pending`, so a payment that succeeds
 *     while the tab is closing still has a row to land on (the webhook and the return page both
 *     complete it, idempotently).
 *  3. Never a dead end. If payments are not connected in this mode yet, the booking is saved as
 *     a request, Josue is told, and the customer is told he will confirm.
 */
import type Stripe from 'stripe';
import { db } from './db.js';
import { sendEmail } from './notify.js';
import { appendEvent } from './events.js';
import { loadCatalog } from './catalog-db.js';
import { currentMode, resolve, priceForPackage, couponForOffer, connection, probeAccount, stripeFor, type StripeMode } from './stripe.js';
// The charge itself belongs to money.ts, which is the ONE file allowed to create one. This file
// decides WHAT is being sold; it does not decide what AMTECH takes. gates/one-money-door.mjs.
import { startSubscription } from './money.js';
import { openSessionForCustomer } from './customer-auth.js';
import { quoteBooking, startDates, formatCents, weekdayName } from '../../src/shared/pricing.js';
import type { ApiResponse } from './http.js';

export type BookingInput = {
  address: string;
  city: string;
  postal_code?: string;
  package_id: string;
  extra_tier_ids?: string[];
  with_package_ids?: string[];
  last_cleaned?: string | null;
  start_date: string;
  name: string;
  email: string;
  phone: string;
  gate_code?: string;
  access_notes?: string;
  dog_names?: string;
  source?: string;
  idempotency_key: string;
};

export class BookingError extends Error {
  constructor(public code: string, public userMessage: string, public status = 400) { super(code); }
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const normPhone = (p: string) => {
  const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p.trim();
};

export function parseInput(body: Record<string, unknown>): BookingInput {
  const input: BookingInput = {
    address: str(body.address, 300),
    city: str(body.city, 80),
    postal_code: str(body.postal_code, 12),
    package_id: str(body.package_id, 60),
    extra_tier_ids: Array.isArray(body.extra_tier_ids) ? body.extra_tier_ids.map((x) => str(x, 60)).filter(Boolean).slice(0, 5) : [],
    with_package_ids: Array.isArray(body.with_package_ids) ? body.with_package_ids.map((x) => str(x, 60)).filter(Boolean).slice(0, 3) : [],
    last_cleaned: str(body.last_cleaned, 30) || null,
    start_date: str(body.start_date, 10),
    name: str(body.name, 120),
    email: str(body.email, 200).toLowerCase(),
    phone: normPhone(str(body.phone, 40)),
    gate_code: str(body.gate_code, 60),
    access_notes: str(body.access_notes, 1000),
    dog_names: str(body.dog_names, 200),
    source: str(body.source, 120),
    idempotency_key: str(body.idempotency_key, 80),
  };
  if (!input.address || !input.city) throw new BookingError('address', 'Please enter your address.');
  if (!input.package_id) throw new BookingError('package', 'Please choose a plan.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) throw new BookingError('start_date', 'Please pick your start day.');
  if (!input.name || input.name.length < 2) throw new BookingError('name', 'Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new BookingError('email', 'Please enter a valid email address.');
  if (input.phone.replace(/\D/g, '').length < 10) throw new BookingError('phone', 'Please enter a 10-digit phone number.');
  if (!input.idempotency_key) throw new BookingError('idempotency', 'Please try again.');
  return input;
}

/** Everything the price step and the checkout both need, computed once, on the server. */
export async function priceBooking(input: Pick<BookingInput, 'city' | 'package_id' | 'extra_tier_ids' | 'with_package_ids' | 'start_date'>) {
  const catalog = await loadCatalog();
  const area = catalog.areas.find((a) => a.slug === input.city);
  if (!area || !area.bookable) throw new BookingError('area', 'We are not on a route there yet.', 422);
  const quote = quoteBooking(catalog, { packageId: input.package_id, extraTierIds: input.extra_tier_ids, withPackageIds: input.with_package_ids });
  if (!quote.ok) throw new BookingError(quote.reason, quote.reason === 'extra_requires_quote' ? 'That add-on needs a quick quote first.' : 'Please choose your plan again.');

  const serviceDays = (catalog.settings.get('schedule.service_days') as number[]) ?? [0, 1, 2, 3, 4, 5, 6];
  const leadDays = Number(catalog.settings.get('schedule.new_customer_start_days') ?? 3);
  const windowDays = Number(catalog.settings.get('booking.start_window_days') ?? 14);
  const capacity = Number(catalog.settings.get('schedule.day_capacity') ?? 20);
  const { rows: taken } = await db().query(
    `select scheduled_for::text as d, count(*)::int n from visits
      where scheduled_for between current_date and current_date + $1::int and state not in ('cancelled','skipped')
      group by 1`, [leadDays + windowDays]);
  const dates = startDates({
    today: todayLA(), areaWeekdays: area.service_weekdays ?? [], serviceDays, leadDays, windowDays, dayCapacity: capacity,
    taken: Object.fromEntries(taken.map((r: { d: string; n: number }) => [r.d, r.n])), max: 6,
  });
  return { catalog, area, quote, dates };
}

type Priced = Awaited<ReturnType<typeof priceBooking>>;

async function paymentsReady(mode: StripeMode): Promise<boolean> {
  const conn = await connection(mode);
  if (!conn?.account_id) return false;
  if (conn.card_payments_status === 'active') return true;
  const fresh = await probeAccount(mode).catch(() => null);
  return Boolean(fresh?.ready);
}

export async function createBooking(input: BookingInput, base: string) {
  const priced = await priceBooking(input);
  const { quote, area, dates } = priced;
  if (!quote.ok) throw new BookingError('price', 'Please choose your plan again.');
  const chosen = dates.find((d) => d.date === input.start_date);
  if (!chosen || chosen.full) throw new BookingError('start_date', 'That day just filled up. Please pick another.', 409);

  // Idempotent on the browser's key: a double-click or a retry returns the same booking.
  const { rows: prior } = await db().query(
    `select id, state, booking_answers->>'checkout_url' as url from subscriptions where booking_answers->>'idempotency_key' = $1 limit 1`,
    [input.idempotency_key]);
  if (prior[0]?.url && prior[0].state === 'deposit_pending') return { mode: 'checkout' as const, url: prior[0].url as string, booking_id: prior[0].id as string };

  const mode = await currentMode();
  const ready = await paymentsReady(mode);
  const client = await db().connect();
  let customerId: string, propertyId: string, subscriptionId: string;
  try {
    await client.query('begin');
    const { rows: existing } = await client.query(
      `select id, lower(email) as email from customers where phone = $1 and deleted_at is null limit 1`, [input.phone]);
    if (existing[0] && existing[0].email !== input.email) {
      throw new BookingError('phone_in_use', 'That phone number is already on a Scoop Dogg account. Sign in, or call us and we will sort it out.', 409);
    }
    if (existing[0]) {
      customerId = existing[0].id;
      await client.query(`update customers set name = $2, updated_at = now() where id = $1`, [customerId, input.name]);
    } else {
      const { rows } = await client.query(
        `insert into customers (name, phone, email, preferred_payment, notes) values ($1,$2,$3,'card',$4) returning id`,
        [input.name, input.phone, input.email, input.dog_names ? `Dogs: ${input.dog_names}` : '']);
      customerId = rows[0].id;
    }
    const dogsMatch = /^(\d+)/.exec(quote.package.short_label);
    const { rows: prop } = await client.query(
      `insert into properties (customer_id, address, city, postal_code, num_dogs, gate_code, access_notes)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [customerId, input.address, area.name, input.postal_code || null, dogsMatch ? Number(dogsMatch[1]) : null, input.gate_code || null, input.access_notes || '']);
    propertyId = prop[0].id;
    const extras = quote.lines.filter((l) => l.kind === 'extra').map((l) => ({ tier_id: l.ref, label: l.label, price_cents: l.cents }));
    const offer = quote.appliedOffers[0];
    const { rows: sub } = await client.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, price_cents, price_basis, price_quantity,
                                  price_tier_label, priced_at, frequency, service_weekday, starts_on, package_id, package_version,
                                  monthly_price_cents, livemode, area_slug, extras, discount, booking_answers, source, payment_state)
       values ($1,$2,$3,$4,$5,null,null,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,'online',$18)
       returning id`,
      [customerId, propertyId, quote.package.service_slug, ready ? 'deposit_pending' : 'draft',
       quote.package.monthly_price_cents, quote.package.short_label, quote.package.frequency, chosen.weekday, chosen.date,
       quote.package.id, quote.package.version, quote.package.monthly_price_cents, mode === 'live', area.slug,
       JSON.stringify(extras),
       offer ? JSON.stringify({ offer_id: offer.id, name: offer.name, percent_off: offer.percent_off, first_charge_cents: quote.firstChargeCents }) : null,
       JSON.stringify({ idempotency_key: input.idempotency_key, last_cleaned: input.last_cleaned, source: input.source, dog_names: input.dog_names }),
       ready ? 'pending' : 'none']);
    subscriptionId = sub[0].id;
    await appendEvent(client, {
      subjectKind: 'subscription', subjectId: subscriptionId, type: 'booking.created', to: ready ? 'deposit_pending' : 'draft',
      actorKind: 'customer', actorId: customerId,
      payload: { package: quote.package.slug, first_charge_cents: quote.firstChargeCents, starts_on: chosen.date, mode, payments_ready: ready },
    });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (!ready) {
    await notifyOwner('booking_owner', `Booking request: ${input.name} — ${quote.package.name}`, input, quote, chosen.label,
      'Online payments are not connected in this mode yet, so this booking was saved without payment. Confirm it with the customer.');
    return { mode: 'request' as const, booking_id: subscriptionId, start_label: chosen.label };
  }

  // ---- Stripe: a Customer, the package Price, the offer Coupon, and a Checkout Session ----
  const { stripe, account } = await resolve(mode);
  const stripeCustomerId = await stripeCustomer(stripe, account, mode, customerId, input);
  const { priceId, productId } = await priceForPackage(mode, { ...quote.package });
  const offer = quote.appliedOffers[0];
  const couponId = offer ? await couponForOffer(mode, { id: offer.id, name: offer.name, value: offer.percent_off }, [productId]) : null;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }];
  for (const l of quote.lines.filter((x) => x.kind === 'extra')) {
    lineItems.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: l.cents, product_data: { name: l.label } } });
  }
  const session = await startSubscription({
    mode,
    customerId: stripeCustomerId,
    lineItems,
    couponId,
    description: `${quote.package.name} · starts ${chosen.label}`,
    metadata: { booking_id: subscriptionId, customer_id: customerId, package_slug: quote.package.slug },
    submitMessage: `Starts ${chosen.label}. Your plan renews monthly — cancel anytime from your Scoop Dogg account.`,
    successUrl: `${base}/book/complete?session_id={CHECKOUT_SESSION_ID}&booking=${subscriptionId}`,
    cancelUrl: `${base}/book?resume=${subscriptionId}`,
    idempotencyKey: `checkout-${input.idempotency_key}`,
  });

  await db().query(
    `update subscriptions set stripe_customer_id = $2, account_id = $3,
            booking_answers = booking_answers || jsonb_build_object('checkout_session', $4::text, 'checkout_url', $5::text)
      where id = $1`, [subscriptionId, stripeCustomerId, account, session.id, session.url]);
  return { mode: 'checkout' as const, url: session.url as string, booking_id: subscriptionId };
}

async function stripeCustomer(stripe: Stripe, account: string, mode: StripeMode, customerId: string, input: BookingInput) {
  const { rows } = await db().query(
    `select stripe_customer_id from stripe_customers where customer_id = $1 and livemode = $2 and account_id = $3`,
    [customerId, mode === 'live', account]);
  if (rows[0]) return rows[0].stripe_customer_id as string;
  const c = await stripe.customers.create({
    name: input.name, email: input.email, phone: input.phone,
    address: { line1: input.address, postal_code: input.postal_code || undefined, state: 'CA', country: 'US' },
    metadata: { scoopdogg_customer_id: customerId },
  }, { stripeAccount: account, idempotencyKey: `customer-${account}-${customerId}` });
  await db().query(
    `insert into stripe_customers (customer_id, livemode, account_id, stripe_customer_id) values ($1,$2,$3,$4) on conflict do nothing`,
    [customerId, mode === 'live', account, c.id]);
  return c.id;
}

// ---------------------------------------------------------------------------------------
// Completion: the return page and the webhook both call this; the second call is a no-op.
// ---------------------------------------------------------------------------------------

export async function completeBooking(bookingId: string, sessionId: string | null, res: ApiResponse | null) {
  const { rows } = await db().query(
    `select s.*, c.name as customer_name, c.email as customer_email, p.address, p.city, pk.name as package_name
       from subscriptions s join customers c on c.id = s.customer_id join properties p on p.id = s.property_id
       left join packages pk on pk.id = s.package_id where s.id = $1`, [bookingId]);
  const sub = rows[0];
  if (!sub) throw new BookingError('not_found', 'We could not find that booking.', 404);

  if (sub.state !== 'active') {
    const mode: StripeMode = sub.livemode ? 'live' : 'test';
    const stripe = stripeFor(mode);
    const sid = sessionId ?? sub.booking_answers?.checkout_session;
    if (!sid) throw new BookingError('no_session', 'That booking has no payment yet.', 409);
    const session = await stripe.checkout.sessions.retrieve(sid, { expand: ['subscription', 'invoice'] }, { stripeAccount: sub.account_id });
    if (session.metadata?.booking_id !== bookingId) throw new BookingError('mismatch', 'That payment does not match this booking.', 409);
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) {
      throw new BookingError('unpaid', 'Your payment has not gone through yet.', 402);
    }
    const stripeSub = session.subscription as Stripe.Subscription;
    const invoiceId = typeof stripeSub.latest_invoice === 'string' ? stripeSub.latest_invoice : stripeSub.latest_invoice?.id;
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId, {}, { stripeAccount: sub.account_id }) : null;
    const periodEnd = stripeSub.items?.data?.[0]?.current_period_end ?? null;

    const client = await db().connect();
    try {
      await client.query('begin');
      const { rowCount } = await client.query(
        `update subscriptions set state = 'active', payment_state = 'ok', stripe_subscription_id = $2,
                current_period_end = to_timestamp($3), updated_at = now()
          where id = $1 and state <> 'active'`, [bookingId, stripeSub.id, periodEnd]);
      if (rowCount) {
        const fee = Math.round((invoice?.amount_paid ?? session.amount_total ?? 0) * (Number(stripeSub.application_fee_percent ?? 0) / 100));
        const { rows: inv } = await client.query(
          `insert into invoices (customer_id, subscription_id, period_start, period_end, subtotal_cents, platform_fee_cents, total_cents,
                                 state, issued_at, paid_at, stripe_invoice_id, collection_method, livemode, account_id, hosted_invoice_url)
           values ($1,$2,$3::date,to_timestamp($4)::date,$5,$6,$7,'paid',now(),now(),$8,'auto',$9,$10,$11)
           on conflict (stripe_invoice_id) where stripe_invoice_id is not null do update set state = 'paid' returning id`,
          [sub.customer_id, bookingId, sub.starts_on, periodEnd, invoice?.subtotal ?? session.amount_subtotal ?? 0, fee,
           invoice?.amount_paid ?? session.amount_total ?? 0, invoice?.id ?? null, sub.livemode, sub.account_id, invoice?.hosted_invoice_url ?? null]);
        await client.query(
          `insert into payments (customer_id, invoice_id, kind, amount_cents, currency, stripe_payment_id, stripe_account_id, platform_fee_cents, state, livemode)
           values ($1,$2,'charge',$3,'usd',$4,$5,$6,'succeeded',$7) on conflict do nothing`,
          [sub.customer_id, inv[0].id, invoice?.amount_paid ?? session.amount_total ?? 0, invoice?.id ?? session.id, sub.account_id, fee, sub.livemode]);
        await generateVisits(client, bookingId, sub.property_id, sub.starts_on, periodEnd);
        await appendEvent(client, {
          subjectKind: 'subscription', subjectId: bookingId, type: 'subscription.activated', from: sub.state, to: 'active',
          actorKind: 'system', payload: { stripe_subscription: stripeSub.id, invoice: invoice?.id ?? null, amount_paid: invoice?.amount_paid ?? session.amount_total },
        });
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    if (res) await sendWelcome(bookingId);
  }

  if (res) await openSessionForCustomer(res, sub.customer_id);
  const { rows: next } = await db().query(
    `select scheduled_for::text as d from visits where subscription_id = $1 and state = 'scheduled' and scheduled_for >= current_date order by scheduled_for limit 1`, [bookingId]);
  return {
    booking_id: bookingId,
    name: sub.customer_name,
    package: sub.package_name,
    next_visit: next[0]?.d ?? sub.starts_on,
    weekday: weekdayName(sub.service_weekday),
  };
}

/** Weekly visits from the start day through the paid period (at least five). Idempotent. */
async function generateVisits(client: { query: (q: string, p: unknown[]) => Promise<unknown> }, subscriptionId: string, propertyId: string, startsOn: string | Date, periodEnd: number | null) {
  const start = new Date(typeof startsOn === 'string' ? `${startsOn}T12:00:00Z` : startsOn);
  const end = periodEnd ? new Date(periodEnd * 1000) : new Date(start.getTime() + 35 * 86_400_000);
  for (let i = 0, d = new Date(start); i < 10; i++, d = new Date(d.getTime() + 7 * 86_400_000)) {
    if (i >= 5 && d > end) break;
    await client.query(
      `insert into visits (subscription_id, property_id, scheduled_for, state, chargeable) values ($1,$2,$3,'scheduled',false)
       on conflict do nothing`, [subscriptionId, propertyId, d.toISOString().slice(0, 10)]);
  }
}

// ---------------------------------------------------------------------------------------
// Mail, through the one send function (demo mode rewrites recipients before the network).
// ---------------------------------------------------------------------------------------

const shell = (title: string, body: string) => `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
  <div style="padding:20px 0;border-bottom:1px solid #E6E1D8"><img src="${process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.vercel.app'}/brand/mark-96.png" width="40" height="40" alt="" style="vertical-align:middle;border-radius:50%"> <span style="font-family:Georgia,serif;font-size:22px;color:#143728;vertical-align:middle;margin-left:8px">Scoop Dogg</span></div>
  <h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;color:#0F2A1F;margin:28px 0 12px">${title}</h1>${body}
  <p style="color:#5B6660;font-size:13px;margin-top:32px;border-top:1px solid #E6E1D8;padding-top:16px">Scoop Dogg · (805) 869-8070 · <a href="${process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.vercel.app'}/account" style="color:#24593F">Your account</a></p></div>`;

async function sendWelcome(bookingId: string) {
  const { rows } = await db().query(
    `select s.starts_on::text as starts_on, s.service_weekday, s.monthly_price_cents, s.discount, s.extras, c.name, c.email, c.phone,
            p.address, p.city, pk.name as package_name
       from subscriptions s join customers c on c.id = s.customer_id join properties p on p.id = s.property_id
       left join packages pk on pk.id = s.package_id where s.id = $1`, [bookingId]);
  const b = rows[0];
  if (!b) return;
  const first = b.discount?.first_charge_cents ?? b.monthly_price_cents;
  const startLabel = new Date(`${b.starts_on}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  await sendEmail({
    purpose: 'booking_welcome',
    recipients: { explicit: [b.email] },
    fromName: 'Scoop Dogg',
    subject: `You're booked — first visit ${startLabel}`,
    html: shell(`You're booked, ${String(b.name).split(' ')[0]}.`, `
      <p style="font-size:16px;line-height:1.6">Thanks for choosing Scoop Dogg. Your first visit is <strong>${startLabel}</strong>, and after that we'll be there every <strong>${weekdayName(b.service_weekday)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;background:#F3F7F4;border-radius:12px;margin:20px 0">
        <tr><td style="padding:10px 16px;color:#5B6660">Plan</td><td style="padding:10px 16px;font-weight:600">${b.package_name ?? ''}</td></tr>
        <tr><td style="padding:10px 16px;color:#5B6660">Address</td><td style="padding:10px 16px">${b.address}, ${b.city}</td></tr>
        <tr><td style="padding:10px 16px;color:#5B6660">Paid today</td><td style="padding:10px 16px">${formatCents(first, { forceDecimals: first % 100 !== 0 })}</td></tr>
        <tr><td style="padding:10px 16px;color:#5B6660">Then monthly</td><td style="padding:10px 16px">${formatCents(b.monthly_price_cents)}</td></tr>
      </table>
      <p style="font-size:16px;line-height:1.6">You can skip a week, pause or cancel anytime from your account.</p>
      <p><a href="${process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.vercel.app'}/account" style="display:inline-block;background:#F4A024;color:#0F2A1F;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">Go to your account</a></p>`),
  });
  await notifyOwner('booking_owner', `New customer: ${b.name} — ${b.package_name}`,
    { name: b.name, email: b.email, phone: b.phone, address: b.address, city: b.city } as BookingInput, null, startLabel, 'Paid online. First month collected.');
}

async function notifyOwner(purpose: 'booking_owner' | 'waitlist_owner', subject: string, input: Partial<BookingInput>, quote: Priced['quote'] | null, startLabel: string | null, note: string) {
  const row = (k: string, v: unknown) => (v ? `<tr><td style="padding:6px 12px;color:#5B6660">${k}</td><td style="padding:6px 12px;font-weight:600">${String(v).replace(/</g, '&lt;')}</td></tr>` : '');
  await sendEmail({
    purpose,
    recipients: { settingKey: 'notify.lead_recipients' },
    ccSettingKey: 'notify.lead_cc',
    fromName: 'Scoop Dogg Bookings',
    replyTo: input.email,
    subject,
    html: shell(subject, `<p style="font-size:15px">${note}</p><table style="width:100%;border-collapse:collapse;background:#FAF8F5">
      ${row('Name', input.name)}${row('Phone', input.phone)}${row('Email', input.email)}${row('Address', [input.address, input.city].filter(Boolean).join(', '))}
      ${quote && quote.ok ? row('Plan', quote.package.name) + row('First charge', formatCents(quote.firstChargeCents)) : ''}${row('Starts', startLabel)}
      ${row('Gate code', input.gate_code)}${row('Notes', input.access_notes)}${row('Last cleaned', input.last_cleaned)}</table>`),
  }).catch(() => undefined);
}

export async function joinWaitlist(body: Record<string, unknown>) {
  const name = str(body.name, 120) || 'Waitlist';
  const email = str(body.email, 200).toLowerCase();
  const phone = normPhone(str(body.phone, 40));
  const address = str(body.address, 300);
  const city = str(body.city, 80) || 'Outside current routes';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BookingError('email', 'Please enter a valid email address.');
  const { rows } = await db().query(
    `insert into leads (id, name, phone, email, address, city, service_slug, notes, source_page, status, created_at)
     values (gen_random_uuid(),$1,$2,$3,$4,$5,'weekly-pooper-scooper-service','WAITLIST: outside current service days or cities','/book','new',now()) returning id`,
    [name, phone || 'not given', email, address, city]);
  await appendEvent(db(), { subjectKind: 'waitlist', subjectId: rows[0].id, type: 'waitlist.joined', actorKind: 'customer', payload: { city } });
  await notifyOwner('waitlist_owner', `Waitlist: ${city}`, { name, email, phone, address, city }, null, null,
    'Someone outside the current routes wants service. This is where to open next.');
  return { ok: true };
}
