// node --test tests/
// The resolver's promises, each with the case that would break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tierForQuantity, formatTierPrice, quoteBooking, quoteOneTime, bookableServices, startDates, offersFor,
  catchUpFor, catchUpForWeeks, lastCleanedForWeeks, LAST_CLEANED,
  type Catalog, type Service, type Tier, type Package, type Offer,
} from '../src/shared/pricing.ts';

const svc = (slug: string, basis: Service['price_basis']): Service => ({ slug, name: slug, kind: 'recurring', price_basis: basis, basis_label: '' });
const tier = (id: string, service_slug: string, min: number | null, max: number | null, cents: number | null, extra: Partial<Tier> = {}): Tier => ({
  id, service_slug, label: id, min_qty: min, max_qty: max, price_cents: cents, price_suffix: '/week',
  requires_quote: cents === null, price_is_from: false, sort_order: 0, ...extra,
});

const scoop = svc('weekly-pooper-scooper-service', 'dogs');
const turf = svc('weekly-turf-maintenance', 'sqft');
const yardDeep = svc('one-time-dog-poop-cleanup', 'choice');
const tiers: Tier[] = [
  tier('d1', scoop.slug, 1, 1, 1500, { sort_order: 1 }),
  tier('d2', scoop.slug, 2, 2, 2000, { sort_order: 2 }),
  tier('d3', scoop.slug, 3, 3, 2300, { sort_order: 3 }),
  tier('d4', scoop.slug, 4, null, 2500, { sort_order: 4 }),
  tier('ts', turf.slug, null, 300, 3500, { sort_order: 1, price_suffix: '/visit' }),
  tier('tm', turf.slug, 300, 600, 5000, { sort_order: 2, price_suffix: '/visit' }),
  tier('tl', turf.slug, 600, null, null, { sort_order: 3 }),
  tier('y1', yardDeep.slug, null, null, 9900, { sort_order: 1, price_suffix: '' }),
  tier('y3', yardDeep.slug, null, null, null, { sort_order: 3 }),
  tier('from', 'weekly-yard-maintenance', null, null, 4000, { price_is_from: true, price_suffix: '/visit' }),
];
const pkg = (id: string, service_slug: string, tier_id: string, cents: number): Package => ({
  id, slug: id, service_slug, tier_id, name: id, short_label: id, frequency: 'weekly', visits_per_month: 4.33,
  monthly_price_cents: cents, derivation: '', source: 'derived_from_published', version: 1, featured: false, sort_order: 0,
});
const offers: Offer[] = [
  { id: 'o1', name: 'First month half off', kind: 'percent_off', value: 50, applies_to_slugs: [scoop.slug], requires_slugs: [], status: 'active' },
  { id: 'o2', name: 'Turf half off with scooping', kind: 'percent_off', value: 50, applies_to_slugs: [turf.slug], requires_slugs: [scoop.slug], status: 'active' },
];
const catalog: Catalog = {
  services: [scoop, turf, yardDeep],
  tiers,
  packages: [pkg('p2', scoop.slug, 'd2', 8700), pkg('pt', turf.slug, 'ts', 15200), pkg('pf', 'weekly-yard-maintenance', 'from', 17300)],
  offers,
};

test('dogs: counts are inclusive, 4+ is open', () => {
  assert.equal(tierForQuantity(scoop, tiers, 1)?.id, 'd1');
  assert.equal(tierForQuantity(scoop, tiers, 2)?.id, 'd2');
  assert.equal(tierForQuantity(scoop, tiers, 9)?.id, 'd4');
});

test('sqft: "under 300" and "300-600" put the boundary in the upper tier', () => {
  assert.equal(tierForQuantity(turf, tiers, 299)?.id, 'ts');
  assert.equal(tierForQuantity(turf, tiers, 300)?.id, 'tm');
  assert.equal(tierForQuantity(turf, tiers, 600)?.id, 'tl');
});

test('a from price never reads as final', () => {
  assert.equal(formatTierPrice(tiers.find((t) => t.id === 'from')!), 'From $40/visit');
  assert.equal(formatTierPrice(tiers.find((t) => t.id === 'd2')!), '$20/week');
  assert.equal(formatTierPrice(tiers.find((t) => t.id === 'y3')!), 'Custom quote');
});

test('first month half off applies to the package, not to one-time extras', () => {
  const q = quoteBooking(catalog, { packageId: 'p2', extraTierIds: ['y1'] });
  assert.ok(q.ok);
  if (!q.ok) return;
  assert.equal(q.monthlyCents, 8700);
  assert.equal(q.discountCents, 4350);
  assert.equal(q.extrasCents, 9900);
  assert.equal(q.firstChargeCents, 8700 - 4350 + 9900);
});

