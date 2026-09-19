/**
 * Read the catalog out of the database and write content/catalog.json, as a build step.
 *
 *   node scripts/pull-catalog.mjs
 *
 * WHY. The audit found the catalog stored twice and the site reading the copy the admin
 * could not edit: 11 services, 34 tiers and 16 areas seeded into the database, while every
 * built page read src/lib/*.ts. This makes the database the only source. The static pages,
 * the booking island and the admin all read the same rows, and a price edited in the admin
 * reaches the site on the next publish.
 *
 * Same contract as scripts/pull-demo-state.mjs: if DATABASE_URL is set and the read fails,
 * the build STOPS. A site built from a stale file after a failed read would advertise a
 * price the checkout no longer charges - the exact disagreement hypershape S19 forbids.
 * With no DATABASE_URL at all it keeps the file on disk and says so.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const OUT = path.resolve('content/catalog.json');
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!url) {
  if (!existsSync(OUT)) {
    console.error('[catalog] no DATABASE_URL and no content/catalog.json - nothing to build pages from');
    process.exit(1);
  }
  const cur = JSON.parse(readFileSync(OUT, 'utf8'));
  console.log(`[catalog] no DATABASE_URL - keeping content/catalog.json pulled ${cur.pulled_at}`);
  process.exit(0);
}

// Only what a public page may show. No customer, lead, session or team row is read here.
const PUBLIC_SETTINGS = [
  'business.name', 'business.phone', 'business.email', 'business.region_label', 'business.brand_region', 'business.timezone',
  'pricing.quote_required_message', 'pricing.currency',
  'schedule.service_days', 'schedule.day_start', 'schedule.day_end', 'schedule.new_customer_start_days',
  'schedule.visit_window_hours', 'schedule.day_capacity',
  'booking.start_window_days', 'booking.initial_cleanup_policy', 'booking.card_required',
  'billing.monthly_factor', 'billing.package_prices_confirmed',
  'subscription.cancel_notice_hours', 'subscription.pause_max_weeks', 'visit.skip_charge_policy',
  'visit.require_completion_photo', 'service_area.outside_area_behaviour',
  'reviews.google_rating', 'reviews.google_count', 'reviews.google_profile_url',
  'trust.insured_confirmed', 'trust.background_checked_confirmed', 'trust.guarantee_text',
  'growth.careers_enabled', 'growth.commercial_enabled',
];

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
let catalog;
try {
  await c.connect();
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  // Sequential on purpose: one pg client runs one query at a time (pg 9 removes queueing).
  const services = await     q(`select slug, name, short_name, kind, price_basis, basis_label, pricing_note, sort_order,
              meta_title, meta_description, h1, intro, what_includes, who_its_for, faqs, related_slugs
         from services where status = 'active' order by sort_order`);
  const tiers = await q(`select id, service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote,
              price_is_from, sort_order
         from service_tiers order by service_slug, sort_order`);
  const packages = await q(`select id, slug, service_slug, tier_id, name, short_label, frequency, visits_per_month::float as visits_per_month,
              monthly_price_cents, derivation, source, version, featured, sort_order
         from packages where status = 'active' order by sort_order`);
  const offers = await q(`select id, name, description, kind, value, applies_to_slugs, requires_slugs, status
         from offers where status = 'active' order by name`);
  const areas = await q(`select slug, name, county, state, tier, bookable, market, market_label, neighborhoods, nearby_slugs,
              service_weekdays, meta_title, meta_description, intro, local_context, faqs, sort_order
         from service_areas where status = 'active' order by sort_order`);
  const reviews = await q(`select id, author_name, author_badge, quote, rating, source, source_url, reviewed_on, featured, sort_order
         from reviews order by sort_order`);
  const settings = await q(`select key, value from settings where key = any($1::text[])`, [PUBLIC_SETTINGS]);
  catalog = {
    pulled_at: new Date().toISOString(),
    source: 'database',
    services, tiers, packages, offers, areas, reviews,
    settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
  };
} catch (e) {
  console.error(`[catalog] FAILED to read the catalog: ${e.message}`);
  console.error('[catalog] refusing to build from a stale file: a page and the checkout would disagree on price.');
  try { await c.end(); } catch {}
  process.exit(1);
}
await c.end();

writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`[catalog] ${catalog.services.length} services, ${catalog.tiers.length} tiers, ${catalog.packages.length} packages, ` +
  `${catalog.offers.length} offers, ${catalog.areas.length} areas, ${catalog.reviews.length} reviews -> content/catalog.json`);
