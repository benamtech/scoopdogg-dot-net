/**
 * Every published price earns at least the floor, per hour on site.
 *
 *   node gates/price-clears-the-floor.mjs
 *
 * WHY IT IS A GATE AND NOT AN EXPERIMENT. This was measured once, by
 * experiments/e8-unit-economics.mjs, which found 16 of 25 published prices under an $85/hour floor
 * — worst was the yard deep clean at $49.50/hr, which is exactly the two-hour job. Migration 013
 * fixed thirteen of them and 016 fixed the last three. An experiment that found something that
 * big is a check that should have been running all along: the next price somebody types in the
 * admin can put a row back under water, and nothing would say so.
 *
 * THE FLOOR IS A ROW, NOT A CONSTANT. `settings.pricing.target_hourly_cents`, written by 013.
 *
 * AND THE MINUTES ARE NOW MEASURED WHERE THEY CAN BE. `service_tiers.est_minutes` carries its own
 * confession: "ESTIMATE by claude:cmo 2026-09-18; replace with the median of real visit
 * durations." Migration 016 DERIVED the price ladder from that estimate, and this gate CHECKED
 * the ladder against it — so one number was both the input to the price and the standard the
 * price was held to, and the two agreed by construction. The gate was green and could not have
 * been anything else (R14 §B).
 *
 * Migration 035 gives a visit a clock, `server/lib/visits.ts` writes it, and `stopDurations()`
 * returns the median of `arrived_at -> completed_at` per tier. This gate now prefers that median
 * over the estimate wherever there are enough visits behind it, and PRINTS WHICH IT USED for
 * every row. Until then it says the check is circular rather than pretending otherwise — a gate
 * that cannot fail should say so out loud, which is the whole lesson of R14 §B.
 *
 * ENOUGH IS FIFTY, per tier, and the number is R14 §E5's, not this file's: "then the ladder, with
 * fifty measured visits behind it". A median over three stops moves by minutes when one customer
 * has a bad week, and a price ladder that moves like that is one nobody will trust twice.
 *
 * It reads the DATABASE, not content/catalog.json. The prices the admin edits are rows, and a
 * gate that read the build artefact would pass on a file pulled before the edit.
 *
 * A RECURRING price is compared at its monthly price ÷ 52/12 visits, because that is the money
 * one visit actually earns. A one-time tier is compared at its own price. A tier with no price
 * (quote required) or no estimate is counted and named, never silently skipped — a row nobody
 * measured is not a row that passed.
 */
import pg from 'pg';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer, cleanupCompile } from './_compile.mjs';

loadEnv();

// R14 §E5's number, read from the module that owns it rather than retyped here.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log('  DATABASE_URL is not set — nothing was measured'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');

