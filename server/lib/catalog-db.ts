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
  /**
   * `covers_last_cleaned` IS NOT OPTIONAL HERE, and leaving it out was a live money defect for as
   * long as migration 026 has existed. `catchUpFor()` (src/shared/pricing.ts) matches a catch-up
   * tier on this column and nothing else — deliberately, because "matching the label text or the
   * sort order would break silently the first time somebody edits a tier in the admin". Omit the
   * column and the match cannot succeed: catchUpFor returned {kind:'none'} for every answer
   * INCLUDING 'longer', so booking.ts never raised catch_up_missing, needsFirstVisitQuote was
   * always false, and a yard six weeks behind was charged the weekly price and booked without
   * Josue seeing it. account.ts's catchUpForPause had the same hole, so a twelve-week pause
   * resumed free.
   *
   * IT WAS INVISIBLE TO BOTH GATES because they read content/catalog.json, which pull-catalog.mjs
   * DOES select the column into — a verifier observing the producer from a different path agrees
   * with it, wrong and all. gates/catch-up-priced.mjs now calls this function instead.
   */
  const tiers = await q<Catalog['tiers'][number]>(`select id, service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, est_minutes, covers_last_cleaned, sort_order from service_tiers order by service_slug, sort_order`);
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
