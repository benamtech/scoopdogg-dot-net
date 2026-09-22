/**
 * THE price resolver. One module, imported by the page build, the booking island, the
 * booking API and the admin - so the price on a page, the price in the checkout summary
 * and the amount Stripe charges cannot disagree (hypershape S19: one price, four places).
 *
 * Pure: no database, no network, no Date. Everything it needs is passed in, which is what
 * lets the server re-run it on rows it read itself and refuse a browser that sent a
 * different total.
 *
 * Rules carried from the plan set, each of which has already bitten once:
 *  - A "from" price is a floor, never a final number (service_tiers.price_is_from).
 *  - price_basis 'choice' never asks for a quantity; the customer picks the tier.
 *  - A tier with requires_quote has no price; it becomes a quote request, not a checkout.
 */

export type PriceBasis = 'dogs' | 'sqft' | 'boxes' | 'units' | 'levels' | 'choice' | 'flat';

export type Service = {
  slug: string;
  name: string;
  short_name?: string;
  kind: 'recurring' | 'one_time' | 'addon';
  price_basis: PriceBasis | null;
  basis_label: string;
};

export type Tier = {
  id: string;
  service_slug: string;
  label: string;
  min_qty: number | null;
  max_qty: number | null;
  price_cents: number | null;
  price_suffix: string;
  requires_quote: boolean;
  price_is_from: boolean;
  sort_order: number;
  /**
   * Which answers to "When was the yard last cleaned?" this catch-up tier covers
   * (migration 026). NULL on every tier that is not a catch-up.
   */
  covers_last_cleaned?: string[] | null;
  /**
   * How long the work takes, in minutes. Josue's own number, on the row since migration 003.
   *
   * It had no reader until `server/lib/density.ts`, which compares it against the DRIVING a stop
   * costs — the comparison that turns route density from a feeling into a ranking. Optional here
   * because `src/shared` is shared with the browser and the booking island does not select it.
   */
  est_minutes?: number | null;
};

export type Package = {
  id: string;
  slug: string;
  service_slug: string;
  tier_id: string | null;
  name: string;
  short_label: string;
  frequency: 'twice_weekly' | 'weekly' | 'biweekly' | 'monthly';
  visits_per_month: number;
  monthly_price_cents: number;
  derivation: string;
  source: 'derived_from_published' | 'confirmed';
  version: number;
  featured: boolean;
  sort_order: number;
};

export type Offer = {
  id: string;
  name: string;
  kind: 'percent_off' | 'amount_off' | 'free_visits';
  value: number;
  applies_to_slugs: string[];
  requires_slugs: string[];
  status: string;
};

export type Catalog = {
  services: Service[];
  tiers: Tier[];
  packages: Package[];
  offers: Offer[];
};

/** A qty lands in a tier when min <= qty and (max is null or qty < max) - except for
 *  count bases (dogs, boxes, units, levels) where max is INCLUSIVE, because "1 dog" is
 *  min 1 max 1 and "1-2 levels" is min 1 max 2. Area bases (sqft) publish "under 200" and
 *  "200-500", so the boundary belongs to the upper tier. */
export function tierForQuantity(service: Service, tiers: Tier[], qty: number): Tier | null {
  const own = tiers.filter((t) => t.service_slug === service.slug).sort((a, b) => a.sort_order - b.sort_order);
  const inclusiveMax = service.price_basis !== 'sqft';
  const ranged = own.filter((t) => t.min_qty !== null || t.max_qty !== null);
  for (const t of ranged) {
    const aboveMin = t.min_qty === null || qty >= t.min_qty;
    const belowMax = t.max_qty === null || (inclusiveMax ? qty <= t.max_qty : qty < t.max_qty);
    if (aboveMin && belowMax) return t;
  }
  // Nothing ranged matched (e.g. "Multiple trees" has no bounds): the unbounded quote tier.
  return own.find((t) => t.requires_quote && t.min_qty === null && t.max_qty === null) ?? null;
}

export type TierPrice =
  | { kind: 'price'; cents: number; suffix: string }
  | { kind: 'from'; cents: number; suffix: string }
  | { kind: 'quote' };

export function tierPrice(t: Tier): TierPrice {
  if (t.requires_quote || t.price_cents === null) return { kind: 'quote' };
  return { kind: t.price_is_from ? 'from' : 'price', cents: t.price_cents, suffix: t.price_suffix };
}

