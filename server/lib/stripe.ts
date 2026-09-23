/**
 * Stripe, for Scoop Dogg: direct charges on Josue's connected account, on AMTECH's platform
 * keys (Ben, 2026-09-16: "you can make custom stripe whatever you need using our keys").
 *
 * THE RULE EVERYTHING HANGS OFF: the key and the connected acct_ come from the SAME MODE,
 * resolved together, every call. A live key with a test account id fails with an error that
 * names neither (NEXT-SESSION-2026-09-12-0930, e-key-and-account-same-row).
 *
 *   mode   'test' when demo.mode is on, 'live' otherwise
 *   key    STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE from the environment, never logged
 *   acct_  stripe_connection.account_id where livemode matches
 *
 * Accounts are V2 (no top-level type; `dashboard: 'full'` is the Standard equivalent), and
 * readiness is read from the API, never trusted from a stored boolean.
 */
import Stripe from 'stripe';
import { db } from './db.js';
import { demoMode } from './notify.js';

export type StripeMode = 'test' | 'live';

const clients = new Map<StripeMode, Stripe>();

export function stripeFor(mode: StripeMode): Stripe {
  const existing = clients.get(mode);
  if (existing) return existing;
  const key = mode === 'test' ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY_LIVE;
  if (!key) throw new Error(`stripe_key_missing_${mode}`);
  if (!key.startsWith(`sk_${mode}_`) && !key.startsWith(`rk_${mode}_`)) throw new Error(`stripe_key_mode_mismatch_${mode}`);
  const client = new Stripe(key, { appInfo: { name: 'ScoopDogg-Site', url: 'https://scoopdogg.net' }, maxNetworkRetries: 2 });
  clients.set(mode, client);
  return client;
}

/** The mode the whole system is in right now. One setting, four surfaces (P11). */
export async function currentMode(): Promise<StripeMode> {
  const demo = await demoMode();
  return demo.mode ? 'test' : 'live';
}

export type Connection = {
  livemode: boolean;
  account_id: string | null;
  card_payments_status: string | null;
  requirements_status: string | null;
  last_probed_at: string | null;
  platform_fee_bps: number;
  display_name: string | null;
};

export async function connection(mode: StripeMode): Promise<Connection | null> {
  const { rows } = await db().query(
    `select livemode, account_id, card_payments_status, requirements_status, last_probed_at, platform_fee_bps, display_name
       from stripe_connection where livemode = $1`, [mode === 'live']);
  return rows[0] ?? null;
}

/** Key and account, together. Throws if the mode has no connected account yet. */
export async function resolve(mode?: StripeMode) {
  const m = mode ?? (await currentMode());
  const conn = await connection(m);
  if (!conn?.account_id) throw new Error(`stripe_not_connected_${m}`);
  return { mode: m, stripe: stripeFor(m), account: conn.account_id, feeBps: conn.platform_fee_bps, conn };
}

// ---------------------------------------------------------------------------------------
// Onboarding: create the V2 account, link to Stripe-hosted onboarding, read status back.
// ---------------------------------------------------------------------------------------

export async function createConnectedAccount(mode: StripeMode, opts: { displayName: string; email: string; by: string }) {
  const existing = await connection(mode);
  if (existing?.account_id) return { accountId: existing.account_id, created: false };
  const stripe = stripeFor(mode);
  const account = await stripe.v2.core.accounts.create({
    display_name: opts.displayName,
    contact_email: opts.email,
    identity: { country: 'us' },
    dashboard: 'full',
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    configuration: {
      customer: {},
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
  } as never);
  await db().query(
    `update stripe_connection set account_id = $2, connected_at = now(), connected_by = $3, display_name = $4, updated_at = now()
      where livemode = $1`, [mode === 'live', (account as { id: string }).id, opts.by, opts.displayName]);
  return { accountId: (account as { id: string }).id, created: true };
}

export async function onboardingLink(mode: StripeMode, base: string) {
  const conn = await connection(mode);
  if (!conn?.account_id) throw new Error(`stripe_not_connected_${mode}`);
  const stripe = stripeFor(mode);
  const link = await stripe.v2.core.accountLinks.create({
    account: conn.account_id,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant', 'customer'],
        refresh_url: `${base}/admin/payments?onboarding=refresh`,
        return_url: `${base}/admin/payments?onboarding=returned`,
      },
    },
  } as never);
  return (link as { url: string }).url;
}

export type AccountStatus = {
  mode: StripeMode;
  account_id: string | null;
  ready: boolean;
  card_payments: string | null;
  requirements: string | null;
  probed_at: string;
};