test('turf offer applies only when combined with scooping', () => {
  assert.equal(offersFor(catalog, turf.slug, [turf.slug]).length, 0);
  assert.equal(offersFor(catalog, turf.slug, [turf.slug, scoop.slug]).length, 1);
  const alone = quoteBooking(catalog, { packageId: 'pt' });
  const combined = quoteBooking(catalog, { packageId: 'pt', withPackageIds: ['p2'] });
  assert.ok(alone.ok && combined.ok);
  if (alone.ok && combined.ok) {
    assert.equal(alone.firstChargeCents, 15200);

    /**
     * THIS NUMBER USED TO BE 7600, AND THAT ASSERTION WAS PINNING A REVENUE LEAK.
     *
     * 7600 is half of the turf package and nothing else: the offer's 50% was applied, and the
     * scooping package named in `withPackageIds` was never charged. The test agreed with the code,
     * so neither could see it. Measured on the live catalog the same shape read: turf $150 alone,
     * $75 combined — $75 off for naming a service the customer was not buying, reachable from the
     * public endpoint because api/booking.ts forwards `with_package_ids` verbatim.
     *
     * The honest arithmetic, from this fixture: turf 15200 + scooping 8700 = 23900 a month, less
     * 50% of the turf line (7600) on the first month = 16300. The discount is real, it is just
     * earned now.
     */
    assert.equal(combined.monthlyCents, 15200 + 8700);
    assert.equal(combined.discountCents, 7600);
    assert.equal(combined.firstChargeCents, 16300);

    // Adding a service must never lower the bill. This is the invariant the old number violated,
    // stated directly so it cannot be re-broken by a plausible-looking edit to the total.
    assert.ok(combined.firstChargeCents > alone.firstChargeCents);
    assert.ok(combined.monthlyCents > alone.monthlyCents);

    // Every recurring line has a package behind it, and they sum to the monthly.
    const recurring = combined.lines.filter((l) => l.recurring);
    assert.equal(recurring.length, 2);
    assert.equal(recurring.reduce((t, l) => t + l.cents, 0), combined.monthlyCents);
  }

  // The same package twice is a mistake, not a discount.
  assert.deepEqual(quoteBooking(catalog, { packageId: 'pt', withPackageIds: ['pt'] }),
    { ok: false, reason: 'duplicate_package' });
  // An id that resolves to nothing must refuse, not silently drop — dropping it charges the
  // customer less than the quote they were shown.
  assert.deepEqual(quoteBooking(catalog, { packageId: 'pt', withPackageIds: ['nope'] }),
    { ok: false, reason: 'unknown_package' });
});

test('an extra that needs a quote refuses the checkout instead of charging zero', () => {
  const q = quoteBooking(catalog, { packageId: 'p2', extraTierIds: ['y3'] });
  assert.deepEqual(q, { ok: false, reason: 'extra_requires_quote' });
});

test('a package built on a from price is flagged', () => {
  const q = quoteBooking(catalog, { packageId: 'pf' });
  assert.ok(q.ok && q.flags.containsFromPrice && q.flags.priceIsDerived);
});

test('start dates follow the city days, skip full days, and fall back to service days', () => {
  const tue = startDates({ today: '2026-09-16', areaWeekdays: [2, 5], serviceDays: [0, 1, 2, 3, 4, 5, 6], leadDays: 3, windowDays: 14, dayCapacity: 20, taken: { '2026-09-22': 20 }, max: 2 });
  assert.deepEqual(tue.map((d) => [d.date, d.full]), [['2026-09-22', true], ['2026-09-25', false], ['2026-09-29', false]]);
  const any = startDates({ today: '2026-09-16', areaWeekdays: [], serviceDays: [1, 3], leadDays: 3, windowDays: 7, dayCapacity: 20, max: 4 });
  assert.deepEqual(any.map((d) => d.weekday), [1, 3]);
});

// ---------------------------------------------------------------------------------------
// One-time work (P16 §3): the second and third of the three shapes.
// ---------------------------------------------------------------------------------------

test('a priced one-time tier quotes at its own price', () => {
  const q = quoteOneTime(catalog, 'y1');
  assert.equal(q.ok, true);
  if (q.ok) {
    assert.equal(q.cents, 9900);
    assert.ok(q.label.includes('y1'));
  }
});

test('a quote tier refuses to become a checkout', () => {
  const q = quoteOneTime(catalog, 'y3');
  assert.equal(q.ok, false);
  if (!q.ok) assert.equal(q.reason, 'requires_quote');
});

test('a "from" price never reaches a checkout either', () => {
  // gates/from-price-never-final.mjs makes the same promise about pages. A checkout is the most
  // final a number ever gets, so the resolver refuses before anyone is charged a floor.
  // The fixture's 'from' tier belongs to a service the fixture never declares, so declare it:
  // the rule being pinned is about the PRICE, not about a missing service.
  const c: Catalog = { ...catalog, services: [...catalog.services, svc('weekly-yard-maintenance', 'sqft')] };
  const q = quoteOneTime(c, 'from');
  assert.equal(q.ok, false);
  if (!q.ok) assert.equal(q.reason, 'from_price');
});

