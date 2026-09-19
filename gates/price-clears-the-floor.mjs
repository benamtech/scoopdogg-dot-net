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
 * The minutes are `service_tiers.est_minutes`, and that column's own comment says what it is:
 * "ESTIMATE by claude:cmo 2026-09-18; replace with the median of real visit durations." When
 * visits.completed_at can supply that median, this gate gets sharper without changing shape.
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

loadEnv();
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log('  DATABASE_URL is not set — nothing was measured'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');

const VISITS_PER_MONTH = 52 / 12;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const { rows: setting } = await c.query(`select value from settings where key = 'pricing.target_hourly_cents'`);
const floor = Number(setting[0]?.value);
if (!Number.isFinite(floor) || floor <= 0) {
  console.log('  FAIL  pricing.target_hourly_cents is missing or not a number — the floor has no value');
  await c.end();
  process.exit(1);
}

const { rows } = await c.query(`
  select s.name as service, t.label, t.est_minutes, t.price_cents, t.requires_quote,
         p.slug as package_slug, p.monthly_price_cents
    from service_tiers t
    join services s on s.slug = t.service_slug
    left join packages p on p.tier_id = t.id and p.status = 'active'
   order by s.sort_order, t.sort_order`);
await c.query('rollback');
await c.end();

const under = [];
const unmeasured = [];
let measured = 0;

for (const r of rows) {
  const perVisit = r.package_slug
    ? Math.round(r.monthly_price_cents / VISITS_PER_MONTH)
    : r.price_cents;
  if (perVisit == null) { if (!r.requires_quote) unmeasured.push(`${r.service} · ${r.label} — no price and no quote flag`); continue; }
  if (r.est_minutes == null) { unmeasured.push(`${r.service} · ${r.label} — priced at ${money(perVisit)} with no est_minutes`); continue; }
  measured++;
  const hourly = perVisit / (r.est_minutes / 60);
  if (hourly < floor) under.push(`${r.service} · ${r.label} — ${money(perVisit)} over ${r.est_minutes} min = ${money(hourly)}/hr, under by ${money(floor - hourly)}`);
}

// NEGATIVE CONTROL: the same arithmetic on a row that is plainly under must be caught. A
// comparison that has quietly become `>=` on a NaN passes every row there is.
const control = (2077 / (15 / 60)) < floor && (2308 / (15 / 60)) >= floor;

console.log(`  floor: ${money(floor)}/hour on site, from settings.pricing.target_hourly_cents`);
console.log(`  negative control: ${control ? '$20.77 over 15 min is caught, $23.08 is not' : 'DETECTOR BLIND'}`);
console.log(`  measured ${measured} priced rows; ${unmeasured.length} could not be measured`);
for (const u of unmeasured) console.log(`    unmeasured  ${u}`);
for (const u of under) console.log(`    UNDER       ${u}`);

const ok = control && under.length === 0 && unmeasured.length === 0;
console.log(ok ? `PASS ${measured}/${measured} clear the floor` : `FAIL ${under.length} under the floor, ${unmeasured.length} unmeasured`);
process.exit(ok ? 0 : 1);
