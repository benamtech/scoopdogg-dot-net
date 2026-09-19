/**
 * Bringing Josue's existing customers onto the rail (P18 §3) — lever 1 in P19 §3.
 *
 * He is paid in cash and Venmo today. Ben, 2026-09-19: roughly one to ten customers. Each one who
 * moves is 9% that did not exist and it starts the month they move, so this is the fastest revenue
 * in the plan even at that size — and it is the only lever here whose customers have already said
 * yes.
 *
 * THE PRICE ON THE INVITE IS THE PRICE JOSUE TYPES. Not the published ladder, which just went up
 * 11%. "A price change applies to new customers only" is a rule that protects the people who were
 * already paying, and these are exactly those people; an invite that quietly repriced them would
 * be the worst possible first message from a system they did not ask for. The Checkout line is
 * `price_data` at their amount, so nothing in the catalog can drag it.
 *
 * NOBODY IS FORCED. `payments.kind = 'manual'` and `billing.offline_methods` keep a cash customer
 * a first-class row. A portal that cannot represent how a business is actually paid gets worked
 * around within a week, and then the database is fiction.
 *
 * The link is a sign-in, so its token is stored as an HMAC and never in plain text — the same
 * shape verification_codes already uses.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { db } from './db.js';
import { sendEmail } from './notify.js';
import { appendEvent } from './events.js';
import { currentMode, resolve, connection } from './stripe.js';
import { startSubscription } from './money.js';
// An invited customer is agreeing to a continuous service just as a funnel customer is, so the
// same statute reaches this path and the same module writes the words. R9 §0; step 6.
import { renewalTerms } from '../../src/shared/consent.js';
import { recordConsent } from './consent.js';
import { formatCents, weekdayName } from '../../src/shared/pricing.js';
import { loadCatalog } from './catalog-db.js';

export class InviteError extends Error {
  constructor(public code: string, public userMessage: string, public status = 400) { super(code); }
}

function secret() {
  const s = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!s) throw new Error('SESSION_SECRET is not configured.');
  return s;
}
const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');
const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const normPhone = (p: string) => {
  const d = String(p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p ?? '').trim();
};

export type InviteInput = {
  name: string; email: string; phone: string;
  address: string; area_slug: string;
  price_cents: number;
  package_id?: string | null;
  starts_on?: string | null;
  num_dogs?: number | null;
  notes?: string;
};

/** One customer, one property, one draft subscription at HIS price, and one link. */
export async function createInvite(input: InviteInput, by: string, base: string) {
  const name = String(input.name ?? '').trim().slice(0, 120);
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 200);
  const phone = normPhone(input.phone);
  const price = Math.round(Number(input.price_cents));
  if (!name) throw new InviteError('name', 'Enter their name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InviteError('email', 'Enter a valid email address for them.');
  if (!Number.isFinite(price) || price <= 0) throw new InviteError('price', 'Enter what they pay a month, in dollars.');
  if (!input.address) throw new InviteError('address', 'Enter their address.');

  const { rows: area } = await db().query(
    `select slug, name from service_areas where slug = $1 and status = 'active'`, [input.area_slug]);
  if (!area.length) throw new InviteError('area', 'Choose the city they are in.');

  // A start day they will actually see. Three days out is the same lead time the funnel uses.
  const starts = /^\d{4}-\d{2}-\d{2}$/.test(String(input.starts_on ?? ''))
    ? String(input.starts_on)
    : new Date(Date.parse(`${todayLA()}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const weekday = new Date(`${starts}T12:00:00Z`).getUTCDay();

  const token = randomBytes(32).toString('hex');
  const client = await db().connect();
  let customerId = '', subscriptionId = '', inviteId = '';
  try {
    await client.query('begin');
    const { rows: existing } = await client.query(
      `select id, lower(email) as email from customers where phone = $1 and deleted_at is null limit 1`, [phone]);
    if (existing[0] && existing[0].email && existing[0].email !== email) {
      throw new InviteError('phone_in_use', 'That phone number is already on another Scoop Dogg account.', 409);
    }
    if (existing[0]) {
      customerId = existing[0].id;
      await client.query(`update customers set name = $2, email = $3, updated_at = now() where id = $1`, [customerId, name, email]);
    } else {
      const { rows } = await client.query(
        `insert into customers (name, phone, email, preferred_payment, notes)
         values ($1,$2,$3,'card',$4) returning id`,
        [name, phone, email, input.notes ? String(input.notes).slice(0, 1000) : '']);
      customerId = rows[0].id;
    }
    const { rows: prop } = await client.query(
      `insert into properties (customer_id, address, city, num_dogs, access_notes)
       values ($1,$2,$3,$4,$5) returning id`,
      [customerId, String(input.address).slice(0, 300), area[0].name, input.num_dogs ?? null, String(input.notes ?? '').slice(0, 1000)]);

    const { rows: sub } = await client.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, price_cents, price_tier_label, priced_at,
                                  frequency, service_weekday, starts_on, package_id, monthly_price_cents, area_slug,
                                  source, payment_state, booking_answers)
       values ($1,$2,'weekly-pooper-scooper-service','draft',$3,'Existing price',now(),'weekly',$4,$5,$6,$3,$7,'admin','none',$8::jsonb)
       returning id`,
      [customerId, prop[0].id, price, weekday, starts, input.package_id || null, area[0].slug,
       JSON.stringify({ invited_by: by, existing_customer: true })]);
    subscriptionId = sub[0].id;

    const { rows: inv } = await client.query(
      `insert into customer_invites (customer_id, property_id, subscription_id, email, phone, price_cents, package_id, token_hash, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [customerId, prop[0].id, subscriptionId, email, phone, price, input.package_id || null, hmac(token), by]);
    inviteId = inv[0].id;

    await appendEvent(client, {
      subjectKind: 'subscription', subjectId: subscriptionId, type: 'invite.created', to: 'draft',
      actorKind: 'owner', payload: { price_cents: price, area: area[0].slug, starts_on: starts, existing_customer: true },
    });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const link = `${base}/invite?t=${token}`;
  const sent = await sendEmail({
    purpose: 'customer_invite',
    recipients: { explicit: [email] },
    fromName: 'Scoop Dogg',
    replyTo: undefined,
    subject: 'Josue has added you to online billing',
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;color:#0F2A1F">You're all set, ${name.split(' ')[0]}.</h1>
      <p style="font-size:16px;line-height:1.6">Josue's added you to online billing at Scoop Dogg. Add a card and you're done —
      <strong>same service, same price, same day</strong>.</p>
      <table style="width:100%;border-collapse:collapse;background:#F3F7F4;border-radius:12px;margin:20px 0">
        <tr><td style="padding:10px 16px;color:#5B6660">Your price</td><td style="padding:10px 16px;font-weight:600">${formatCents(price)} a month</td></tr>
        <tr><td style="padding:10px 16px;color:#5B6660">Your day</td><td style="padding:10px 16px">${weekdayName(weekday)}</td></tr>
      </table>
      <p><a href="${link}" style="display:inline-block;background:#F4A024;color:#0F2A1F;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">Add my card</a></p>
      <p style="font-size:14px;color:#5B6660">Nothing changes about your service and your price is not going up. You can skip a week, pause or cancel anytime from your account. Prefer to keep paying cash or Venmo? Just tell Josue — this is only here if you want it.</p>
    </div>`,
  });

  await db().query(`update customer_invites set sent_at = now() where id = $1`, [inviteId]);
  return { invite_id: inviteId, customer_id: customerId, subscription_id: subscriptionId, email_state: sent.state, link_sent: sent.state !== 'failed' };
}