test('an unknown tier is refused rather than priced at zero', () => {
  const q = quoteOneTime(catalog, 'no-such-tier');
  assert.equal(q.ok, false);
  if (!q.ok) assert.equal(q.reason, 'unknown_tier');
});

test('every service in the catalog has a shape the funnel can render', () => {
  const shapes = bookableServices(catalog);
  assert.equal(shapes.length, catalog.services.length);
  assert.equal(shapes.find((s) => s.service.slug === scoop.slug)?.shape, 'recurring');
  assert.equal(shapes.find((s) => s.service.slug === yardDeep.slug)?.shape, 'one_time');
  // The cheapest number a card may advertise comes from the same place the booking charges.
  assert.equal(shapes.find((s) => s.service.slug === yardDeep.slug)?.fromCents, 9900);
  assert.equal(shapes.find((s) => s.service.slug === scoop.slug)?.fromCents, 8700);
});

test('a service with only quote tiers is still offered, as a quote', () => {
  const quoteOnly = svc('cat-tree-cleaning', 'units');
  const c: Catalog = { ...catalog, services: [...catalog.services, quoteOnly],
    tiers: [...catalog.tiers, tier('ct1', quoteOnly.slug, null, null, null)] };
  assert.equal(bookableServices(c).find((s) => s.service.slug === quoteOnly.slug)?.shape, 'quote');
});

// ---------------------------------------------------------------------------------------
// Josue's rule, on both doors. "when yard has not been cleaned longer than a couple weeks it
// would increase price because the default price is based on having a weekly clean."
//
// The booking door reads an ANSWER the customer gave. The pause door reads a GAP the system
// measured. They must land on the same band and the same money, or the rule has a hole in the
// shape of whichever door somebody used.
// ---------------------------------------------------------------------------------------
const catchUpTiers: Tier[] = [
  tier('cu-standard', yardDeep.slug, null, null, 9900, { label: 'Standard yard (up to 2 weeks buildup)', covers_last_cleaned: ['this_week', 'two_weeks'] }),
  tier('cu-heavy', yardDeep.slug, null, null, 14900, { label: 'Heavy buildup (3-6 weeks)', covers_last_cleaned: ['month'] }),
  tier('cu-severe', yardDeep.slug, null, null, null, { label: 'Severe (6+ weeks or multiple dogs)', covers_last_cleaned: ['longer'] }),
];
const withCatchUp: Catalog = { ...catalog, tiers: [...tiers, ...catchUpTiers] };

test('a couple of weeks is a couple of weeks, and costs nothing', () => {
  assert.equal(catchUpFor(withCatchUp, scoop.slug, 'this_week').kind, 'none');
  assert.equal(catchUpFor(withCatchUp, scoop.slug, 'two_weeks').kind, 'none');
  assert.equal(catchUpForWeeks(withCatchUp, scoop.slug, 2).kind, 'none');
});

test('beyond a couple of weeks costs what Josue publishes for it', () => {
  const m = catchUpFor(withCatchUp, scoop.slug, 'month');
  assert.equal(m.kind, 'charge');
  if (m.kind === 'charge') { assert.equal(m.cents, 14900); assert.equal(m.band, '3-6 weeks'); }
  assert.equal(catchUpFor(withCatchUp, scoop.slug, 'longer').kind, 'quote');
});

test('a measured gap and a typed answer reach the same money', () => {
  // 4 weeks is the pause the cancel dialog offers as its save offer.
  const asked = catchUpFor(withCatchUp, scoop.slug, 'month');
  const measured = catchUpForWeeks(withCatchUp, scoop.slug, 4);
  assert.deepEqual(measured, asked);
  assert.deepEqual(catchUpForWeeks(withCatchUp, scoop.slug, 12), catchUpFor(withCatchUp, scoop.slug, 'longer'));
});

test('the week boundaries are the ones the question states', () => {
  assert.equal(lastCleanedForWeeks(0), 'this_week');
  assert.equal(lastCleanedForWeeks(2), 'two_weeks');
  assert.equal(lastCleanedForWeeks(3), 'month');
  assert.equal(lastCleanedForWeeks(6), 'month');
  assert.equal(lastCleanedForWeeks(7), 'longer');
  // A negative gap is a clock problem, not a free clean.
  assert.equal(lastCleanedForWeeks(-5), 'this_week');
  assert.equal(LAST_CLEANED.length, 4);
});

test('the rule stays on the service Josue described', () => {
  // Turf and yard maintenance are weekly too, and he has published no catch-up ladder for
  // them. Inventing one would be inventing a fact about his business.
  assert.equal(catchUpForWeeks(withCatchUp, turf.slug, 12).kind, 'none');
  // A one-time job is never "behind" — it IS the catch-up.
  assert.equal(catchUpForWeeks(withCatchUp, yardDeep.slug, 12).kind, 'none');
});