/** Read readiness from Stripe and cache it WITH its age. Screens show the age. */
export async function probeAccount(mode: StripeMode): Promise<AccountStatus> {
  const conn = await connection(mode);
  const probed_at = new Date().toISOString();
  if (!conn?.account_id) return { mode, account_id: null, ready: false, card_payments: null, requirements: null, probed_at };
  const stripe = stripeFor(mode);
  let card: string | null = null;
  let reqs: string | null = null;
  let error: string | null = null;
  try {
    const acct = (await stripe.v2.core.accounts.retrieve(conn.account_id, {
      include: ['configuration.merchant', 'requirements'],
    } as never)) as unknown as {
      configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } };
      requirements?: { summary?: { minimum_deadline?: { status?: string } } };
    };
    card = acct.configuration?.merchant?.capabilities?.card_payments?.status ?? null;
    reqs = acct.requirements?.summary?.minimum_deadline?.status ?? null;
  } catch (e) {
    error = (e as Error).message.slice(0, 200);
  }
  const ready = card === 'active' && reqs !== 'currently_due' && reqs !== 'past_due';
  await db().query(
    `update stripe_connection set card_payments_status = $2, requirements_status = $3, charges_enabled = $4,
            last_probed_at = now(), probe_error = $5, updated_at = now() where livemode = $1`,
    [mode === 'live', card, reqs, ready, error]);
  return { mode, account_id: conn.account_id, ready, card_payments: card, requirements: reqs, probed_at };
}

// ---------------------------------------------------------------------------------------
// Catalog -> Stripe. A package is a versioned Price on the connected account; the database
// row stays the source (S19). Idempotent: an existing (package, mode, account, version)
// row is reused, never recreated.
// ---------------------------------------------------------------------------------------

type PackageRow = { id: string; slug: string; service_slug: string; name: string; monthly_price_cents: number; version: number };

const PRODUCT_NAMES: Record<string, string> = {
  'weekly-pooper-scooper-service': 'Weekly poop scooping',
  'weekly-turf-maintenance': 'Weekly turf maintenance',
  'weekly-yard-maintenance': 'Weekly yard maintenance',
  'kitty-litter-exchange': 'Weekly litter box service',
};

async function productFor(stripe: Stripe, account: string, serviceSlug: string): Promise<string> {
  const lookup = `sd_service_${serviceSlug}`;
  const found = await stripe.products.search({ query: `metadata['sd_lookup']:'${lookup}'` }, { stripeAccount: account });
  if (found.data[0]) return found.data[0].id;
  const product = await stripe.products.create(
    { name: PRODUCT_NAMES[serviceSlug] ?? serviceSlug, metadata: { sd_lookup: lookup, service_slug: serviceSlug } },
    { stripeAccount: account, idempotencyKey: `product-${account}-${lookup}` },
  );
  return product.id;
}

export async function priceForPackage(mode: StripeMode, pkg: PackageRow) {
  const { stripe, account } = await resolve(mode);
  const { rows } = await db().query(
    `select price_id, product_id, unit_amount from stripe_prices
      where package_id = $1 and livemode = $2 and account_id = $3 and version = $4`,
    [pkg.id, mode === 'live', account, pkg.version]);
  if (rows[0]) return { priceId: rows[0].price_id as string, productId: rows[0].product_id as string, created: false };

  const productId = await productFor(stripe, account, pkg.service_slug);
  const lookupKey = `${pkg.slug}_v${pkg.version}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 }, { stripeAccount: account });
  const price = existing.data[0] ?? await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: pkg.monthly_price_cents,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    nickname: pkg.name,
    metadata: { package_id: pkg.id, package_slug: pkg.slug, version: String(pkg.version) },
  }, { stripeAccount: account, idempotencyKey: `price-${account}-${lookupKey}` });
  if (price.unit_amount !== pkg.monthly_price_cents) throw new Error(`stripe_price_mismatch_${lookupKey}`);
  await db().query(
    `insert into stripe_prices (package_id, livemode, version, account_id, product_id, price_id, lookup_key, unit_amount)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
    [pkg.id, mode === 'live', pkg.version, account, productId, price.id, lookupKey, pkg.monthly_price_cents]);
  return { priceId: price.id, productId, created: true };
}