/**
 * The renewal terms for an invite, from the one module that writes them.
 *
 * An invited customer is being offered a continuous service at a price, which is what §17601
 * defines; that they already buy the same service for cash changes who is being asked, not what
 * they are agreeing to. So the same disclosures and the same consent record apply here, and
 * `readInvite` and `acceptInvite` both call this rather than each composing a sentence.
 *
 * `priceMayChange` is FALSE and that is a promise, not an omission: the whole invite says "same
 * price", the amount is the one Josue typed, and nothing in the catalog can drag it.
 */
async function inviteTerms(priceCents: number) {
  const settings = (await loadCatalog()).settings;
  return renewalTerms({
    lane: 'prepay',
    monthlyCents: priceCents,
    firstChargeCents: priceCents,
    firstChargeOn: null,
    packageName: 'weekly service',
    priceMayChange: false,
    cancelEmail: String(settings.get('business.email') ?? ''),
    businessName: String(settings.get('business.name') ?? 'Scoop Dogg'),
  });
}

/** What the /invite page may show before anyone pays. No token, no answer. */
export async function readInvite(token: string) {
  const { rows } = await db().query(
    `select i.id, i.price_cents, i.accepted_at, i.expires_at, c.name, s.id as subscription_id,
            s.starts_on::text as starts_on, s.service_weekday, p.address, a.name as area_name
       from customer_invites i
       join customers c on c.id = i.customer_id
       join subscriptions s on s.id = i.subscription_id
       left join properties p on p.id = i.property_id
       left join service_areas a on a.slug = s.area_slug
      where i.token_hash = $1`, [hmac(String(token ?? ''))]);
  const inv = rows[0];
  if (!inv) throw new InviteError('unknown', 'That link is not valid. Ask Josue to send it again.', 404);
  if (new Date(inv.expires_at) < new Date()) throw new InviteError('expired', 'That link has expired. Ask Josue to send a new one.', 410);
  return {
    name: inv.name, price_cents: inv.price_cents, address: inv.address, area: inv.area_name,
    starts_on: inv.starts_on, weekday: weekdayName(inv.service_weekday), accepted: Boolean(inv.accepted_at),
    terms: await inviteTerms(inv.price_cents),
  };
}

