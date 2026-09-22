/**
 * The catalog as the SERVER reads it: straight from the database, never from the browser.
 * The booking API re-prices every request with src/shared/pricing.ts over these rows, so a
 * page built from content/catalog.json and a checkout priced from here agree by construction
 * (S19), and a tampered request cannot change what Stripe charges.
 */
import { db } from './db.js';
import type { Catalog } from '../../src/shared/pricing.js';

export type AreaRow = { slug: string; name: string; bookable: boolean; market: string; service_weekdays: number[] };

export async function loadCatalog(): Promise<Catalog & { areas: AreaRow[]; settings: Map<string, unknown> }> {
  const q = async <T>(sql: string, params: unknown[] = []) => (await db().query(sql, params)).rows as T[];
  const services = await q<Catalog['services'][number]>(`select slug, name, short_name, kind, price_basis, basis_label from services where status = 'active' order by sort_order`);
  const tiers = await q<Catalog['tiers'][number]>(`select id, service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, est_minutes, sort_order from service_tiers order by service_slug, sort_order`);
  const packages = await q<Catalog['packages'][number]>(`select id, slug, service_slug, tier_id, name, short_label, frequency, visits_per_month::float as visits_per_month, monthly_price_cents, derivation, source, version, featured, sort_order from packages where status = 'active' order by sort_order`);
  const offers = await q<Catalog['offers'][number]>(`select id, name, kind, value, applies_to_slugs, requires_slugs, status from offers where status = 'active'`);
  const areas = await q<AreaRow>(`select slug, name, bookable, market, service_weekdays from service_areas where status = 'active' order by sort_order`);
  // A FILTER IS A SILENT ALLOWLIST. `subscription.%` and `visit.%` were missing until
  // 2026-09-19, so every server read of `subscription.pause_max_weeks` or
  // `subscription.auto_resume_after_pause` returned undefined and fell back to a
  // literal: the read compiles, the key exists in the database, and the value never
  // arrives. gates/settings-have-readers.mjs checks every key the server asks for
  // against this line.
  // `growth.%` and `reviews.%` joined it in step 9, for the same reason and before the same
  // mistake: server/lib/comms.ts reads `growth.review_request_after_visits` (the threshold for
  // the review request, a row with no reader since migration 018) and
  // `reviews.google_profile_url` (the link it sends). Adding the read without adding the
  // prefix would have made the sweep silently find nothing and report zero eligible.
  const rows = await q<{ key: string; value: unknown }>(`select key, value from settings where key like 'schedule.%' or key like 'booking.%' or key like 'business.%' or key like 'billing.%' or key like 'notify.%' or key like 'subscription.%' or key like 'visit.%' or key like 'growth.%' or key like 'reviews.%'`);
  return { services, tiers, packages, offers, areas, settings: new Map(rows.map((r) => [r.key, r.value])) };
}
