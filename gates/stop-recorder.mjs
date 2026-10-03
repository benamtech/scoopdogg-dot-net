/**
 * A visit gets a clock, the clock cannot run backwards, and the median comes from the yard.
 *
 *   node gates/stop-recorder.mjs
 *
 * THE FAULT THIS EXISTS FOR (R14 §B). `visits.en_route_at` has been in the schema since migration
 * 001 and nothing has ever written it. `completeVisit()` set `completed_at` and nothing else, and
 * there was no `arrived_at` at all — so no visit's duration had ever been recorded on this
 * project. That is not a tidiness problem. `service_tiers.est_minutes` carries its own confession
 * in its column comment ("replace with the median of real visit durations"); migration 016
 * DERIVED the price ladder from it; `gates/price-clears-the-floor.mjs` CHECKED the ladder against
 * it. One estimate was both the input to the price and the standard the price was held to, so the
 * gate was green and could not be anything else. `server/lib/density.ts` measured every city's
 * marginal customer against the same estimate, so the growth board's whole ranking inherited it.
 *
 * WHAT IT CHECKS
 *   A. the pair exists and the shipped verbs write it
 *   B. the database refuses a clock that runs backwards
 *   C. the medians are medians, and `measured` is part of the answer
 *   D. a stop with no clock still closes — because the one-man operator is the normal case
 *
 * Everything runs against migration 035's schema applied inside a transaction that is always
 * rolled back, so this is green before the migration is applied anywhere.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const MIGRATION = 'migrations/035_the_stop_gets_recorded.sql';
const adminTs = readFileSync('api/admin.ts', 'utf8');

console.log('A. the verbs exist and something calls them');
check(/'visits\/en-route'/.test(adminTs) && /'visits\/arrived'/.test(adminTs),
  'the admin exposes both halves of the clock', 'a writer with no caller is the defect this replaces');
check(/CREW_PATHS = new Set\(\[[\s\S]{0,300}'visits\/en-route'[\s\S]{0,60}'visits\/arrived'/.test(adminTs),
  'and the crew may use them',
  'the person standing in the yard is the only one who knows when the van got there');
check(/markEnRoute/.test(adminTs) && /markArrived/.test(adminTs),
  'through the shipped verbs, not through SQL in the handler');
// THE SCREEN IS THE CALLER. An API verb nobody can tap is a writer with no trigger, which is the
// exact shape 035 exists to end — so the crew screen's two buttons are pinned here, beside the
// routes they call, and so is the line that tells the crew what the clock has measured.
const todayTsx = readFileSync('src/pages_react/admin/AdminTodayPage.tsx', 'utf8');
check(/adminApi\.markEnRoute\(/.test(todayTsx) && /adminApi\.markArrived\(/.test(todayTsx),
  'the Today screen has the two taps', '"On my way" and "I\'m here"');
check(/data\.durations/.test(todayTsx), 'and it shows what the timed stops say', 'a clock nobody can read back is a clock nobody keeps');
check(!/disabled=\{[^}]*arrived_at/.test(todayTsx), 'and Mark done never waits on them',
  'a one-man operator with his hands full is the normal case');

const out = compileServer();
const mod = (f) => import(`${process.cwd()}/${out}/server/lib/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const { markEnRoute, markArrived, completeVisit, stopDurations, ENOUGH_TIMED_STOPS } = await mod('visits.js');

// `visit.require_completion_photo` is ON, and it should be: it is Josue's proof-of-care
// differentiator and his chargeback evidence (R3 §3d). So every completion below carries one,
// exactly as a real one does, rather than the gate turning the setting off to make itself pass.
const PHOTO = ['https://example.invalid/gate-stop-recorder.jpg'];

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');

  const hasClock = async () => (await c.query(
    `select count(*)::int n from information_schema.columns where table_name='visits' and column_name='arrived_at'`)).rows[0].n === 1;

  if (!(await hasClock())) {
    const before = await stopDurations(c);
    check(before.service_minutes === null && before.service_measured === 0,
      'BEFORE 035 there is no duration to report, and it says null rather than zero',
      'zero minutes and unknown minutes are different sentences and only one of them is true');
    const body = readFileSync(MIGRATION, 'utf8')
      .replace(/^[ \t]*begin[ \t]*;[ \t]*$/gim, '').replace(/^[ \t]*commit[ \t]*;[ \t]*$/gim, '');
    await c.query(body);
  } else {
    ok('035 is already applied on this database');
  }
  check(await hasClock(), '035 gives the visit an arrival', 'applied in this transaction, rolled back');

  // ---- a customer with somewhere to be -------------------------------------------------------
  const { rows: [cust] } = await c.query(
    `insert into customers (name, email, phone) values ('GATE stop-recorder','gate+stop@example.invalid','8055550003') returning id`);
  const { rows: [prop] } = await c.query(
    `insert into properties (customer_id, address, city, postal_code) values ($1,'1 Gate Way','Ventura','93003') returning id`, [cust.id]);
  const { rows: [sub] } = await c.query(
    `insert into subscriptions (customer_id, property_id, service_slug, state, monthly_price_cents, source)
     values ($1,$2,'weekly-pooper-scooper-service','active',12000,'online') returning id`, [cust.id, prop.id]);
  let day = 0;
  const aVisit = async () => {
    day += 1;
    const { rows: [v] } = await c.query(
      `insert into visits (subscription_id, property_id, scheduled_for, state)
       values ($1,$2,current_date - $3::int,'scheduled') returning id`, [sub.id, prop.id, day]);
    return v.id;
  };

  // ---- B. the clock, through the shipped verbs -----------------------------------------------
  console.log('\nB. the clock runs forwards and only once');
  const v1 = await aVisit();
  const left = await markEnRoute(v1, null, c);
  check(left.en_route_at !== null && left.state === 'en_route',
    'the van leaving is recorded, and the visit says so', `state=${left.state}`);
  check(left.drive_minutes === null && left.service_minutes === null,
    'with one end of each interval, both durations are null', 'not zero — nothing has been measured yet');

  const again = await markEnRoute(v1, null, c);
  check(again.en_route_at === left.en_route_at,
    'tapping it twice does not move the timestamp', 'a crew member tapping twice has not left twice');

  await c.query(`update visits set en_route_at = now() - interval '11 minutes' where id = $1`, [v1]);
  const there = await markArrived(v1, null, c);
  check(there.arrived_at !== null && there.drive_minutes !== null && there.drive_minutes >= 10.5,
    'arriving closes the DRIVE interval', `${there.drive_minutes} min — the number density.ts models and has never checked`);
  check(there.service_minutes === null, 'and the service interval is still open', 'the work has not finished');

  // BOTH ends move together. The first version of this fixture set `arrived_at` to now-17 while
  // `en_route_at` was still now-11 — arriving before leaving — and migration 035's check
  // constraint rejected it. That is the constraint doing its job on the gate that checks it.
  await c.query(
    `update visits set en_route_at = now() - interval '28 minutes', arrived_at = now() - interval '17 minutes' where id = $1`, [v1]);
  const done = await completeVisit({ visitId: v1, completedBy: null, photoUrls: PHOTO }, c);
  const { rows: [d1] } = await c.query(
    `select extract(epoch from (completed_at - arrived_at))/60 as svc from visits where id = $1`, [v1]);
  check(done.state === 'completed' && Number(d1.svc) >= 16.5,
    'and completing closes the SERVICE interval — the number the price argument needs',
    `${Number(d1.svc).toFixed(1)} min against an est_minutes of 15`);

  // ---- the database refuses a backwards clock ------------------------------------------------
  let rejected = false;
  try {
    await c.query(`savepoint s1`);
    await c.query(`update visits set arrived_at = en_route_at - interval '5 minutes' where id = $1`, [v1]);
  } catch { rejected = true; } finally { await c.query(`rollback to savepoint s1`).catch(() => {}); }
  check(rejected, 'a clock that runs backwards is refused by the database',
    'a negative median is the kind of number that gets noticed six weeks later');

  // ---- C. the medians ------------------------------------------------------------------------
  console.log('\nC. the median is a median, and it knows how many it is over');
  for (const mins of [10, 30]) {
    const v = await aVisit();
    await markEnRoute(v, null, c); await markArrived(v, null, c);
    await c.query(`update visits set arrived_at = now() - ($2 || ' minutes')::interval, en_route_at = now() - ($2::int + 5 || ' minutes')::interval where id = $1`, [v, String(mins)]);
    await completeVisit({ visitId: v, completedBy: null, photoUrls: PHOTO }, c);
  }
  const dur = await stopDurations(c);
  check(dur.service_measured === 3, 'every timed stop is counted', `${dur.service_measured} stops`);
  check(dur.service_minutes !== null && Math.abs(dur.service_minutes - 17) < 1.5,
    'and the middle one is the median, not the mean', `median ${dur.service_minutes} of 10, ~17, 30 — a mean would be ~19`);
  check(dur.drive_measured === 3 && dur.drive_minutes !== null,
    'the drive median is measured separately', `${dur.drive_measured} stops, ${dur.drive_minutes} min`);
  const tier = dur.by_tier.find((t) => t.service_slug === 'weekly-pooper-scooper-service');
  check(!!tier && tier.measured > 0, 'and it is broken down per tier',
    tier ? `${tier.label}: ${tier.measured} stops, median ${tier.median_minutes} against est ${tier.est_minutes}` : 'no tier row');
  check(ENOUGH_TIMED_STOPS === 50 && dur.service_measured < ENOUGH_TIMED_STOPS,
    `three stops is not yet the ${ENOUGH_TIMED_STOPS} a reprice needs`,
    'R14 §E5 — and the price gate says so out loud rather than using this median');

  // ---- D. the one-man operator still closes a stop --------------------------------------------
  console.log('\nnegative controls');
  const v4 = await aVisit();
  const plain = await completeVisit({ visitId: v4, completedBy: null, photoUrls: PHOTO }, c);
  check(plain.state === 'completed', 'a stop nobody timed still closes',
    'a verb that refuses a man with a phone in his pocket is a verb that gets worked around');
  const after = await stopDurations(c);
  check(after.service_measured === 3, 'and it does not enter the median as a zero',
    `still ${after.service_measured} timed stops out of 4 completed`);

  let refused = false;
  try { await markArrived(v4, null, c); } catch { refused = true; }
  check(refused, 'a completed visit cannot be back-dated an arrival', 'the clock closes when the visit does');

  let missing = false;
  try { await markEnRoute('00000000-0000-4000-8000-000000000000', null, c); } catch (e) { missing = /No such visit/.test(String(e.message)); }
  check(missing, 'and a visit that does not exist is a 404, not a new row');
} catch (e) {
  no('the gate ran to the end', String(e.message ?? e));
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  cleanupCompile();
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