/**
 * Turn the invite into a Checkout session at THEIR price.
 *
 * It goes through money.ts like every other charge — `gates/one-money-door.mjs` counts doors, and
 * a second door opened "just for invites" is exactly the shape that gate exists to forbid. The
 * return lands on /book/complete, so completion, the invoice, the visits and the welcome email are
 * the one path booking.ts already proved rather than a parallel one written for this.
 */
export async function acceptInvite(token: string, base: string, consent: {
  text: string | null; ip: string | null; userAgent: string | null;
}) {
  const hash = hmac(String(token ?? ''));
  const { rows } = await db().query(
    `select i.id, i.customer_id, i.subscription_id, i.price_cents, i.accepted_at, i.expires_at,
            c.name, c.email, c.phone, p.address, s.starts_on::text as starts_on, s.service_weekday, s.state
       from customer_invites i
       join customers c on c.id = i.customer_id
       join subscriptions s on s.id = i.subscription_id
       left join properties p on p.id = i.property_id
      where i.token_hash = $1`, [hash]);
  const inv = rows[0];
  if (!inv) throw new InviteError('unknown', 'That link is not valid. Ask Josue to send it again.', 404);
  if (new Date(inv.expires_at) < new Date()) throw new InviteError('expired', 'That link has expired. Ask Josue to send a new one.', 410);
  if (inv.state === 'active') return { already_active: true as const };

  const mode = await currentMode();
  const conn = await connection(mode);
  if (!conn?.account_id || conn.card_payments_status !== 'active') {
    throw new InviteError('not_connected', 'Card payments are not switched on yet. Josue will be in touch — keep paying the way you do now.', 409);
  }
  // §17602(a)(4), the same check the funnel makes: the sentence the browser showed is compared
  // against one rebuilt here, and a mismatch stops the flow rather than storing a record of
  // something nobody read. If Josue edits the price between send and click, this is what catches
  // it — and catching it is the point, because that price is the entire promise of the invite.
  const terms = await inviteTerms(inv.price_cents);
  if (!consent.text) throw new InviteError('consent', 'Please tick the box agreeing to the renewal terms.', 400);
  if (consent.text.trim() !== terms.sentence) {
    throw new InviteError('consent_stale',
      'Your price or plan changed since this link was sent. Please reload the page and check the terms again.', 409);
  }

  const { stripe, account } = await resolve(mode);

  const { rows: sc } = await db().query(
    `select stripe_customer_id from stripe_customers where customer_id = $1 and livemode = $2 and account_id = $3`,
    [inv.customer_id, mode === 'live', account]);
  let stripeCustomerId = sc[0]?.stripe_customer_id as string | undefined;
  if (!stripeCustomerId) {
    const c = await stripe.customers.create({
      name: inv.name, email: inv.email, phone: inv.phone,
      address: { line1: inv.address ?? undefined, state: 'CA', country: 'US' },
      metadata: { scoopdogg_customer_id: inv.customer_id, source: 'invite' },
    }, { stripeAccount: account, idempotencyKey: `customer-${account}-${inv.customer_id}` });
    stripeCustomerId = c.id;
    await db().query(
      `insert into stripe_customers (customer_id, livemode, account_id, stripe_customer_id) values ($1,$2,$3,$4) on conflict do nothing`,
      [inv.customer_id, mode === 'live', account, c.id]);
  }

  // price_data, not a catalog Price: their price is their price.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
    quantity: 1,
    price_data: {
      currency: 'usd',
      unit_amount: inv.price_cents,
      recurring: { interval: 'month' },
      product_data: { name: 'Weekly service — your existing plan' },
    },
  }];
  // The consent row first, then the Checkout. `startSubscription` will not open a session
  // without the id, so the order is enforced rather than remembered.
  const client = await db().connect();
  let consentId: string;
  try {
    await client.query('begin');
    consentId = await recordConsent(client, {
      customerId: inv.customer_id, subscriptionId: inv.subscription_id, kind: 'renewal',
      textShown: terms.sentence, priceCents: inv.price_cents, lane: 'prepay',
      ip: consent.ip, userAgent: consent.userAgent,
    });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const session = await startSubscription({
    mode,
    consentId,
    customerId: stripeCustomerId,
    lineItems,
    couponId: null,
    description: `Existing customer — ${formatCents(inv.price_cents)} a month, unchanged`,
    metadata: { booking_id: inv.subscription_id, customer_id: inv.customer_id, invite_id: inv.id, source: 'invite' },
    submitMessage: 'Same service, same price, same day. Cancel anytime from your account.',
    successUrl: `${base}/book/complete?session_id={CHECKOUT_SESSION_ID}&booking=${inv.subscription_id}`,
    cancelUrl: `${base}/invite?t=${encodeURIComponent(token)}`,
    idempotencyKey: `invite-${inv.id}`,
  });

  await db().query(
    `update subscriptions set stripe_customer_id = $2, account_id = $3, state = 'deposit_pending', payment_state = 'pending',
            booking_answers = booking_answers || jsonb_build_object('checkout_session', $4::text, 'checkout_url', $5::text)
      where id = $1`, [inv.subscription_id, stripeCustomerId, account, session.id, session.url]);
  await db().query(`update customer_invites set accepted_at = now() where id = $1 and accepted_at is null`, [inv.id]);
  return { url: session.url as string };
}

/** The Customers screen: who is on the rail, who was invited, who is still cash. */
export async function customerList() {
  const { rows } = await db().query(`
    select c.id, c.name, c.email, c.phone, c.created_at,
           s.id as subscription_id, s.state, s.payment_state, s.monthly_price_cents, s.starts_on::text as starts_on,
           s.service_weekday, s.source, p.address, a.name as area_name,
           i.id as invite_id, i.sent_at, i.accepted_at
      from customers c
      left join lateral (select * from subscriptions x where x.customer_id = c.id order by x.created_at desc limit 1) s on true
      left join properties p on p.id = s.property_id
      left join service_areas a on a.slug = s.area_slug
      left join customer_invites i on i.subscription_id = s.id
     where c.deleted_at is null and c.name not like 'DEMO—%'
     order by c.created_at desc limit 500`);
  return { customers: rows };
}
