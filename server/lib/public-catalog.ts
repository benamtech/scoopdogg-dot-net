/**
 * The catalog AS THE PUBLIC PAGES SEE IT, read from the rows on every render.
 *
 * THE RULE (Ben, restated 2026-09-27 after the build broke it): anything Josue edits in his admin
 * is live on the public site in seconds, with no rebuild and no publish button. Until 2026-09-29
 * every page imported content/catalog.json, written at build by scripts/pull-catalog.mjs, so a
 * price, an offer or a trust claim reached the pages only through a deploy.
 *
 * Now src/middleware.ts calls `loadPublicSnapshot()` before a page renders and hands the result to
 * src/lib/catalog.ts and src/lib/demo.ts. The rendered HTML is held at Vercel's CDN under the tag
 * SITE_CACHE_TAG and every admin write purges that tag (server/lib/site-cache.ts), so a visitor
 * gets cached bytes and the next render after a save reads the new rows. Crawlers still get the
 * values in the HTML: nothing here is client-side.
 *
 * ONLY WHAT A PUBLIC PAGE MAY SHOW. No customer, lead, session or team row is read, and settings
 * come from an allowlist. scripts/pull-catalog.mjs keeps its own SQL on purpose: it is the gates'
 * independent read of the rows, and a verifier that shares the producer's code agrees with it,
 * wrong and all.
 */
import { db } from './db.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Settings a public page may read. gates/settings-have-readers.mjs resolves every page's
 *  `setting()` call against this list: a key a page reads and this list omits is a feature that
 *  silently does not exist. */
export const PUBLIC_SETTINGS = [
  'business.name', 'business.phone', 'business.email', 'business.region_label', 'business.brand_region', 'business.timezone',
  'pricing.quote_required_message', 'pricing.currency',
  'google.site_verification',
  'quote.reply_promise', 'quote.typical_range', 'quote.photos_max', 'business.license_number', 'business.license_class',
  'schedule.service_days', 'schedule.day_start', 'schedule.day_end', 'schedule.new_customer_start_days',
  'schedule.visit_window_hours', 'schedule.day_capacity',
  'booking.start_window_days', 'booking.initial_cleanup_policy', 'booking.card_required',
  'booking.lanes_enabled', 'booking.payafter_charge_offset_days', 'booking.onetime_enabled',
  'growth.review_request_after_visits',
  'billing.monthly_factor', 'billing.package_prices_confirmed',
  'subscription.cancel_notice_hours', 'subscription.pause_max_weeks', 'subscription.auto_resume_after_pause', 'visit.skip_charge_policy',
  'visit.require_completion_photo', 'service_area.outside_area_behaviour',
  'reviews.google_rating', 'reviews.google_count', 'reviews.google_profile_url', 'reviews.google_checked_on',
  'trust.insured_confirmed', 'trust.background_checked_confirmed', 'trust.guarantee_text',
  'growth.careers_enabled', 'growth.commercial_enabled',
  'analytics.measurement_id', 'business.service_region', 'business.region_sentence',
];

export type PublicSnapshot = {
  pulled_at: string;
  source: string;
  services: any[]; retired_service_slugs: string[]; tiers: any[]; packages: any[]; offers: any[]; areas: any[]; reviews: any[];
  postal_codes: Record<string, string>;
  settings: Record<string, unknown>;
  demo: { mode: boolean; banner_text: string; source: string; pulled_at: string | null };
};

export class SnapshotError extends Error {}

export async function loadPublicSnapshot(q: Queryable = db()): Promise<PublicSnapshot> {
  const rows = async (sql: string, params?: unknown[]) => (await q.query(sql, params)).rows;
  // Parallel is safe here: db() is a pool, unlike the single client pull-catalog.mjs uses.
  const [services, retired, tiers, packages, offers, areas, reviews, postal, settings, demo] = await Promise.all([
    rows(`select slug, name, short_name, kind, price_basis, basis_label, pricing_note, sort_order,
                 meta_title, meta_description, h1, intro, what_includes, who_its_for, faqs, related_slugs
            from services where status = 'active' order by sort_order`),
    // A retired service's URL redirects to /services rather than answering 404 (migration 003:
    // "a retired service must keep resolving because old ... URLs still point at its slug").
    rows(`select slug from services where status = 'retired'`),
    rows(`select id, service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote,
                 price_is_from, est_minutes, sort_order, covers_last_cleaned
            from service_tiers where status = 'active' order by service_slug, sort_order`),
    rows(`select id, slug, service_slug, tier_id, name, short_label, frequency, visits_per_month::float as visits_per_month,
                 monthly_price_cents, derivation, source, confirmed_at, badge, version, featured, sort_order
            from packages where status = 'active' order by sort_order`),
    rows(`select id, name, description, kind, value, applies_to_slugs, requires_slugs, status
            from offers where status = 'active' order by name`),
    rows(`select slug, name, county, state, tier, bookable, market, market_label, neighborhoods, nearby_slugs,
                 service_weekdays, meta_title, meta_description, intro, local_context, faqs, sort_order
            from service_areas where status = 'active' order by sort_order`),
    rows(`select id, author_name, author_badge, quote, rating, source, source_url, reviewed_on, featured, sort_order
            from reviews order by sort_order`),
    rows(`select z.postal_code, z.area_slug from area_postal_codes z
            join service_areas a on a.slug = z.area_slug
           where a.bookable and a.status = 'active' order by z.postal_code`),
    rows(`select key, value from settings where key = any($1::text[])`, [PUBLIC_SETTINGS]),
    rows(`select key, value from settings where key in ('demo.mode', 'demo.banner_text')`),
  ]);
  const d = new Map(demo.map((r: any) => [r.key, r.value]));
  // A Vercel Preview environment forces demo mode (SD_FORCE_DEMO=1) so a preview can never take a
  // live payment or mail a real inbox, and it must SAY so on every page.
  const mode = process.env.SD_FORCE_DEMO === '1' || d.get('demo.mode') === true;
  const banner = typeof d.get('demo.banner_text') === 'string' ? (d.get('demo.banner_text') as string) : '';
  // A mode you cannot see from the screen is a mode that ships. Refuse rather than render a demo
  // page that looks live.
  if (mode && !banner) throw new SnapshotError('demo.mode is on and demo.banner_text is empty');
  const now = new Date().toISOString();
  return {
    pulled_at: now,
    source: 'database',
    services, retired_service_slugs: retired.map((r: any) => r.slug), tiers, packages, offers, areas, reviews,
    postal_codes: Object.fromEntries(postal.map((r: any) => [r.postal_code, r.area_slug])),
    settings: Object.fromEntries(settings.map((r: any) => [r.key, r.value])),
    demo: { mode, banner_text: mode ? banner : '', source: 'database', pulled_at: now },
  };
}
