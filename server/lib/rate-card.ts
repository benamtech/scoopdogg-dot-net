/**
 * The catalog as the OWNER edits it. The one change he makes most often, without us.
 *
 * Until this file every price on the site moved by migration. `checklist/prices/confirm` is a
 * confirm, not an edit; nothing in `api/` or `server/` has ever written `monthly_price_cents` or
 * any `service_tiers` column. P7: "most of the value here is removing the pull request from
 * 'raise a price'."
 *
 * WHAT THIS FILE DOES NOT IMPLEMENT, because the schema already does it:
 *
 *   GRANDFATHERING. `packages.version` is bumped by the `packages_version` trigger whenever
 *   `monthly_price_cents` changes (migration 011), `stripe_prices` is keyed on
 *   (package_id, livemode, account_id, version), and a subscription freezes
 *   `monthly_price_cents` + `package_version` onto its own row at sign-up. So raising a price
 *   mints a NEW Stripe Price and cannot mutate the one a live subscription points at. That is
 *   structural and predates this file. The SCREEN's job is to make the owner believe it — a
 *   price editor he is afraid of is a price editor he will not use — and the way it earns that
 *   is `customersOnEachPrice()` below, which shows him who is on what before he changes it.
 *
 * WHAT IT REFUSES, and each refusal is a sentence he can act on rather than a 500.
 */
import { db } from './db.js';
import { publishPricesWhenReady, type StripeMode } from './stripe.js';
import { safeError } from './http.js';

/** The house shape for a writer a gate can roll back (server/lib/team.ts). */
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class RateCardError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * WHAT A SAVE ACTUALLY CHANGES, AND WHEN — returned on every write, never implied.
 *
 * The checkout re-prices from these rows on every request (`server/lib/catalog-db.ts`), and since
 * 2026-09-29 so do the public pages: they render from the rows (server/lib/public-catalog.ts) and
 * every admin write purges the page cache (api/admin.ts, server/lib/site-cache.ts). So a save is
 * live everywhere at once. Until then the pages were built from a file and this returned a second
 * list, "effective on publish"; that list, its settings row and the publish button are gone.
 */
export type Effect = { effective_now: string[] };

async function effect(_q: Queryable = db()): Promise<Effect> {
  return { effective_now: ['what the next customer is charged', 'the booking journey', 'the public pages', 'this admin'] };
}