export function formatCents(cents: number, { forceDecimals = false } = {}): string {
  const whole = cents % 100 === 0 && !forceDecimals;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "From $40/visit" is how a floor must always read. Never "$40/visit". */
export function formatTierPrice(t: Tier, quoteText = 'Custom quote'): string {
  const p = tierPrice(t);
  if (p.kind === 'quote') return quoteText;
  const s = `${formatCents(p.cents)}${p.suffix}`;
  return p.kind === 'from' ? `From ${s}` : s;
}

export function packagesFor(catalog: Catalog, serviceSlug: string): Package[] {
  return catalog.packages.filter((p) => p.service_slug === serviceSlug).sort((a, b) => a.sort_order - b.sort_order);
}

export function packageForTier(catalog: Catalog, tierId: string): Package | null {
  return catalog.packages.find((p) => p.tier_id === tierId) ?? null;
}

/** The cheapest monthly package of a service, for "from $65/month" on cards. */
export function lowestMonthly(catalog: Catalog, serviceSlug: string): Package | null {
  return packagesFor(catalog, serviceSlug).sort((a, b) => a.monthly_price_cents - b.monthly_price_cents)[0] ?? null;
}

// ---------------------------------------------------------------------------------------
// A booking: one monthly package, plus optional one-time extras charged on the first
// invoice, plus the published offers that apply.
// ---------------------------------------------------------------------------------------

export type BookingInput = {
  packageId: string;
  /** Tier ids of one-time services added to the first visit. */
  extraTierIds?: string[];
  /** Other package ids in the same booking, for "when combined with" offers. */
  withPackageIds?: string[];
};

export type QuoteLine = {
  kind: 'package' | 'extra' | 'discount';
  label: string;
  cents: number;
  recurring: boolean;
  ref: string;
};

export type Quote = {
  ok: true;
  package: Package;
  lines: QuoteLine[];
  monthlyCents: number;
  firstChargeCents: number;
  extrasCents: number;
  discountCents: number;
  appliedOffers: { id: string; name: string; percent_off: number; cents: number; service_slug: string }[];
  flags: { priceIsDerived: boolean; containsFromPrice: boolean };
} | { ok: false; reason: 'unknown_package' | 'extra_requires_quote' | 'unknown_extra' };

export function offersFor(catalog: Catalog, serviceSlug: string, bookedServiceSlugs: string[]): Offer[] {
  return catalog.offers.filter((o) =>
    o.status === 'active' &&
    o.kind === 'percent_off' &&
    (o.applies_to_slugs.length === 0 || o.applies_to_slugs.includes(serviceSlug)) &&
    o.requires_slugs.every((r) => bookedServiceSlugs.includes(r)));
}

export function quoteBooking(catalog: Catalog, input: BookingInput): Quote {
  const pkg = catalog.packages.find((p) => p.id === input.packageId);
  if (!pkg) return { ok: false, reason: 'unknown_package' };
  const tier = pkg.tier_id ? catalog.tiers.find((t) => t.id === pkg.tier_id) : undefined;
  const others = (input.withPackageIds ?? []).map((id) => catalog.packages.find((p) => p.id === id)).filter(Boolean) as Package[];
  const booked = [pkg.service_slug, ...others.map((p) => p.service_slug)];

  const lines: QuoteLine[] = [{
    kind: 'package', label: pkg.name, cents: pkg.monthly_price_cents, recurring: true, ref: pkg.id,
  }];

  let extrasCents = 0;
  for (const id of input.extraTierIds ?? []) {
    const t = catalog.tiers.find((x) => x.id === id);
    if (!t) return { ok: false, reason: 'unknown_extra' };
    const p = tierPrice(t);
    if (p.kind === 'quote') return { ok: false, reason: 'extra_requires_quote' };
    const svc = catalog.services.find((s) => s.slug === t.service_slug);
    lines.push({ kind: 'extra', label: `${svc?.name ?? t.service_slug} · ${t.label}`, cents: p.cents, recurring: false, ref: t.id });
    extrasCents += p.cents;
  }

  // One offer per package line, the best one. Offers discount the package's FIRST month
  // only - never the one-time extras, which the site never said were discounted.
  const applied: Extract<Quote, { ok: true }>['appliedOffers'] = [];
  const best = offersFor(catalog, pkg.service_slug, booked).sort((a, b) => b.value - a.value)[0];
  let discountCents = 0;
  if (best) {
    const cents = Math.round((pkg.monthly_price_cents * best.value) / 100);
    discountCents += cents;
    applied.push({ id: best.id, name: best.name, percent_off: best.value, cents, service_slug: pkg.service_slug });
    lines.push({ kind: 'discount', label: best.name, cents: -cents, recurring: false, ref: best.id });
  }

  return {
    ok: true,
    package: pkg,
    lines,
    monthlyCents: pkg.monthly_price_cents,
    firstChargeCents: pkg.monthly_price_cents - discountCents + extrasCents,
    extrasCents,
    discountCents,
    appliedOffers: applied,
    flags: {
      priceIsDerived: pkg.source === 'derived_from_published',
      containsFromPrice: Boolean(tier?.price_is_from),
    },
  };
}

/**
 * THE CATCH-UP CHARGE. Josue, 2026-09-19: "when yard has not been cleaned longer than a couple
 * weeks it would increase price because the default price is based on having a weekly clean."
 *
 * The weekly price is priced off a weekly yard. A first visit to a yard with six weeks on it is
 * a different job, and until now the funnel offered the catch-up as a free choice with a "No
 * thanks, just weekly" button beside it — so the customer could decline the extra work and pay
 * the weekly price for it.
 *
 * The mapping is a ROW, not a heuristic: `service_tiers.covers_last_cleaned`. These tiers have
 * no min_qty or max_qty to match on, and matching the label text or the sort order would break
 * silently the first time somebody edits a tier in the admin.
 *
 * `two_weeks` maps to a tier that is NOT charged on a weekly plan, because Josue said "longer
 * than a couple weeks" and two weeks is a couple of weeks. Reading his sentence harder than he
 * wrote it would be inventing a policy and charging real customers for it.
 */
export type CatchUp =
  /** Nothing owed: the yard is inside the cadence the weekly price assumes. */
  | { kind: 'none' }
  /** A priced catch-up, added to the first charge. `band` is the human phrase for how far
   *  behind the yard is ("3-6 weeks"), taken from the tier's own label. */
  | { kind: 'charge'; tier: Tier; cents: number; band: string }
  /** Josue's own ladder says this one needs his eyes. No card is taken. */
  | { kind: 'quote'; tier: Tier };

/**
 * THE LADDER, DECLARED ONCE. The four answers to "When was the yard last cleaned?", in order,
 * each with the number of weeks it tops out at.
 *
 * It lived in `BookingFlow.tsx` until 2026-09-19 and the week boundaries lived only inside the
 * question's own labels, which meant nothing but a person could read them. They are needed in a
 * second place now — a plan that has been PAUSED knows how many weeks it was paused for and has
 * no answer to map, so it has to turn weeks back into a band.
 *
 * The prices stay in the rows (`service_tiers.covers_last_cleaned`, migration 026). This is the
 * question, not the price; `gates/catch-up-priced.mjs` asserts the two agree.
 */
export const LAST_CLEANED = [
  { key: 'this_week', label: 'This week', upToWeeks: 1 },
  { key: 'two_weeks', label: '1\u20132 weeks ago', upToWeeks: 2 },
  { key: 'month', label: '3\u20136 weeks ago', upToWeeks: 6 },
  { key: 'longer', label: 'Longer than that', upToWeeks: Infinity },
] as const;

export type LastCleaned = (typeof LAST_CLEANED)[number]['key'];

/**
 * A gap in weeks -> the answer a customer would have given. Used by the pause and resume path,
 * where nobody is answering a question: the system knows the yard went N weeks without a visit
 * and owes the same money it would have owed if the customer had typed it at booking.
 */
export function lastCleanedForWeeks(weeks: number): LastCleaned {
  const w = Math.max(0, weeks);
  return (LAST_CLEANED.find((b) => w <= b.upToWeeks) ?? LAST_CLEANED[LAST_CLEANED.length - 1]).key;
}

/**
 * What a yard that has gone `weeks` without a visit owes on the visit that comes next.
 *
 * THIS IS THE SECOND DOOR ON JOSUE'S RULE. The first is `catchUpFor` at booking. A customer who
 * books with a clean yard and then pauses the plan for four weeks arrives at exactly the state
 * the catch-up ladder exists for, and until 2026-09-19 paid nothing for it — while the account
 * screen offered "Pause 4 weeks instead" as the save offer when they tried to cancel. Same rule,
 * same rows, same numbers; the only difference is that the gap is measured rather than asked.
 */
export function catchUpForWeeks(catalog: Catalog, serviceSlug: string, weeks: number): CatchUp {
  return catchUpFor(catalog, serviceSlug, lastCleanedForWeeks(weeks));
}

export function catchUpFor(catalog: Catalog, serviceSlug: string, lastCleaned: string | null | undefined): CatchUp {
  // Only a recurring plan can be "behind". A one-time job IS the catch-up.
  if (serviceSlug !== 'weekly-pooper-scooper-service' || !lastCleaned) return { kind: 'none' };
  const tier = catalog.tiers.find((t) => (t.covers_last_cleaned ?? []).includes(lastCleaned));
  if (!tier) return { kind: 'none' };
  // Inside the cadence: the tier exists so the ladder is complete, but nothing is owed.
  if (lastCleaned === 'this_week' || lastCleaned === 'two_weeks') return { kind: 'none' };
  const p = tierPrice(tier);
  if (p.kind === 'quote') return { kind: 'quote', tier };
  // "Heavy buildup (3-6 weeks)" -> "3-6 weeks". Done here rather than in the component so the
  // component holds no string surgery, and so `gates/no-price-in-prose.mjs` is not reading a
  // regex replacement token as a typed price — which it did, correctly, on the first attempt.
  const open = tier.label.lastIndexOf('(');
  const close = tier.label.lastIndexOf(')');
  const band = open > -1 && close > open ? tier.label.slice(open + 1, close).toLowerCase() : tier.label.toLowerCase();
  return { kind: 'charge', tier, cents: p.cents, band };
}

// ---------------------------------------------------------------------------------------
// One-time work (P16 §3). Eleven services, three shapes: a recurring plan is a package, a
// one-time job is a TIER with a price, and anything priced "from" or custom is a quote.
//
// A one-time job is still a `subscriptions` row - frequency 'one_time', one visit - because
// scheduling, proof and the customer's account all already work on that row. What it is NOT is a
// second pricing path: the same tier rows the service pages read are the ones charged, and
// `requires_quote` or a "from" price sends the customer to the request lane rather than to a
// checkout that would quote a number nobody stands behind.
// ---------------------------------------------------------------------------------------

export type OneTimeQuote =
  | { ok: true; service: Service; tier: Tier; cents: number; label: string }
  | { ok: false; reason: 'unknown_tier' | 'requires_quote' | 'from_price' };

export function quoteOneTime(catalog: Catalog, tierId: string): OneTimeQuote {
  const tier = catalog.tiers.find((t) => t.id === tierId);
  if (!tier) return { ok: false, reason: 'unknown_tier' };
  const service = catalog.services.find((s) => s.slug === tier.service_slug);
  if (!service) return { ok: false, reason: 'unknown_tier' };
  const p = tierPrice(tier);
  if (p.kind === 'quote') return { ok: false, reason: 'requires_quote' };
  // A floor presented as a final number is the one thing gates/from-price-never-final.mjs exists
  // to stop, and a checkout is the most final a number ever gets.
  if (p.kind === 'from') return { ok: false, reason: 'from_price' };
  return { ok: true, service, tier, cents: p.cents, label: `${service.name} · ${tier.label}` };
}

/** Every service that can be booked, in the shape it books in. The funnel renders from this. */
export function bookableServices(catalog: Catalog): Array<{
  service: Service; shape: 'recurring' | 'one_time' | 'quote'; fromCents: number | null;
}> {
  return catalog.services.map((service) => {
    const packages = packagesFor(catalog, service.slug);
    if (packages.length) {
      return { service, shape: 'recurring' as const, fromCents: Math.min(...packages.map((p) => p.monthly_price_cents)) };
    }
    const priced = catalog.tiers.filter((t) => t.service_slug === service.slug && tierPrice(t).kind === 'price');
    if (priced.length) {
      return { service, shape: 'one_time' as const, fromCents: Math.min(...priced.map((t) => t.price_cents as number)) };
    }
    return { service, shape: 'quote' as const, fromCents: null };
  });
}

// ---------------------------------------------------------------------------------------
// Service days (portal/P6): a city is served on named weekdays. Empty = no route yet, so
// every day in schedule.service_days is offered rather than refusing a booking.
// ---------------------------------------------------------------------------------------

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayName = (d: number) => WEEKDAY[d] ?? '';

/**
 * The next start dates a customer may pick. `today` is an ISO date (YYYY-MM-DD) in the
 * business's timezone, supplied by the caller so this stays pure. `taken` maps an ISO
 * date to visits already scheduled that day.
 */
export function startDates(opts: {
  today: string;
  areaWeekdays: number[];
  serviceDays: number[];
  leadDays: number;
  windowDays: number;
  dayCapacity: number;
  taken?: Record<string, number>;
  max?: number;
}): { date: string; weekday: number; label: string; full: boolean }[] {
  const days = opts.areaWeekdays.length ? opts.areaWeekdays : opts.serviceDays;
  const out: { date: string; weekday: number; label: string; full: boolean }[] = [];
  const [y, m, d] = opts.today.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (let i = opts.leadDays; i < opts.leadDays + opts.windowDays; i++) {
    const t = new Date(base + i * 86_400_000);
    const wd = t.getUTCDay();
    if (!days.includes(wd)) continue;
    const iso = t.toISOString().slice(0, 10);
    const full = (opts.taken?.[iso] ?? 0) >= opts.dayCapacity;
    const label = `${WEEKDAY[wd]} ${t.getUTCDate()} ${t.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}`;
    out.push({ date: iso, weekday: wd, label, full });
    if (out.filter((o) => !o.full).length >= (opts.max ?? 4)) break;
  }
  return out;
}
