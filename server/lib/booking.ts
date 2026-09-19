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
import { startSubscription, chargeOnce, feeCentsFor } from './money.js';
import { resolveZip, sessionConverted } from './funnel.js';
// The words, from the same module the browser renders them with. server/lib/consent.ts writes
// the row; src/shared/consent.ts is the single author of the sentence. R9, and step 6.
import { renewalTerms, acknowledgmentHtml } from '../../src/shared/consent.js';
import { recordConsent } from './consent.js';
import { openSessionForCustomer } from './customer-auth.js';
import { quoteBooking, quoteOneTime, startDates, formatCents, weekdayName, catchUpFor } from '../../src/shared/pricing.js';
import type { ApiResponse } from './http.js';

export type BookingInput = {
  address: string;
  city: string;
  postal_code?: string;
  /** A recurring plan. Empty when this is a one-time job. */
  package_id: string;
  /** A one-time job: the priced tier the customer chose (P16 §3). */
  tier_id?: string;
  /** P16 §5. 'prepay' charges the first month now; 'payafter' saves the card and charges the
   *  day after visit one. Anything else is refused rather than guessed. */
  lane?: 'prepay' | 'payafter';
  /** The browser's funnel session, so the booking can be tied to the steps that led to it. */
  session_id?: string;
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
  /**
   * The renewal sentence the customer actually read, sent back as a witness. The server
   * re-renders it from its own rows and refuses the booking if the two differ - so this is
   * never trusted as input, only compared. §17602(a)(4). Null on a one-time job, which has no
   * renewal to consent to.
   */
  consent_text?: string | null;
  /** Trimmed request metadata that makes the consent record verifiable. Set by the API layer. */
  consent_ip?: string | null;
  consent_user_agent?: string | null;
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
    tier_id: str(body.tier_id, 60),
    lane: body.lane === 'payafter' ? 'payafter' : 'prepay',
    session_id: str(body.session_id, 60),
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
    consent_text: body.consent_text == null ? null : str(body.consent_text, 1000),
  };
  if (!input.address || !input.city) throw new BookingError('address', 'Please enter your address.');
  if (!input.package_id && !input.tier_id) throw new BookingError('package', 'Please choose a plan.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) throw new BookingError('start_date', 'Please pick your start day.');
  if (!input.name || input.name.length < 2) throw new BookingError('name', 'Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new BookingError('email', 'Please enter a valid email address.');
  if (input.phone.replace(/\D/g, '').length < 10) throw new BookingError('phone', 'Please enter a 10-digit phone number.');
  if (!input.idempotency_key) throw new BookingError('idempotency', 'Please try again.');
  return input;
}

/**
 * Everything the price step and the checkout both need, computed once, on the server.
 *
 * THE ZIP IS THE FIRST QUESTION NOW (P16 §2), so the area may arrive either as a city slug or as
 * five digits. A ZIP that resolves to a city we serve is the same answer as picking that city
 * from a list; a ZIP that is known and not served is a different sentence from one we have never
 * heard of, and both of those are refusals rather than a shrug.
 */
export async function priceBooking(input: Pick<BookingInput, 'city' | 'package_id' | 'extra_tier_ids' | 'with_package_ids' | 'start_date'> & { postal_code?: string; tier_id?: string }) {
  const catalog = await loadCatalog();
  let slug = input.city;
  if (!slug && input.postal_code) {
    const z = await resolveZip(input.postal_code);
    if (!z.known) throw new BookingError('zip_unknown', `We don't recognise ${input.postal_code}. Check it, or leave your address and we'll come back to you.`, 422);
    if (!z.served) throw new BookingError('zip_unserved', `We're not on a route in ${input.postal_code} yet. Leave your address and we'll tell you the week we are.`, 422);
    slug = z.area_slug;
  }
  const area = catalog.areas.find((a) => a.slug === slug);
  if (!area || !area.bookable) throw new BookingError('area', 'We are not on a route there yet.', 422);

  // A one-time job is priced from its own tier and has no package, no offer and no monthly
  // anything. It still gets start dates, because it still has to be driven to.
  if (input.tier_id && !input.package_id) {
    const one = quoteOneTime(catalog, input.tier_id);
    if (!one.ok) {
      throw new BookingError(one.reason, one.reason === 'requires_quote' || one.reason === 'from_price'
        ? 'That one needs a quick look first — we will confirm the price with you.'
        : 'Please choose what you need again.');
    }
    return { catalog, area, quote: null, oneTime: one, dates: await startDatesFor(catalog, area) };
  }

  const quote = quoteBooking(catalog, { packageId: input.package_id, extraTierIds: input.extra_tier_ids, withPackageIds: input.with_package_ids });
  if (!quote.ok) throw new BookingError(quote.reason, quote.reason === 'extra_requires_quote' ? 'That add-on needs a quick quote first.' : 'Please choose your plan again.');

  return { catalog, area, quote, oneTime: null, dates: await startDatesFor(catalog, area) };
}

type LoadedCatalog = Awaited<ReturnType<typeof loadCatalog>>;

/** The days a customer may pick, from the area's route days, the capacity and what is booked. */
async function startDatesFor(catalog: LoadedCatalog, area: LoadedCatalog['areas'][number]) {
  const serviceDays = (catalog.settings.get('schedule.service_days') as number[]) ?? [0, 1, 2, 3, 4, 5, 6];
  const leadDays = Number(catalog.settings.get('schedule.new_customer_start_days') ?? 3);
  const windowDays = Number(catalog.settings.get('booking.start_window_days') ?? 14);
  const capacity = Number(catalog.settings.get('schedule.day_capacity') ?? 20);
  const { rows: taken } = await db().query(
    `select scheduled_for::text as d, count(*)::int n from visits
      where scheduled_for between current_date and current_date + $1::int and state not in ('cancelled','skipped')
      group by 1`, [leadDays + windowDays]);
  return startDates({
    today: todayLA(), areaWeekdays: area.service_weekdays ?? [], serviceDays, leadDays, windowDays, dayCapacity: capacity,
    taken: Object.fromEntries(taken.map((r: { d: string; n: number }) => [r.d, r.n])), max: 6,
  });
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
  const { area, dates, oneTime } = priced;
  const quote = priced.quote;
  const chosen = dates.find((d) => d.date === input.start_date);
  if (!chosen || chosen.full) throw new BookingError('start_date', 'That day just filled up. Please pick another.', 409);
  if (!quote && !oneTime) throw new BookingError('price', 'Please choose your plan again.');

  // Idempotent on the browser's key: a double-click or a retry returns the same booking.
  const { rows: prior } = await db().query(
    `select id, state, booking_answers->>'checkout_url' as url from subscriptions where booking_answers->>'idempotency_key' = $1 limit 1`,
    [input.idempotency_key]);
  if (prior[0]?.url && prior[0].state === 'deposit_pending') return { mode: 'checkout' as const, url: prior[0].url as string, booking_id: prior[0].id as string };

  /**
   * THE CATCH-UP CHARGE, ENFORCED HERE AND NOT ONLY ON THE SCREEN.
   *
   * Josue, 2026-09-19: "when yard has not been cleaned longer than a couple weeks it would
   * increase price because the default price is based on having a weekly clean."
   *
   * The browser derives the same thing from the same rows and preselects the tier, but a
   * pricing rule that only the browser applies is a pricing rule anybody can skip by posting
   * the form without it. So the server recomputes it from `last_cleaned` and refuses a booking
   * whose extras do not carry the tier the answer requires.
   *
   * THE QUOTE BAND DOES NOT TAKE A CARD. Josue's own ladder says a yard six weeks or more
   * behind needs his eyes, so there is no number to charge and the booking goes down the
   * request path — the same path a booking takes when payments are not connected, for the same
   * reason: we will not invent a price, and we will not dead-end the customer either.
   */
  const catalogNow = await loadCatalog();
  const cleanupPolicy = String(catalogNow.settings.get('booking.initial_cleanup_policy') ?? 'offer_optional');
  const catchUp = quote && quote.ok
    ? catchUpFor(catalogNow, quote.package.service_slug, input.last_cleaned)
    : { kind: 'none' as const };
  const catchUpRequired = cleanupPolicy === 'required_beyond_two_weeks';

  if (catchUpRequired && catchUp.kind === 'charge'
      && !(input.extra_tier_ids ?? []).includes(catchUp.tier.id)) {
    throw new BookingError('catch_up_missing',
      'Your first visit needs a catch-up clean because the yard is more than a couple of weeks behind. Please go back a step so we can show you the price.', 409);
  }
  const needsFirstVisitQuote = catchUpRequired && catchUp.kind === 'quote';

  const mode = await currentMode();
  // A first visit Josue has to price himself is not a checkout, whatever Stripe's state is.
  const ready = (await paymentsReady(mode)) && !needsFirstVisitQuote;

  // LANE B ONLY EXISTS WHEN THE SETTINGS SAY SO, and only for a recurring plan: a one-time job
  // has no second month to trial into. `booking.lanes_enabled` is a row (migration 018).
  const lanesEnabled = String((await loadCatalog()).settings.get('booking.lanes_enabled') ?? 'prepay');
  const payAfter = Boolean(quote) && input.lane === 'payafter' && lanesEnabled.includes('payafter');
  const offsetDays = Number((await loadCatalog()).settings.get('booking.payafter_charge_offset_days') ?? 1);
  // The DATE, never "later". Days from today to the day after the first visit, which is the
  // number Stripe wants and the date the customer is shown - computed once, from one place.
  const trialDays = payAfter
    ? Math.max(1, Math.round((Date.parse(`${chosen.date}T12:00:00Z`) - Date.parse(`${todayLA()}T12:00:00Z`)) / 86_400_000) + offsetDays)
    : 0;
  const firstChargeOn = payAfter
    ? new Date(Date.parse(`${todayLA()}T12:00:00Z`) + trialDays * 86_400_000).toISOString().slice(0, 10)
    : null;

  /**
   * THE RENEWAL TERMS, RE-RENDERED HERE FROM OUR OWN ROWS. §17602(a)(4), R9 §2.
   *
   * The browser sent the sentence it showed. This does not trust it — it rebuilds the sentence
   * from the catalog the server just read and compares. Two things fall out of that:
   *
   *  1. A browser cannot negotiate its own terms. Sending nicer words gets the booking refused,
   *     not accepted, so `consents.text_shown` can never be a sentence nobody was shown.
   *  2. If the published price moved between the page load and the click, the sentences differ
   *     and the booking STOPS. That is the right failure: the alternative is charging a number
   *     the customer never saw, which is exactly what §17602(a)(7) calls a misrepresentation.
   *
   * A one-time job gets `null` here and no consent row. It neither renews nor continues, so the
   * article does not reach it, and a renewal sentence over it would be a false statement.
   */
  const settings = catalogNow.settings;
  const terms = quote && quote.ok
    ? renewalTerms({
        lane: payAfter ? 'payafter' : 'prepay',
        monthlyCents: quote.monthlyCents,
        firstChargeCents: quote.firstChargeCents,
        firstChargeOn,
        packageName: quote.package.name,
        priceMayChange: quote.flags.containsFromPrice,
        cancelEmail: String(settings.get('business.email') ?? ''),
        businessName: String(settings.get('business.name') ?? 'Scoop Dogg'),
      })
    : null;

  if (terms) {
    if (!input.consent_text) {
      throw new BookingError('consent', 'Please tick the box agreeing to the renewal terms.');
    }
    if (input.consent_text.trim() !== terms.sentence) {
      throw new BookingError('consent_stale',
        'Your plan or its price changed while you were booking. Please refresh the page and check the terms again.', 409);
    }
  }

  const client = await db().connect();
  let customerId: string, propertyId: string, subscriptionId: string;
  let consentId: string | null = null;
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
    // num_dogs is NULL when nobody asked - a turf or deep-clean customer has no dog count, and
    // writing 1 to satisfy a constraint would be inventing a fact (migration 019).
    const dogsMatch = quote ? /^(\d+)/.exec(quote.package.short_label) : null;
    const { rows: prop } = await client.query(
      `insert into properties (customer_id, address, city, postal_code, num_dogs, gate_code, access_notes)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [customerId, input.address, area.name, input.postal_code || null, dogsMatch ? Number(dogsMatch[1]) : null, input.gate_code || null, input.access_notes || '']);
    propertyId = prop[0].id;

    const extras = quote ? quote.lines.filter((l) => l.kind === 'extra').map((l) => ({ tier_id: l.ref, label: l.label, price_cents: l.cents })) : [];
    const offer = quote ? quote.appliedOffers[0] : undefined;
    const priceCents = quote ? quote.package.monthly_price_cents : oneTime!.cents;
    const state = ready ? 'deposit_pending' : 'draft';
    // trialing is a real payment_state now (migration 022) and it is what lane B is.
    const paymentState = !ready ? 'none' : payAfter ? 'trialing' : 'pending';

    const { rows: sub } = await client.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, price_cents, price_basis, price_quantity,
                                  price_tier_label, priced_at, frequency, service_weekday, starts_on, package_id, package_version,
                                  monthly_price_cents, livemode, area_slug, extras, discount, booking_answers, source, payment_state)
       values ($1,$2,$3,$4,$5,null,null,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,'online',$18)
       returning id`,
      [customerId, propertyId, quote ? quote.package.service_slug : oneTime!.service.slug, state,
       priceCents, quote ? quote.package.short_label : oneTime!.tier.label,
       quote ? quote.package.frequency : 'one_time', chosen.weekday, chosen.date,
       quote ? quote.package.id : null, quote ? quote.package.version : null,
       quote ? quote.package.monthly_price_cents : null, mode === 'live', area.slug,
       JSON.stringify(extras),
       offer ? JSON.stringify({ offer_id: offer.id, name: offer.name, percent_off: offer.percent_off, first_charge_cents: quote!.firstChargeCents }) : null,
       JSON.stringify({ idempotency_key: input.idempotency_key, last_cleaned: input.last_cleaned, source: input.source,
                        dog_names: input.dog_names, session_id: input.session_id || null, lane: oneTime ? 'onetime' : payAfter ? 'payafter' : 'prepay',
                        first_charge_on: firstChargeOn, tier_id: oneTime ? oneTime.tier.id : null }),
       paymentState]);
    subscriptionId = sub[0].id;

    // §17602(a)(6). The consent row goes in THIS transaction — not before it (a consent for a
    // booking that then rolled back is a record of nothing) and not after it (a committed
    // subscription with no evidence behind it is the one state this table exists to prevent).
    if (terms) {
      consentId = await recordConsent(client, {
        customerId, subscriptionId, kind: 'renewal',
        textShown: terms.sentence,
        priceCents: quote!.monthlyCents,
        lane: payAfter ? 'payafter' : 'prepay',
        ip: input.consent_ip ?? null,
        userAgent: input.consent_user_agent ?? null,
      });
    }

    await appendEvent(client, {
      subjectKind: 'subscription', subjectId: subscriptionId, type: 'booking.created', to: state,
      actorKind: 'customer', actorId: customerId,
      payload: {
        package: quote ? quote.package.slug : oneTime!.tier.id,
        service: quote ? quote.package.service_slug : oneTime!.service.slug,
        shape: quote ? 'recurring' : 'one_time',
        lane: oneTime ? 'onetime' : payAfter ? 'payafter' : 'prepay',
        first_charge_cents: quote ? quote.firstChargeCents : oneTime!.cents,
        first_charge_on: firstChargeOn, starts_on: chosen.date, mode, payments_ready: ready,
        session_id: input.session_id || null,
      },
    });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (input.session_id) await sessionConverted(input.session_id, subscriptionId).catch(() => {});

  if (!ready) {
    await notifyOwner('booking_owner', `Booking request: ${input.name} — ${quote ? quote.package.name : oneTime!.label}`, input, quote, chosen.label,
      needsFirstVisitQuote
        ? `The yard has not been cleaned in ${input.last_cleaned === 'longer' ? 'more than six weeks' : 'a while'}, so your own catalog says the first visit needs a quote. No card was taken. Price the first visit and confirm it with the customer; the weekly plan is unaffected.`
        : 'Online payments are not connected in this mode yet, so this booking was saved without payment. Confirm it with the customer.');
    return { mode: 'request' as const, booking_id: subscriptionId, start_label: chosen.label };
  }

  // ---- Stripe: a Customer, then whichever of the three shapes this is --------------------
  const { stripe, account } = await resolve(mode);
  const stripeCustomerId = await stripeCustomer(stripe, account, mode, customerId, input);

  let session;
  if (oneTime) {
    // A one-time job pays with `application_fee_amount`, because application_fee_percent reaches
    // subscription invoices and nothing else (P17 §1). money.ts is still the only door.
    session = await chargeOnce({
      mode,
      customerId: stripeCustomerId,
      amountCents: oneTime.cents,
      lineItems: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: oneTime.cents, product_data: { name: oneTime.label } } }],
      metadata: { booking_id: subscriptionId, customer_id: customerId, tier_id: oneTime.tier.id, shape: 'one_time' },
      submitMessage: `We'll be there ${chosen.label}.`,
      successUrl: `${base}/book/complete?session_id={CHECKOUT_SESSION_ID}&booking=${subscriptionId}`,
      cancelUrl: `${base}/book?resume=${subscriptionId}`,
      idempotencyKey: `onetime-${input.idempotency_key}`,
    });
  } else {
    const { priceId, productId } = await priceForPackage(mode, { ...quote!.package });
    const offer = quote!.appliedOffers[0];
    const couponId = offer ? await couponForOffer(mode, { id: offer.id, name: offer.name, value: offer.percent_off }, [productId]) : null;
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }];
    for (const l of quote!.lines.filter((x) => x.kind === 'extra')) {
      lineItems.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: l.cents, product_data: { name: l.label } } });
    }
    session = await startSubscription({
      mode,
      // The consent is a parameter of opening a subscription, not a check somebody remembers to
      // run. money.ts throws without it, so the only way to charge a renewal is to have written
      // down what the customer agreed to first. §17602(a)(2).
      consentId: consentId!,
      customerId: stripeCustomerId,
      lineItems,
      couponId,
      description: `${quote!.package.name} · starts ${chosen.label}`,
      metadata: { booking_id: subscriptionId, customer_id: customerId, package_slug: quote!.package.slug, lane: payAfter ? 'payafter' : 'prepay' },
      submitMessage: payAfter
        ? `Nothing is charged today. Your first payment is ${niceDate(firstChargeOn!)}, after your first visit on ${chosen.label}. Cancel anytime from your account.`
        : `Starts ${chosen.label}. Your plan renews monthly — cancel anytime from your Scoop Dogg account.`,
      successUrl: `${base}/book/complete?session_id={CHECKOUT_SESSION_ID}&booking=${subscriptionId}`,
      cancelUrl: `${base}/book?resume=${subscriptionId}`,
      idempotencyKey: `checkout-${input.idempotency_key}`,
      trialPeriodDays: payAfter ? trialDays : null,
    });
  }

  await db().query(
    `update subscriptions set stripe_customer_id = $2, account_id = $3,
            booking_answers = booking_answers || jsonb_build_object('checkout_session', $4::text, 'checkout_url', $5::text)
      where id = $1`, [subscriptionId, stripeCustomerId, account, session.id, session.url]);
  return { mode: 'checkout' as const, url: session.url as string, booking_id: subscriptionId };
}

const niceDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

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
    const oneTime = sub.frequency === 'one_time';
    const session = await stripe.checkout.sessions.retrieve(
      sid, { expand: oneTime ? ['payment_intent'] : ['subscription', 'invoice'] }, { stripeAccount: sub.account_id });
    if (session.metadata?.booking_id !== bookingId) throw new BookingError('mismatch', 'That payment does not match this booking.', 409);
    // `no_payment_required` is lane B: the card was collected and nothing was charged, which is
    // the whole promise. Treating it as unpaid would refuse the customer their own booking.
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) {
      throw new BookingError('unpaid', 'Your payment has not gone through yet.', 402);
    }

    const stripeSub = oneTime ? null : (session.subscription as Stripe.Subscription);
    const trialing = Boolean(stripeSub && stripeSub.status === 'trialing');
    const invoiceId = stripeSub
      ? (typeof stripeSub.latest_invoice === 'string' ? stripeSub.latest_invoice : stripeSub.latest_invoice?.id)
      : null;
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId, {}, { stripeAccount: sub.account_id }) : null;
    const periodEnd = stripeSub?.items?.data?.[0]?.current_period_end ?? null;
    const intent = oneTime ? (session.payment_intent as Stripe.PaymentIntent | null) : null;

    const client = await db().connect();
    try {
      await client.query('begin');
      const { rowCount } = await client.query(
        // `activated_at` is set once and never moved (migration 024): §17602(h) measures the
        // annual reminder from the moment the plan started, and a column that a reactivation
        // could push forward would quietly cancel a reminder that was already due.
        `update subscriptions set state = 'active', payment_state = $4, stripe_subscription_id = $2,
                current_period_end = to_timestamp($3), activated_at = coalesce(activated_at, now()),
                updated_at = now()
          where id = $1 and state <> 'active'`,
        [bookingId, stripeSub?.id ?? null, periodEnd, trialing ? 'trialing' : 'ok']);
      if (rowCount) {
        // MONEY ROWS ONLY WHERE MONEY MOVED. A trial collects a card and charges nothing, so
        // writing a zero invoice and a zero payment would put a payment in the books that never
        // happened - and the growth board reads those rows.
        const paidCents = oneTime ? (intent?.amount_received ?? session.amount_total ?? 0)
                                  : (invoice?.amount_paid ?? session.amount_total ?? 0);
        const moved = !trialing && paidCents > 0;
        if (moved) {
          const fee = oneTime
            ? (intent?.application_fee_amount ?? await feeCentsFor(paidCents, mode))
            : Math.round(paidCents * (Number(stripeSub?.application_fee_percent ?? 0) / 100));
          const { rows: inv } = await client.query(
            `insert into invoices (customer_id, subscription_id, period_start, period_end, subtotal_cents, platform_fee_cents, total_cents,
                                   state, issued_at, paid_at, stripe_invoice_id, collection_method, livemode, account_id, hosted_invoice_url)
             values ($1,$2,$3::date,$4,$5,$6,$7,'paid',now(),now(),$8,'auto',$9,$10,$11)
             on conflict (stripe_invoice_id) where stripe_invoice_id is not null do update set state = 'paid' returning id`,
            [sub.customer_id, bookingId, sub.starts_on, periodEnd ? new Date(periodEnd * 1000).toISOString().slice(0, 10) : sub.starts_on,
             invoice?.subtotal ?? session.amount_subtotal ?? paidCents, fee, paidCents,
             invoice?.id ?? null, sub.livemode, sub.account_id, invoice?.hosted_invoice_url ?? null]);
          await client.query(
            `insert into payments (customer_id, invoice_id, kind, amount_cents, currency, stripe_payment_id, stripe_account_id, platform_fee_cents, state, livemode)
             values ($1,$2,'charge',$3,'usd',$4,$5,$6,'succeeded',$7) on conflict do nothing`,
            [sub.customer_id, inv[0].id, paidCents, invoice?.id ?? intent?.id ?? session.id, sub.account_id, fee, sub.livemode]);
        }
        await generateVisits(client, bookingId, sub.property_id, sub.starts_on, periodEnd, oneTime);
        await appendEvent(client, {
          subjectKind: 'subscription', subjectId: bookingId,
          type: oneTime ? 'onetime.charged' : trialing ? 'booking.trial_started' : 'subscription.activated',
          from: sub.state, to: 'active', actorKind: 'system',
          payload: {
            stripe_subscription: stripeSub?.id ?? null, invoice: invoice?.id ?? null,
            payment_intent: intent?.id ?? null, amount_paid: paidCents,
            trialing, first_charge_on: sub.booking_answers?.first_charge_on ?? null,
          },
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
    package: sub.package_name ?? sub.price_tier_label,
    next_visit: next[0]?.d ?? sub.starts_on,
    weekday: weekdayName(sub.service_weekday),
    one_time: sub.frequency === 'one_time',
    first_charge_on: sub.booking_answers?.first_charge_on ?? null,
  };
}

/**
 * Weekly visits from the start day through the paid period (at least five). Idempotent.
 *
 * A ONE-TIME JOB IS ONE VISIT. It is a `subscriptions` row with frequency 'one_time' (P16 §3), so
 * scheduling, the crew's day and the proof photo all work on the row they already work on - but
 * generating ten weekly visits for a deep clean would put a crew on a route nobody booked.
 */
async function generateVisits(client: { query: (q: string, p: unknown[]) => Promise<unknown> }, subscriptionId: string, propertyId: string, startsOn: string | Date, periodEnd: number | null, oneTime = false) {
  const start = new Date(typeof startsOn === 'string' ? `${startsOn}T12:00:00Z` : startsOn);
  const end = periodEnd ? new Date(periodEnd * 1000) : new Date(start.getTime() + 35 * 86_400_000);
  const count = oneTime ? 1 : 10;
  for (let i = 0, d = new Date(start); i < count; i++, d = new Date(d.getTime() + 7 * 86_400_000)) {
    if (!oneTime && i >= 5 && d > end) break;
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
    `select s.starts_on::text as starts_on, s.service_weekday, s.monthly_price_cents, s.price_cents, s.frequency,
            s.discount, s.extras, s.payment_state, s.booking_answers, c.name, c.email, c.phone,
            p.address, p.city, pk.name as package_name
       from subscriptions s join customers c on c.id = s.customer_id join properties p on p.id = s.property_id
       left join packages pk on pk.id = s.package_id where s.id = $1`, [bookingId]);
  const b = rows[0];
  if (!b) return;
  const oneTime = b.frequency === 'one_time';
  const trialing = b.payment_state === 'trialing';
  const firstChargeOn: string | null = b.booking_answers?.first_charge_on ?? null;
  const startLabel = niceDate(b.starts_on);
  const paidToday = trialing ? 0 : (b.discount?.first_charge_cents ?? b.price_cents ?? b.monthly_price_cents ?? 0);

  // LANE B SAYS THE DATE, NEVER "LATER" (P16 §5). A trial the customer cannot see is a surprise
  // charge, and a surprise charge is a chargeback with a story attached.
  const moneyRows = oneTime
    ? `<tr><td style="padding:10px 16px;color:#5B6660">Paid today</td><td style="padding:10px 16px">${formatCents(paidToday, { forceDecimals: paidToday % 100 !== 0 })}</td></tr>`
    : trialing
      ? `<tr><td style="padding:10px 16px;color:#5B6660">Paid today</td><td style="padding:10px 16px"><strong>Nothing</strong></td></tr>
         <tr><td style="padding:10px 16px;color:#5B6660">First payment</td><td style="padding:10px 16px;font-weight:600">${firstChargeOn ? niceDate(firstChargeOn) : 'after your first visit'}</td></tr>
         <tr><td style="padding:10px 16px;color:#5B6660">Then monthly</td><td style="padding:10px 16px">${formatCents(b.monthly_price_cents)}</td></tr>`
      : `<tr><td style="padding:10px 16px;color:#5B6660">Paid today</td><td style="padding:10px 16px">${formatCents(paidToday, { forceDecimals: paidToday % 100 !== 0 })}</td></tr>
         <tr><td style="padding:10px 16px;color:#5B6660">Then monthly</td><td style="padding:10px 16px">${formatCents(b.monthly_price_cents)}</td></tr>`;

  const opening = oneTime
    ? `<p style="font-size:16px;line-height:1.6">Thanks for choosing Scoop Dogg. We'll be there on <strong>${startLabel}</strong>.</p>`
    : `<p style="font-size:16px;line-height:1.6">Thanks for choosing Scoop Dogg. Your first visit is <strong>${startLabel}</strong>, and after that we'll be there every <strong>${weekdayName(b.service_weekday)}</strong>.</p>`;

  /**
   * THE ACKNOWLEDGMENT. §17602(a)(3): an acknowledgment containing the renewal terms, the
   * cancellation policy and how to cancel, "in a manner that is capable of being retained by the
   * consumer". An email is that manner; §17602(i)(1) lets it follow the order rather than precede
   * it. Until 2026-09-19 this email's entire cancellation content was one sentence about the
   * account, which is neither the terms nor the policy (R9 §3).
   *
   * THE SENTENCE IS READ BACK FROM `consents`, NOT RECOMPOSED. If it were rebuilt here it could
   * differ from what was agreed — a price moving between the booking and the send is all it
   * would take — and an acknowledgment that restates terms nobody accepted is worse than none.
   *
   * §17602(c)(1) and (d)(3): online cancellation may sit behind a login only where a route that
   * does not is also offered AND described in this acknowledgment. That is the email address,
   * and it is why it is in here rather than only on the website.
   */
  let acknowledgment = '';
  if (!oneTime) {
    const { rows: cons } = await db().query(
      `select text_shown from consents where subscription_id = $1 and kind = 'renewal' order by agreed_at desc limit 1`,
      [bookingId]);
    const agreed: string | null = cons[0]?.text_shown ?? null;
    const settings = (await loadCatalog()).settings;
    acknowledgment = acknowledgmentHtml({
      agreedSentence: agreed,
      cancelEmail: String(settings.get('business.email') ?? ''),
      phone: String(settings.get('business.phone') ?? ''),
      site: process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.vercel.app',
    });
  }

  await sendEmail({
    purpose: 'booking_welcome',
    recipients: { explicit: [b.email] },
    fromName: 'Scoop Dogg',
    subject: oneTime ? `You're booked — ${startLabel}` : `You're booked — first visit ${startLabel}`,
    html: shell(`You're booked, ${String(b.name).split(' ')[0]}.`, `
      ${opening}
      <table style="width:100%;border-collapse:collapse;background:#F3F7F4;border-radius:12px;margin:20px 0">
        <tr><td style="padding:10px 16px;color:#5B6660">${oneTime ? 'Job' : 'Plan'}</td><td style="padding:10px 16px;font-weight:600">${b.package_name ?? ''}</td></tr>
        <tr><td style="padding:10px 16px;color:#5B6660">Address</td><td style="padding:10px 16px">${b.address}, ${b.city}</td></tr>
        ${moneyRows}
      </table>
      ${oneTime ? '' : '<p style="font-size:16px;line-height:1.6">You can skip a week, pause or cancel anytime from your account.</p>'}
      ${acknowledgment}
      <p><a href="${process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.vercel.app'}/account" style="display:inline-block;background:#F4A024;color:#0F2A1F;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">Go to your account</a></p>`),
  });
  await notifyOwner('booking_owner', `New customer: ${b.name} — ${b.package_name ?? 'one-time job'}`,
    { name: b.name, email: b.email, phone: b.phone, address: b.address, city: b.city } as BookingInput, null, startLabel,
    trialing ? `Card saved, nothing charged yet. First payment ${firstChargeOn ? niceDate(firstChargeOn) : 'after visit one'}.`
             : oneTime ? 'Paid online. One-time job.' : 'Paid online. First month collected.');
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
