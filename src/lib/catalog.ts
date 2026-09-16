/**
 * The catalog, as every built page sees it: content/catalog.json, written from the database
 * by scripts/pull-catalog.mjs as build step one. Pages never import src/lib/services.ts or
 * cities.ts for a price or a city list any more - that was the second copy the admin could
 * not edit.
 */
import raw from '../../content/catalog.json';
import type { Catalog, Service, Tier, Package, Offer } from '../shared/pricing';
import { lowestMonthly, packagesFor, formatCents, formatTierPrice } from '../shared/pricing';

export type Faq = { q: string; a: string };

export type CatalogService = Service & {
  pricing_note: string;
  sort_order: number;
  meta_title: string | null;
  meta_description: string | null;
  h1: string | null;
  intro: string | null;
  what_includes: string[];
  who_its_for: string;
  faqs: Faq[];
  related_slugs: string[];
};

export type Area = {
  slug: string;
  name: string;
  county: string | null;
  state: string | null;
  tier: number;
  bookable: boolean;
  market: string;
  market_label: string;
  neighborhoods: string[];
  nearby_slugs: string[];
  service_weekdays: number[];
  meta_title: string | null;
  meta_description: string | null;
  intro: string | null;
  local_context: string | null;
  faqs: Faq[];
  sort_order: number;
};

export type Review = {
  id: string;
  author_name: string;
  author_badge: string | null;
  quote: string;
  rating: number | null;
  source: string;
  source_url: string | null;
  reviewed_on: string | null;
  featured: boolean;
  sort_order: number;
};

type Raw = {
  pulled_at: string;
  services: CatalogService[];
  tiers: Tier[];
  packages: Package[];
  offers: Offer[];
  areas: Area[];
  reviews: Review[];
  settings: Record<string, unknown>;
};

const data = raw as unknown as Raw;

export const catalog: Catalog = {
  services: data.services,
  tiers: data.tiers,
  packages: data.packages,
  offers: data.offers,
};

export const services = data.services;
export const areas = data.areas;
export const reviews = data.reviews;
export const tiers = data.tiers;
export const packages = data.packages;
export const offers = data.offers;
export const pulledAt = data.pulled_at;

export function setting<T>(key: string, fallback: T): T {
  const v = data.settings[key];
  return (v === undefined || v === null ? fallback : (v as T));
}

export const business = {
  name: setting('business.name', 'Scoop Dogg'),
  phone: setting('business.phone', '(805) 869-8070'),
  phoneHref: `tel:${setting('business.phone', '(805) 869-8070').replace(/[^\d]/g, '')}`,
  email: setting('business.email', 'josue@scoopdogg.net'),
};

export const serviceBySlug = (slug: string) => data.services.find((s) => s.slug === slug);
export const areaBySlug = (slug: string) => data.areas.find((a) => a.slug === slug);
export const tiersFor = (slug: string) => data.tiers.filter((t) => t.service_slug === slug).sort((a, b) => a.sort_order - b.sort_order);
export const packagesForService = (slug: string) => packagesFor(catalog, slug);

/**
 * Ben, 2026-09-16: "dont limit it to ventura county in the copy. they serve Ventura and Santa
 * Barbara counties, as well as all the other specific service areas already listed." So the
 * headline region is two counties, and the market groups name Santa Barbara County outright.
 * Database labels win when present; these are the display defaults.
 */
const MARKET_LABELS: Record<string, string> = {
  'ventura-county': 'Ventura County',
  'conejo-valley': 'the Conejo Valley',
  'south-coast': 'Santa Barbara County',
  'malibu-coast': 'Malibu',
};

/** The market groups, in the order a visitor reads them. */
export function markets(): { market: string; label: string; areas: Area[] }[] {
  const order = ['ventura-county', 'conejo-valley', 'south-coast', 'malibu-coast'];
  const byMarket = new Map<string, Area[]>();
  for (const a of data.areas) byMarket.set(a.market, [...(byMarket.get(a.market) ?? []), a]);
  return [...byMarket.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([market, list]) => ({
      market,
      label: MARKET_LABELS[market] ?? list[0]?.market_label ?? market,
      areas: list.sort((x, y) => x.sort_order - y.sort_order),
    }));
}

/** The short region for headlines. */
export const serviceRegion = setting<string>('business.service_region', 'Ventura and Santa Barbara counties');

/** The full sentence: two counties, then the places people name that sit outside or across them. */
export function regionSentence(): string {
  return setting<string>('business.region_sentence', `${serviceRegion}, including Malibu and the Conejo Valley`);
}

/** How a service's price reads on a card: the monthly package when one exists, else the tier. */
export function headlinePrice(slug: string): { text: string; per: string; derived: boolean } | null {
  const pkg = lowestMonthly(catalog, slug);
  if (pkg) return { text: formatCents(pkg.monthly_price_cents), per: '/month', derived: pkg.source === 'derived_from_published' };
  const priced = tiersFor(slug).filter((t) => t.price_cents !== null && !t.requires_quote);
  if (!priced.length) return null;
  const low = priced.sort((a, b) => (a.price_cents ?? 0) - (b.price_cents ?? 0))[0];
  return { text: `From ${formatCents(low.price_cents!)}`, per: low.price_suffix || '', derived: false };
}

export { formatCents, formatTierPrice };

/**
 * Conversion-first defaults (Ben, 2026-09-16: "an amazing, impressive, high-conversion
 * website experience that will be very profitable"). Each default below is either Josue's
 * own published claim from the pre-elevation site or a market-standard offer from R5, and
 * every one is overridden the moment its setting exists in the database. The list of
 * assumptions for Ben to veto is in portal/P13-THE-EXPERIENCE.md §6.
 */
export const reviewSummary = {
  count: data.reviews.length,
  googleCount: setting<number | null>('reviews.google_count', null),
  // Published on the pre-elevation site as "5.0 average" and "5-Star Rated".
  rating: setting<number | null>('reviews.google_rating', 5.0),
  profileUrl: setting<string>('reviews.google_profile_url', 'https://share.google/nt1A1k6dxX8r6KWni'),
};

export const trust = {
  // Both published on the pre-elevation site (AboutTrust, CityPage).
  insured: setting<boolean>('trust.insured_confirmed', true),
  backgroundChecked: setting<boolean>('trust.background_checked_confirmed', true),
  // Market standard: 82% of scoopers carry a satisfaction guarantee (R5 §4).
  guarantee: setting<string | null>(
    'trust.guarantee_text',
    'Happy-yard guarantee: if we miss a spot, tell us within 24 hours and we come back and make it right, free.',
  ),
};

export const growth = {
  careers: setting<boolean>('growth.careers_enabled', true),
  commercial: setting<boolean>('growth.commercial_enabled', true),
  // Referrals removed by Ben, 2026-09-16 ("get rid of the referrals").
};
