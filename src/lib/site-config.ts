/**
 * Build-shape decisions that are not settings Josue edits, but are not code either.
 * One word changes each. Every default here is argued from a measurement.
 */

/**
 * Whether to emit the 176 city x service pages (16 cities x 11 services).
 *
 *   'all'    — every combination. What the old react-snap config intended.
 *   'demand' — only cities that have produced a real lead. 7 cities, 77 pages.
 *   'none'   — no city x service pages. 42 pages total, all of them distinct.
 *
 * DEFAULT 'none', and the reason is measured, not stylistic. With each page's own city
 * and service nouns removed, the share of its words that its SIBLINGS also carry is:
 *
 *   service pages   6%  (median)   <- genuinely distinct. Ship these.
 *   article pages   4%             <- genuinely distinct. Ship these.
 *   city pages     70%             <- borderline, but each has real local content
 *   city x service 80%             <- one page with the nouns swapped, 176 times
 *
 * 80% is the doorway-page pattern. It matters more than usual here because those URLs
 * have never carried content — the live site serves an empty shell for all of them — so
 * turning on 176 near-duplicates in a single deploy is a much larger change than it
 * looks, on a domain that has nothing indexed to absorb it.
 *
 * The 42 pages we do ship cover the same keywords with content that stands up. Let them
 * index, then expand deliberately. Switching to 'demand' or 'all' is one word here.
 */
export const CITY_SERVICE_PAGES: 'all' | 'demand' | 'none' = 'none';

/**
 * Cities that have produced at least one real lead, from the 24 migrated leads.
 * Measured 2026-09-10 — and it disagrees with the hand-assigned tiers in cities.ts:
 * Santa Paula is tier 2 with 3 leads, while tier-1 Santa Barbara and Carpinteria have
 * none. Demand is the better signal and it is the one used here.
 */
export const CITIES_WITH_DEMAND = [
  'ventura',        // 12 leads
  'oxnard',         // 3
  'santa-paula',    // 3
  'camarillo',      // 2
  'ojai',           // 2
  'simi-valley',    // 1
  'westlake-village', // 1
];