export async function publishAllPrices(mode: StripeMode) {
  const { rows } = await db().query(
    `select id, slug, service_slug, name, monthly_price_cents, version from packages where status = 'active' order by sort_order`);
  const out = [];
  for (const p of rows) out.push({ slug: p.slug, cents: p.monthly_price_cents, ...(await priceForPackage(mode, p)) });
  return out;
}

/**
 * Publish the price list to the connected account as soon as that account can take a card —
 * and never before, never twice, and never by anybody remembering to.
 *
 * THE GAP THIS CLOSES, measured 2026-09-23: `stripe_prices` held 33 rows and **every one was
 * test mode**. Zero live prices. The live `stripe_connection` row had no account at all, so that
 * was correct — but the moment Josue finishes Stripe's hosted onboarding, the site is live,
 * pointed at his account, and **cannot take a booking**, because `startSubscription()` needs a
 * Price on that account and there would be none. The only thing that published them was a button
 * on the admin Payments screen, which works exactly as long as somebody remembers it exists.
 *
 * That made "connect your Stripe account" a two-step job where only the first step is written
 * down anywhere, and the second step is invisible until a customer hits it.
 *
 * TWO TRIGGERS, ON PURPOSE. Stripe's `account.updated` webhook calls this, and so does opening
 * the admin Payments screen — which is where Josue lands when hosted onboarding returns him. One
 * of them is enough; having both means the site does not depend on a webhook being registered,
 * which is the kind of single point this project has already been caught by.
 *
 * IT CANNOT PUBLISH THE WRONG THING. `priceForPackage()` is idempotent three ways — our own
 * `stripe_prices` row, then Stripe's `lookup_key`, then an idempotency key — and it throws rather
 * than return a Price whose `unit_amount` disagrees with the package. This adds one guard in
 * front of all that: nothing is attempted until Stripe itself says `card_payments` is active, so
 * a half-finished onboarding does not scatter Prices across an account that cannot charge.
 */
export type PricePublishResult = {
  attempted: boolean;
  created: number;
  already: number;
  reason: string | null;
};

export async function publishPricesWhenReady(mode: StripeMode, by = 'system'): Promise<PricePublishResult> {
  const none = (reason: string): PricePublishResult => ({ attempted: false, created: 0, already: 0, reason });

  const conn = await connection(mode);
  if (!conn?.account_id) return none(`no ${mode} account is connected yet`);

  const { rows: rev } = await db().query(
    `select revoked_at from stripe_connection where livemode = $1`, [mode === 'live']);
  if (rev[0]?.revoked_at) return none('the connection is revoked');

  // ASK STRIPE, do not trust the stored status. P18 §1.3: readiness is read from the API every
  // time, because an account that quietly stops paying out is the worst silent failure here.
  const probe = await probeAccount(mode).catch(() => null);
  if (!probe?.ready) return none(`card_payments is ${probe?.card_payments ?? 'unread'}, not active`);

  const { rows: [gap] } = await db().query(
    `select count(*)::int as missing from packages p
      where p.status = 'active'
        and not exists (
          select 1 from stripe_prices sp
           where sp.package_id = p.id and sp.version = p.version
             and sp.livemode = $1 and sp.account_id = $2)`,
    [mode === 'live', conn.account_id]);
  const { rows: [have] } = await db().query(
    `select count(*)::int as n from stripe_prices where livemode = $1 and account_id = $2`,
    [mode === 'live', conn.account_id]);
  if (gap.missing === 0) return { attempted: false, created: 0, already: have.n, reason: 'every active package already has a price' };

  const published = await publishAllPrices(mode);
  const created = published.filter((r) => (r as { created?: boolean }).created).length;
  console.log(`[stripe] published ${created} ${mode} price(s) for ${conn.account_id} (trigger: ${by})`);
  return { attempted: true, created, already: published.length - created, reason: null };
}

/** A percent-off coupon for an offer, once, on the connected account, limited to products. */
export async function couponForOffer(mode: StripeMode, offer: { id: string; name: string; value: number }, productIds: string[]) {
  const { stripe, account } = await resolve(mode);
  const key = `${mode === 'live'}:${account}`;
  const { rows } = await db().query(`select stripe_coupon_ids from offers where id = $1`, [offer.id]);
  const ids = (rows[0]?.stripe_coupon_ids ?? {}) as Record<string, string>;
  if (ids[key]) return ids[key];
  const coupon = await stripe.coupons.create({
    name: offer.name.slice(0, 40),
    percent_off: offer.value,
    duration: 'once',
    applies_to: { products: productIds },
    metadata: { offer_id: offer.id },
  }, { stripeAccount: account, idempotencyKey: `coupon-${account}-${offer.id}-${productIds.sort().join('.')}` });
  await db().query(
    `update offers set stripe_coupon_ids = coalesce(stripe_coupon_ids, '{}'::jsonb) || jsonb_build_object($2::text, $3::text) where id = $1`,
    [offer.id, key, coupon.id]);
  return coupon.id;
}