/** One row per field that actually moved. A save that changes nothing writes nothing. */
async function record(
  entity: 'service' | 'tier' | 'package' | 'offer',
  id: string, label: string,
  before: Record<string, unknown>, after: Record<string, unknown>, by: string, q: Queryable = db(),
): Promise<string[]> {
  const moved: string[] = [];
  for (const field of Object.keys(after)) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (same) continue;
    moved.push(field);
    await q.query(
      `insert into catalog_changes (entity, entity_id, entity_label, field, old_value, new_value, changed_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [entity, id, label, field, a === null ? null : String(a), b === null ? null : String(b), by]);
  }
  return moved;
}

export type TierRow = {
  id: string; service_slug: string; service_name: string; label: string; status: string;
  min_qty: number | null; max_qty: number | null; price_cents: number | null;
  price_suffix: string | null; requires_quote: boolean; price_is_from: boolean;
  est_minutes: number | null; covers_last_cleaned: string[] | null; sort_order: number;
  /** How many live subscriptions were sold through a package pointing at this tier. */
  live_customers: number;
};

export type PackageRow = {
  id: string; slug: string; service_slug: string; name: string; monthly_price_cents: number;
  version: number; status: string; featured: boolean; sort_order: number;
  published_test: boolean; published_live: boolean;
  /** Live subscriptions on this package, and what they are actually paying. */
  live_customers: number; frozen_prices: number[];
};

/**
 * WHO COUNTS AS "ON THIS PRICE". `subscriptions.state` runs draft -> quote_ready ->
 * quote_accepted -> deposit_pending -> active -> paused -> cancelled. The owner's question is
 * "who am I about to affect", and the answer is everyone whose arrangement still stands: a
 * deposit_pending customer has been quoted a number and a paused one is coming back to one.
 * Excluding by name rather than including by name so that a state added later is counted until
 * somebody decides it should not be — the failure that way round is visible.
 */
export async function listRateCard(q: Queryable = db()) {
  const { rows: tiers } = await q.query(
    `select t.id, t.service_slug, s.name as service_name, t.label, t.status, t.min_qty, t.max_qty,
            t.price_cents, t.price_suffix, t.requires_quote, t.price_is_from, t.est_minutes,
            t.covers_last_cleaned, t.sort_order,
            (select count(*)::int from subscriptions sub
               join packages p on p.id = sub.package_id
              where p.tier_id = t.id and sub.state not in ('draft', 'cancelled')) as live_customers
       from service_tiers t join services s on s.slug = t.service_slug
      order by s.sort_order, t.sort_order`);

  const { rows: packages } = await q.query(
    `select p.id, p.slug, p.service_slug, p.name, p.monthly_price_cents, p.version, p.status,
            p.featured, p.sort_order,
            exists(select 1 from stripe_prices sp where sp.package_id = p.id and sp.version = p.version and sp.livemode = false) as published_test,
            exists(select 1 from stripe_prices sp where sp.package_id = p.id and sp.version = p.version and sp.livemode = true)  as published_live,
            (select count(*)::int from subscriptions sub where sub.package_id = p.id and sub.state not in ('draft', 'cancelled')) as live_customers,
            coalesce((select array_agg(distinct sub.monthly_price_cents) from subscriptions sub
                       where sub.package_id = p.id and sub.state not in ('draft', 'cancelled')), '{}') as frozen_prices
       from packages p order by p.sort_order`);

  const { rows: services } = await q.query(
    `select slug, name, kind, status, sort_order from services order by sort_order`);

  const { rows: changes } = await q.query(
    `select entity, entity_id, entity_label, field, old_value, new_value, changed_by, changed_at
       from catalog_changes order by changed_at desc limit 40`);

  return { services, tiers, packages, changes, ...(await effect(q)) };
}

/**
 * A FLOOR MUST NOT BE THE ONLY THING A SERVICE SAYS.
 *
 * `price_is_from` means "from $70" and `gates/from-price-never-final.mjs` already enforces that
 * such a number is never presented as final. That guarantee holds because there is always
 * something else for a customer to land on. Make the ONLY priced tier of a service a "from"
 * price and the service now has no price at all, only a floor — which is how a published number
 * quietly becomes a quote, and the gate cannot see it because each tier is individually fine.
 */
async function refuseLonelyFromPrice(tierId: string, serviceSlug: string, priceIsFrom: boolean, q: Queryable = db()) {
  if (!priceIsFrom) return;
  const { rows: [r] } = await q.query(
    `select count(*)::int as n from service_tiers
      where service_slug = $1 and status = 'active' and id <> $2
        and requires_quote = false and price_is_from = false and price_cents is not null`,
    [serviceSlug, tierId]);
  if (r.n === 0) {
    throw new RateCardError('lonely_from_price',
      'This is the only tier on this service with a firm price, so making it a "from" price would leave the service with no price at all — only a floor. Add a tier with a firm price first, or leave this one as it is.');
  }
}

export type TierPatch = {
  price_cents?: number | null; price_suffix?: string | null;
  price_is_from?: boolean; requires_quote?: boolean; label?: string; status?: string;
};

export async function setTier(id: string, patch: TierPatch, by: string, q: Queryable = db()) {
  const { rows: [before] } = await q.query(
    `select id, service_slug, label, status, price_cents, price_suffix, requires_quote, price_is_from
       from service_tiers where id = $1`, [id]);
  if (!before) throw new RateCardError('no_tier', 'We do not have that tier.', 404);

  const next = {
    label: patch.label ?? before.label,
    status: patch.status ?? before.status,
    price_cents: patch.price_cents === undefined ? before.price_cents : patch.price_cents,
    price_suffix: patch.price_suffix === undefined ? before.price_suffix : patch.price_suffix,
    requires_quote: patch.requires_quote ?? before.requires_quote,
    price_is_from: patch.price_is_from ?? before.price_is_from,
  };

  if (next.status !== 'active' && next.status !== 'retired') {
    throw new RateCardError('bad_status', 'A tier is either active or retired.');
  }
  if (next.price_cents !== null && !(Number.isInteger(next.price_cents) && next.price_cents > 0)) {
    throw new RateCardError('bad_price', 'A price has to be a whole number of cents, above zero. Leave it empty if this tier is quote-only.');
  }
  // The database enforces this too (service_tiers_check). Catching it here is the difference
  // between a sentence and a 500 with a constraint name in it.
  if (next.price_cents === null && !next.requires_quote) {
    throw new RateCardError('no_price_no_quote', 'A tier needs either a price or the quote-only switch turned on, or the site has nothing to show for it.');
  }
  if (next.requires_quote && next.price_is_from) {
    throw new RateCardError('quote_and_from', 'A tier cannot be quote-only and a "from" price at the same time — the first says there is no number yet and the second shows one.');
  }
  await refuseLonelyFromPrice(id, before.service_slug, next.price_is_from && !next.requires_quote, q);

  // RETIRING A TIER A PACKAGE IS SOLD THROUGH. P7 rule 4 is "retire, never delete", and this is
  // the other half of it: a retired tier stops being offered, so a package still pointing at it
  // would be a plan a new customer can buy whose tier the site no longer shows.
  if (next.status === 'retired' && before.status !== 'retired') {
    const { rows: [p] } = await q.query(
      `select count(*)::int as n from packages where tier_id = $1 and status = 'active'`, [id]);
    if (p.n > 0) {
      throw new RateCardError('tier_has_packages',
        `${p.n} active plan${p.n === 1 ? '' : 's'} still sell this tier. Retire ${p.n === 1 ? 'that plan' : 'those plans'} first — existing customers keep theirs either way.`);
    }
  }

  const { rows: [after] } = await q.query(
    `update service_tiers set label = $2, status = $3, price_cents = $4, price_suffix = $5,
            requires_quote = $6, price_is_from = $7, updated_by = $8, updated_at = now()
      where id = $1 returning *`,
    [id, next.label, next.status, next.price_cents, next.price_suffix, next.requires_quote, next.price_is_from, by]);

  const moved = await record('tier', id, `${before.service_slug} · ${before.label}`, before, next, by, q);
  return { tier: after, changed: moved, ...(await effect(q)) };
}

export type NewTier = {
  label: string; price_cents: number | null; price_suffix?: string | null;
  requires_quote?: boolean; price_is_from?: boolean;
};

/**
 * A new tier on a service — a new size, a new band, a new "large or custom". The same refusals as
 * an edit, because a new row can be wrong in every way an edited one can; and it lands last in its
 * service, active, recorded in the history like any other change.
 */
export async function addTier(serviceSlug: string, t: NewTier, by: string, q: Queryable = db()) {
  const { rows: [svc] } = await q.query(`select slug, name from services where slug = $1`, [serviceSlug]);
  if (!svc) throw new RateCardError('no_service', 'We do not have that service.', 404);
  const label = String(t.label ?? '').trim().slice(0, 120);
  if (!label) throw new RateCardError('no_label', 'A tier needs a name the customer will read, like "Large yard (500+ sq ft)".');
  const { rows: [dupe] } = await q.query(
    `select 1 from service_tiers where service_slug = $1 and lower(label) = lower($2) and status = 'active'`, [serviceSlug, label]);
  if (dupe) throw new RateCardError('duplicate_label', `${svc.name} already has a tier called "${label}".`);
  const next = {
    label, status: 'active',
    price_cents: t.price_cents ?? null,
    price_suffix: t.price_suffix ?? '',
    requires_quote: Boolean(t.requires_quote),
    price_is_from: Boolean(t.price_is_from),
  };
  if (next.price_cents !== null && !(Number.isInteger(next.price_cents) && next.price_cents > 0)) {
    throw new RateCardError('bad_price', 'A price has to be a whole number of cents, above zero. Leave it empty if this tier is quote-only.');
  }
  if (next.price_cents === null && !next.requires_quote) {
    throw new RateCardError('no_price_no_quote', 'A tier needs either a price or the quote-only switch turned on, or the site has nothing to show for it.');
  }
  if (next.requires_quote && next.price_is_from) {
    throw new RateCardError('quote_and_from', 'A tier cannot be quote-only and a "from" price at the same time — the first says there is no number yet and the second shows one.');
  }
  if (next.requires_quote) next.price_cents = null;
  const { rows: [{ n }] } = await q.query(`select coalesce(max(sort_order), 0)::int + 10 as n from service_tiers where service_slug = $1`, [serviceSlug]);
  const { rows: [row] } = await q.query(
    `insert into service_tiers (service_slug, label, price_cents, price_suffix, requires_quote, price_is_from, sort_order, status, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,'active',$8) returning *`,
    [serviceSlug, next.label, next.price_cents, next.price_suffix, next.requires_quote, next.price_is_from, n, by]);
  const moved = await record('tier', row.id, `${serviceSlug} · ${label}`, {}, next, by, q);
  return { tier: row, changed: moved, ...(await effect(q)) };
}

/**
 * PUBLISH TO STRIPE IS PART OF SAVING, NOT A BUTTON SOMEBODY FORGETS.
 *
 * The version bump is automatic (the `packages_version` trigger), and a bumped version has no
 * Stripe Price until something publishes one. This session's own history is the argument:
 * repointing the connected account orphaned nine of ten published Prices and only the full gate
 * suite noticed. The same hazard exists on every price change.
 *
 * It cannot take the save down. A Stripe outage must not stop the owner changing his own price —
 * the row is the truth and `server/lib/booking.ts` mints a Price on the fly at checkout if one is
 * somehow missing. So publishing is attempted, its result is returned, and its failure is
 * reported rather than thrown.
 */
export async function setPackagePrice(
  id: string, monthlyCents: number, by: string,
  q: Queryable = db(),
  /**
   * PUBLISH ONLY WHEN THIS OWNS THE CONNECTION, and the default expresses exactly that.
   *
   * `publishPricesWhenReady` reads through the pool and writes to Stripe. Called from inside a
   * caller's open transaction it would read a version that has not committed, and if that
   * transaction then rolls back — which is what every gate on this project does — Stripe would
   * be left holding a Price for a package version that never existed. That is the orphaning this
   * repo has already paid for once, from the other direction, when repointing the connected
   * account stranded nine of ten Prices.
   *
   * So a caller supplying its own client is saying "this may not be real yet", and publishing is
   * off. Nothing else changes, which is what lets a gate prove the version bump and the
   * grandfathering without touching a payment processor.
   */
  publishToStripe: boolean = q === db(),
) {
  if (!Number.isInteger(monthlyCents) || monthlyCents <= 0) {
    throw new RateCardError('bad_price', 'A monthly price has to be a whole number of cents, above zero.');
  }
  const { rows: [before] } = await q.query(
    `select id, slug, name, monthly_price_cents, version, status from packages where id = $1`, [id]);
  if (!before) throw new RateCardError('no_package', 'We do not have that plan.', 404);

  /**
   * `source` IS THE PROVENANCE OF THE NUMBER, NOT THE AUTHOR OF THE ROW — `updated_by` is the
   * author. Migration 011 allows exactly two values and its column comment says what they mean:
   * 'derived_from_published' is arithmetic on a price Josue already publishes, 'confirmed' is a
   * human saying the number is right. An owner typing a price into his own rate card is the
   * strongest confirmation there is, so it is the second one. The first version of this wrote
   * 'owner', which is a third value nothing allows — `packages_source_check` refused it and the
   * owner's first save would have been a 500. gates/rate-card.mjs caught it on its first run.
   *
   * `derivation` IS OVERWRITTEN FOR THE SAME REASON. It holds the working in words so the admin
   * can show why a number is what it is, and after the owner overrides the number the old
   * arithmetic is no longer why — leaving it would have the screen explain his price with a
   * derivation that did not produce it.
   */
  const { rows: [after] } = await q.query(
    `update packages set monthly_price_cents = $2, source = 'confirmed',
            derivation = $4, updated_by = $3 where id = $1 returning *`,
    [id, monthlyCents, by, `set by ${by} in the rate card`]);

  const moved = await record('package', id, before.name,
    { monthly_price_cents: before.monthly_price_cents }, { monthly_price_cents: monthlyCents }, by, q);

  const published: Record<string, unknown> = {};
  if (moved.length && publishToStripe) {
    for (const mode of ['test', 'live'] as StripeMode[]) {
      published[mode] = await publishPricesWhenReady(mode, 'admin:rate-card').catch((e) => {
        safeError(`rate-card:publish:${mode}`, e);
        return { attempted: false, created: 0, already: 0, reason: 'publish failed — the price is saved; see logs' };
      });
    }
  }
  return { package: after, changed: moved, was_version: before.version, published, ...(await effect(q)) };
}