const VISITS_PER_MONTH = 52 / 12;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// The SHIPPED median, not a copy of it: a gate that re-implements the query it is checking passes
// on the day the real one is wrong.
const out = compileServer();
const { stopDurations, ENOUGH_TIMED_STOPS: ENOUGH_MEASURED } = await import(`${process.cwd()}/${out}/server/lib/visits.js`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const timed = await stopDurations(c);
const medianFor = new Map((timed.by_tier ?? [])
  .filter((t) => t.measured >= ENOUGH_MEASURED)
  .map((t) => [`${t.service_slug}|${t.label}`, t]));
const seenFor = new Map((timed.by_tier ?? []).map((t) => [`${t.service_slug}|${t.label}`, t.measured]));

console.log(timed.service_measured > 0
  ? `  stops with a recorded clock: ${timed.service_measured} (median service ${timed.service_minutes} min, `
    + `${timed.drive_measured} with a drive median of ${timed.drive_minutes} min)`
  : '  stops with a recorded clock: 0 — migration 035 gives a visit a clock and nothing has been '
    + 'recorded through it yet, so every row below is checked against the estimate the ladder was '
    + 'derived from. That check is CIRCULAR and cannot fail. It is named here rather than hidden.');

const { rows: setting } = await c.query(`select value from settings where key = 'pricing.target_hourly_cents'`);
const floor = Number(setting[0]?.value);
if (!Number.isFinite(floor) || floor <= 0) {
  console.log('  FAIL  pricing.target_hourly_cents is missing or not a number — the floor has no value');
  await c.end();
  process.exit(1);
}

const { rows } = await c.query(`
  select s.name as service, t.service_slug, t.label, t.est_minutes, t.price_cents, t.requires_quote,
         p.slug as package_slug, p.monthly_price_cents
    from service_tiers t
    join services s on s.slug = t.service_slug
    left join packages p on p.tier_id = t.id and p.status = 'active'
   order by s.sort_order, t.sort_order`);
await c.query('rollback');
await c.end();

const under = [];
const unmeasured = [];
const fromTheYard = [];
let measured = 0;

for (const r of rows) {
  const perVisit = r.package_slug
    ? Math.round(r.monthly_price_cents / VISITS_PER_MONTH)
    : r.price_cents;
  if (perVisit == null) { if (!r.requires_quote) unmeasured.push(`${r.service} · ${r.label} — no price and no quote flag`); continue; }
  // A MEASURED MEDIAN BEATS THE ESTIMATE. Where fifty stops have been timed on this tier the
  // minutes come from the yard; otherwise from `est_minutes`, and the row says which it used.
  const key = `${r.service_slug}|${r.label}`;
  const hit = medianFor.get(key);
  const minutes = hit ? hit.median_minutes : r.est_minutes;
  const basis = hit
    ? `measured, ${hit.measured} stops`
    : `estimate${seenFor.get(key) ? `, ${seenFor.get(key)}/${ENOUGH_MEASURED} stops timed` : ''}`;
  if (hit) fromTheYard.push(`${r.service} · ${r.label} — ${hit.measured} stops, median ${hit.median_minutes} min against an estimate of ${r.est_minutes}`);

  if (minutes == null) { unmeasured.push(`${r.service} · ${r.label} — priced at ${money(perVisit)} with no est_minutes and no timed stop`); continue; }
  measured++;
  const hourly = perVisit / (minutes / 60);
  if (hourly < floor) under.push(`${r.service} · ${r.label} — ${money(perVisit)} over ${minutes} min [${basis}] = ${money(hourly)}/hr, under by ${money(floor - hourly)}`);
}

// NEGATIVE CONTROL: the same arithmetic on a row that is plainly under must be caught. A
// comparison that has quietly become `>=` on a NaN passes every row there is.
const control = (2077 / (15 / 60)) < floor && (2308 / (15 / 60)) >= floor;

console.log(`  floor: ${money(floor)}/hour on site, from settings.pricing.target_hourly_cents`);
console.log(`  negative control: ${control ? '$20.77 over 15 min is caught, $23.08 is not' : 'DETECTOR BLIND'}`);
console.log(`  measured ${measured} priced rows; ${unmeasured.length} could not be measured`);
console.log(fromTheYard.length
  ? `  ${fromTheYard.length} tier(s) checked against a real median rather than the estimate:`
  : `  0 tiers have ${ENOUGH_MEASURED} timed stops yet, so every row above is checked against the `
    + 'estimate the ladder was derived from — a circular check, named rather than hidden (R14 §B).');
for (const m of fromTheYard) console.log(`    from the yard  ${m}`);
for (const u of unmeasured) console.log(`    unmeasured  ${u}`);
for (const u of under) console.log(`    UNDER       ${u}`);

const ok = control && under.length === 0 && unmeasured.length === 0;
console.log(ok ? `PASS ${measured}/${measured} clear the floor` : `FAIL ${under.length} under the floor, ${unmeasured.length} unmeasured`);
cleanupCompile();
process.exit(ok ? 0 : 1);
