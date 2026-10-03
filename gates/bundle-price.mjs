/**
 * A named package is a charged package, and an offer's requirement cannot be satisfied for free.
 *
 *   node gates/bundle-price.mjs
 *
 * THE LEAK THIS EXISTS TO KEEP CLOSED, measured on the live catalog 2026-09-22:
 *
 *     turf-weekly-small-area alone                    monthly $150.00   first charge $150.00
 *     + with_package_ids: [scoop-weekly-1-dog]        monthly $150.00   first charge  $75.00
 *
 * `quoteBooking()` resolved `withPackageIds`, put their service slugs into the `booked` list so
 * that offers with `requires_slugs` would match, and never added their prices. The offer "Turf
 * maintenance: first month half off with scooping" requires `weekly-pooper-scooper-service`, so
 * merely NAMING it bought $75 off — and the scooping was never billed, in the first month or any
 * month after. `api/booking.ts` forwards `with_package_ids` from the public request body verbatim,
 * so this was reachable by anyone who read the code or guessed the field.
 *
 * A parameter that unlocks a bundle discount without buying the bundle is worse than a missing
 * feature: the missing feature costs nothing.
 *
 * WHAT THIS GATE CHECKS, and the second one is the one that would catch a regression:
 *
 *   1. ARITHMETIC. Every named package is a recurring line and `monthlyCents` is their sum.
 *   2. NO FREE REQUIREMENT. For every offer with `requires_slugs`, naming the required service
 *      must cost at least that service's cheapest monthly price. This is derived from the OFFERS
 *      TABLE rather than hardcoded to today's two offers, so an offer added next month is covered
 *      without anybody remembering to come back here.
 *
 * It reads the REAL catalog from the database and calls the SHIPPED `quoteBooking`, because a gate
 * that re-implemented the sum would agree with a broken implementation.
 */
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const money = (c) => `$${(c / 100).toFixed(2)}`;