// ---------------------------------------------------------------------------------------
// TEST MODE ONLY: a connected account verified through the API with Stripe's test data, so
// the checkout, subscription and portal gates run end to end without a human clicking
// through hosted onboarding. It exercises exactly the same payment code (Stripe-Account
// header, direct charges, application fee). Live mode never uses this: Josue's account is the
// V2 full-dashboard account created by createConnectedAccount() and onboarded by him.
// ---------------------------------------------------------------------------------------
/**
 * MEASURED 2026-09-19, AND IT DOES NOT GET ALL THE WAY. This makes an account and takes
 * card_payments from 'restricted' to 'pending', but Stripe then asks for
 * `identity.individual.documents.primary_verification` (an uploaded ID) and an `external_account`
 * (a bank account) before it will go 'active'. Supplying the identity block again as an update
 * changes nothing. So a scripted fixture CANNOT currently reach a chargeable test account.
 *
 * The cheap way to PASS(paid) is therefore the product's own button: one human completes Stripe's
 * hosted onboarding on the test account once, in a browser, using Stripe's test values. That is
 * the same flow Josue will use, which makes it worth more as evidence than a fixture anyway.
 */
export async function createTestFixtureAccount(by: string) {
  const stripe = stripeFor('test');
  // Accounts v1 creation is refused on this platform ("Stripe no longer recommends Accounts
  // v1"), so the fixture is a V2 account with no dashboard, which lets the platform supply
  // the requirements through the API with Stripe's documented test values.
  const account = (await stripe.v2.core.accounts.create({
    display_name: 'Scoop Dogg (test fixture)',
    contact_email: 'scoopdogg-test-fixture@example.com',
    dashboard: 'none',
    identity: {
      country: 'us',
      entity_type: 'individual',
      attestations: { terms_of_service: { account: { date: new Date().toISOString(), ip: '8.8.8.8' } } },
      individual: {
        given_name: 'Test',
        surname: 'Scooper',
        email: 'scoopdogg-test-fixture@example.com',
        phone: '+18888675309',
        date_of_birth: { day: 1, month: 1, year: 1901 },
        id_numbers: [{ type: 'us_ssn', value: '000000000' }],
        address: { line1: 'address_full_match', city: 'Ventura', state: 'CA', postal_code: '93001', country: 'us' },
      },
    },
    defaults: {
      currency: 'usd',
      // A dashboard-less account is PLATFORM-controlled, so the platform collects both. Asking
      // for fees_collector 'stripe' on it is the contradiction Stripe answers with
      // `account_controller_unsupported_configuration` (measured 2026-09-19). Josue's real
      // account is dashboard 'full' with Stripe collecting; this fixture exists to exercise the
      // same CHARGE path - Checkout on a connected account with an application fee - not to
      // mirror his account's controller.
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      profile: { business_url: 'https://scoopdogg.net', doing_business_as: 'Scoop Dogg', product_description: 'Weekly dog waste removal' },
    },
    configuration: {
      merchant: { mcc: '7349', capabilities: { card_payments: { requested: true } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    include: ['requirements', 'configuration.merchant'],
  } as never)) as unknown as { id: string };
  await db().query(
    `update stripe_connection set account_id = $1, connected_at = now(), connected_by = $2, display_name = 'Scoop Dogg (test fixture)', updated_at = now()
      where livemode = false`, [account.id, by]);
  return { accountId: account.id };
}

/** What Stripe still wants from an account, in its own words. */
export async function requirementsOf(mode: StripeMode) {
  const conn = await connection(mode);
  if (!conn?.account_id) return null;
  const acct = (await stripeFor(mode).v2.core.accounts.retrieve(conn.account_id, { include: ['requirements', 'configuration.merchant'] } as never)) as unknown as {
    requirements?: { entries?: { description: string; minimum_deadline?: { status?: string }; errors?: { description?: string }[] }[] };
    configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } };
  };
  return {
    card_payments: acct.configuration?.merchant?.capabilities?.card_payments?.status ?? null,
    entries: (acct.requirements?.entries ?? []).map((e) => `${e.minimum_deadline?.status}: ${e.description}${e.errors?.length ? ' ! ' + e.errors.map((x) => x.description).join('; ') : ''}`),
  };
}

/** Readiness for a v1 account (the test fixture). */
export async function probeV1Account(mode: StripeMode) {
  const conn = await connection(mode);
  if (!conn?.account_id) return null;
  const acct = await stripeFor(mode).accounts.retrieve(conn.account_id);
  const card = acct.capabilities?.card_payments ?? null;
  await db().query(
    `update stripe_connection set card_payments_status = $2, requirements_status = $3, charges_enabled = $4, last_probed_at = now(), probe_error = null, updated_at = now()
      where livemode = $1`, [mode === 'live', card, acct.requirements?.currently_due?.length ? 'currently_due' : 'none', acct.charges_enabled]);
  return { account_id: acct.id, charges_enabled: acct.charges_enabled, card_payments: card, currently_due: acct.requirements?.currently_due ?? [] };
}

// ---------------------------------------------------------------------------------------
// Disconnecting, and why it is not "closing the account" (P18 §1.4, rewritten 2026-09-19).
//
// P18 §1.4 was written for OAuth, where a disconnect is `oauth/deauthorize`. This integration
// does not use OAuth - Stripe's Accounts v2 page lists "Using OAuth to authenticate connected
// accounts" under the cases where you MUST use Accounts v1, and v1 account creation is refused
// for this platform. So the v2 question is what the equivalent is, and the answer measured
// against the API reference on 2026-09-19 is: there isn't one, and there should not be.
//
//   POST /v2/core/accounts/:id/close answers `stripe_loss_liable_cannot_be_deleted` for an
//   account with a dashboard that Stripe is loss-liable for - which is exactly the account
//   createConnectedAccount() makes (dashboard: 'full', losses_collector: 'stripe').
//
// That refusal is correct. It is JOSUE'S Stripe account, with his customers, his payouts and his
// history in it; AMTECH never had the standing to delete it. What we can end is our own claim on
// his money, and that is the whole of a disconnect:
//
//   1. clear `application_fee_percent` from every live subscription. Stripe, verbatim: the fee
//      "continues to be collected by the platform after disconnect" otherwise. Taking 9% from a
//      business that has left is the single worst thing this integration could do by accident,
//      and it would do it quietly, monthly, until somebody read a statement.
//   2. record that we stopped.
//
// Step 1 runs FIRST and step 2 only if it succeeded, because after we stop reading the row we
// would no longer notice that a fee survived.
// ---------------------------------------------------------------------------------------

/** Clear AMTECH's percentage from live subscriptions. Dry by default; `apply` writes. */
export async function clearPlatformFee(mode: StripeMode, { apply = false } = {}) {
  const { stripe, account } = await resolve(mode);
  let scanned = 0, live = 0, carrying = 0, cleared = 0;
  const failures: string[] = [];
  const ids: string[] = [];
  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100 }, { stripeAccount: account })) {
    scanned++;
    // A cancelled subscription cannot be charged a fee, so it is not our problem; one that is
    // paused or past_due very much can be.
    if (['canceled', 'incomplete_expired'].includes(sub.status)) continue;
    live++;
    const pct = sub.application_fee_percent;
    if (pct == null || Number(pct) === 0) continue;
    carrying++;
    ids.push(sub.id);
    if (!apply) continue;
    try {
      // Stripe unsets an optional number by being sent an empty string.
      await stripe.subscriptions.update(sub.id, { application_fee_percent: '' as unknown as number }, { stripeAccount: account });
      cleared++;
    } catch (e) {
      failures.push(`${sub.id}: ${String((e as Error).message).split('\n')[0]}`);
    }
  }
  return { account, scanned, live, carrying, cleared, failures, ids, applied: apply };
}

export async function disconnect(mode: StripeMode, by: string) {
  const fee = await clearPlatformFee(mode, { apply: true });
  if (fee.failures.length) {
    // Not recorded as disconnected: a fee we failed to clear is a fee that keeps being collected,
    // and a row saying we left would stop anyone looking for it.
    throw new Error(`platform_fee_not_cleared:${fee.failures.length}`);
  }
  await db().query(
    `update stripe_connection set revoked_at = now(), revoked_by = $2, updated_at = now() where livemode = $1`,
    [mode === 'live', by]);
  return { ...fee, revoked: true };
}

export async function reconnect(mode: StripeMode) {
  await db().query(
    `update stripe_connection set revoked_at = null, revoked_by = null, updated_at = now() where livemode = $1`,
    [mode === 'live']);
  return probeAccount(mode);
}