const out = compileServer();
const p = (f) => `${process.cwd()}/${out}/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd());
const { loadCatalog } = await import(p('server/lib/catalog-db.js'));
const { quoteBooking } = await import(p('src/shared/pricing.js'));

const cat = await loadCatalog();
const cheapestMonthly = (slug) => cat.packages
  .filter((x) => x.service_slug === slug)
  .sort((a, b) => a.monthly_price_cents - b.monthly_price_cents)[0];

try {
  // ---- 1. the arithmetic -------------------------------------------------------------------
  console.log('1. every named package is charged');
  {
    const a = cat.packages.find((x) => x.service_slug === 'weekly-turf-maintenance');
    const b = cat.packages.find((x) => x.service_slug === 'weekly-pooper-scooper-service');
    check(!!a && !!b, 'two monthly packages to combine exist', a && b ? `${a.slug} + ${b.slug}` : 'missing');

    const alone = quoteBooking(cat, { packageId: a.id });
    const both = quoteBooking(cat, { packageId: a.id, withPackageIds: [b.id] });
    check(alone.ok && both.ok, 'both quotes resolve');

    check(both.monthlyCents === a.monthly_price_cents + b.monthly_price_cents,
      'monthlyCents is the sum of every recurring line',
      `${money(both.monthlyCents)} = ${money(a.monthly_price_cents)} + ${money(b.monthly_price_cents)}`);

    const recurring = both.lines.filter((l) => l.recurring);
    check(recurring.length === 2 && recurring.some((l) => l.ref === b.id),
      'the second package gets its own line on the quote',
      `${recurring.length} recurring lines — a total with no line behind it is what the customer disputes`);

    check(both.firstChargeCents > alone.firstChargeCents,
      'adding a service cannot make the first charge SMALLER',
      `alone ${money(alone.firstChargeCents)} -> with ${money(both.firstChargeCents)}`);

    // The sum of the lines must equal the stated first charge, or one of them is decoration.
    const summed = both.lines.reduce((t, l) => t + l.cents, 0);
    check(summed === both.firstChargeCents,
      'the lines add up to the first charge',
      `${money(summed)} vs ${money(both.firstChargeCents)}`);

    const dup = quoteBooking(cat, { packageId: a.id, withPackageIds: [a.id] });
    check(!dup.ok && dup.reason === 'duplicate_package',
      'the same package twice is refused', `reason ${dup.ok ? 'none' : dup.reason}`);
    const bogus = quoteBooking(cat, { packageId: a.id, withPackageIds: ['not-a-package'] });
    check(!bogus.ok && bogus.reason === 'unknown_package',
      'an unknown id is refused rather than silently dropped',
      'silently dropping it is how a customer is charged for less than the quote showed');
  }

  // ---- 2. no offer requirement can be satisfied for free -----------------------------------
  // Driven off the offers table, so a new offer is covered without editing this gate.
  console.log('\n2. no offer requirement is satisfiable for free');
  {
    const gated = cat.offers.filter((o) => o.status === 'active' && (o.requires_slugs ?? []).length > 0);
    check(gated.length > 0, 'there is at least one offer with a requirement to test',
      `${gated.length} of ${cat.offers.length} offers are conditional`);

    for (const offer of gated) {
      for (const appliesTo of (offer.applies_to_slugs.length ? offer.applies_to_slugs : [null])) {
        const primary = appliesTo ? cheapestMonthly(appliesTo) : cat.packages[0];
        if (!primary) { no(`a package exists for ${appliesTo}`, 'cannot test this offer'); continue; }
        const required = offer.requires_slugs.map(cheapestMonthly).filter(Boolean);
        if (required.length !== offer.requires_slugs.length) {
          no(`every required service of "${offer.name}" has a monthly package`,
             'an offer requiring something unbuyable can never be earned honestly');
          continue;
        }
        const without = quoteBooking(cat, { packageId: primary.id });
        const with_ = quoteBooking(cat, { packageId: primary.id, withPackageIds: required.map((r) => r.id) });
        const requiredCost = required.reduce((t, r) => t + r.monthly_price_cents, 0);
        const delta = with_.firstChargeCents - without.firstChargeCents;

        check(delta >= 0,
          `"${offer.name}" cannot be earned for free`,
          `claiming ${offer.requires_slugs.join(' + ')} changes the first charge by ${money(delta)} `
          + `against a required cost of ${money(requiredCost)}`);
        check(with_.monthlyCents >= without.monthlyCents + requiredCost,
          `and the monthly reflects everything claimed`,
          `${money(with_.monthlyCents)} >= ${money(without.monthlyCents)} + ${money(requiredCost)}`);
      }
    }
  }

  // ---- negative controls -------------------------------------------------------------------
  // The exact pre-fix behaviour, reconstructed, must fail check 1. Without this the checks above
  // could be passing for a reason unrelated to the sum.
  console.log('\nnegative controls');
  {
    const a = cat.packages.find((x) => x.service_slug === 'weekly-turf-maintenance');
    const b = cat.packages.find((x) => x.service_slug === 'weekly-pooper-scooper-service');
    const leaked = { monthlyCents: a.monthly_price_cents };   // what it used to return
    check(leaked.monthlyCents !== a.monthly_price_cents + b.monthly_price_cents,
      'the old behaviour would fail the sum check',
      `the pre-fix monthly was ${money(leaked.monthlyCents)}, the honest one is ${money(a.monthly_price_cents + b.monthly_price_cents)}`);

    // And the offer really does fire on the pair — otherwise check 2 passes by the offer never
    // matching, which would make it vacuous.
    const with_ = quoteBooking(cat, { packageId: a.id, withPackageIds: [b.id] });
    check(with_.appliedOffers.length > 0,
      'the conditional offer really does fire on this pair',
      with_.appliedOffers.map((o) => o.name).join(', ') || 'NO OFFER FIRED — check 2 would be vacuous');
  }
} catch (e) {
  no('the gate ran to the end', String(e.message ?? e));
} finally {
  cleanupCompile();
}

console.log(`\n${fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`}`);
process.exit(fail ? 1 : 0);
