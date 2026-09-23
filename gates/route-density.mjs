/**
 * The marginal cost of one more customer is arithmetic, and the arithmetic behaves.
 *
 *   node gates/route-density.mjs
 *
 * `server/lib/density.ts` turns three facts — Census coordinates, Google's placement of the
 * business, and Josue's own `est_minutes` — into the number nothing on this project has ever had:
 * what ONE more customer in a given city adds to the driving. Ranking the cities by it is the
 * acquisition recommendation.
 *
 * A closed-form model is easy to get subtly wrong and impossible to notice wrong, because every
 * answer looks like a plausible number of minutes. So this gate does not check outputs against
 * remembered values. It checks PROPERTIES the model must have if it is the model it claims to be,
 * each one falsifiable on its own:
 *
 *   1. n = 0 costs nothing. An empty city is not driven to.
 *   2. Driving rises with customers, and driving PER CUSTOMER falls. That is density.
 *   3. The marginal customer gets cheaper as the city fills. That is why density is a GTM variable.
 *   4. Distance makes the marginal customer dearer, holding everything else equal.
 *   5. Area makes the marginal customer dearer, holding everything else equal. (Daganzo: sprawl
 *      costs, at equal count.)
 *   6. The parity threshold is ordered by distance.
 *   7. The ranking RESPONDS to the book of business. A far city with customers can outrank a near
 *      one without — which is the whole difference between this and a static target-market list.
 *   8. Nothing is denominated in money, because nobody has asked Josue what an hour costs.
 *
 * It runs against migration 031's own schema, applied inside a transaction and rolled back, so it
 * is green before the migration is applied anywhere — the same trick as gates/visit-photos.mjs and
 * for the same reason.
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

const MIGRATION = 'migrations/031_where_the_zips_actually_are.sql';
const POPULATED = 'migrations/032_where_the_customers_actually_are.sql';

const out = compileServer();
const density = await import(`${process.cwd()}/${out}/server/lib/density.js`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const { driveMinutes, marginalDriveMinutes, customersForParity, miles, routeDensity, waitlistZips, geocoded, populatedCentres } = density;

// ---- A. the model's properties, on synthetic geometry, no database ------------------------
console.log('A. the closed form behaves like the closed form');
{
  const P = {
    depot: { lat: 34.2954755, lon: -119.2912215, source: 'gate' },
    circuity: 1.3, linehaulMph: 40, localMph: 22, bhhK: 0.75,
    referenceServiceMinutes: 15, referenceBasis: 'gate fixture', referenceTier: 'gate',
  };
  const near = { r: 8, A: 20 }, far = { r: 34, A: 20 }, sprawl = { r: 8, A: 200 };

  check(driveMinutes(0, far.r, far.A, P) === 0, 'an empty city costs no driving',
    'a model that charges 2r at n=0 gets the first-customer decision exactly backwards');

  const series = [1, 2, 4, 8, 16].map((n) => driveMinutes(n, near.r, near.A, P));
  check(series.every((v, i) => i === 0 || v > series[i - 1]), 'total driving rises with customers');
  const perStop = [1, 2, 4, 8, 16].map((n) => driveMinutes(n, near.r, near.A, P) / n);
  check(perStop.every((v, i) => i === 0 || v < perStop[i - 1]),
    'driving per customer falls with customers', perStop.map((v) => v.toFixed(0)).join(' > '));

  const marg = [0, 1, 2, 4, 8].map((n) => marginalDriveMinutes(n, near.r, near.A, P));
  check(marg.every((v, i) => i === 0 || v < marg[i - 1]),
    'each additional customer is cheaper than the last', marg.map((v) => v.toFixed(0)).join(' > '));

  check(marginalDriveMinutes(0, far.r, far.A, P) > marginalDriveMinutes(0, near.r, near.A, P),
    'distance makes the first customer dearer',
    `${marginalDriveMinutes(0, far.r, far.A, P).toFixed(0)} min at ${far.r}mi vs ${marginalDriveMinutes(0, near.r, near.A, P).toFixed(0)} at ${near.r}mi`);

  check(marginalDriveMinutes(4, sprawl.r, sprawl.A, P) > marginalDriveMinutes(4, near.r, near.A, P),
    'sprawl makes the marginal customer dearer at equal distance and count',
    'Daganzo: an elongated or larger region costs more at equal area density');

  const pNear = customersForParity(near.r, near.A, P, 20);
  const pFar = customersForParity(far.r, far.A, P, 20);
  check(pNear !== null && (pFar === null || pFar > pNear),
    'a further city needs more customers to reach parity',
    `${near.r}mi needs ${pNear}; ${far.r}mi needs ${pFar ?? 'more than a day holds'}`);

  // A threshold that never fires inside a day's capacity is a real answer and must be null, not
  // the cap — otherwise "this city cannot be a route day" reads as "this city needs 20".
  const veryFar = customersForParity(200, 400, P, 20);
  check(veryFar === null, 'a city a day cannot serve returns null rather than the cap',
    'null means "not as a standalone route day", which is a different sentence from "needs 20"');
}

// ---- B. the shipped readers, against 031's schema, rolled back -----------------------------
console.log('\nB. the real areas, the real rows');
{
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  try {
    await c.query(`set lock_timeout = '5s'`);
    await c.query('begin');

    const had = await geocoded(c);
    if (!had) {
      const before = await routeDensity(c);
      check(before.measured === false && /031/.test(before.note ?? ''),
        'with no coordinates, the board says unmeasured rather than guessing', before.note?.slice(0, 60));
      const body = readFileSync(MIGRATION, 'utf8')
        .replace(/^[ \t]*begin[ \t]*;[ \t]*$/gim, '').replace(/^[ \t]*commit[ \t]*;[ \t]*$/gim, '');
      await c.query(body);
    } else {
      ok('031 is already applied on this database');
    }

    /**
     * THE DEPOT'S OWN CITY MUST BE THE NEAREST CITY, and under 031 it is not.
     *
     * Run BEFORE 032 as well as after, because a gate that only ever sees the fixed state cannot
     * tell anyone it would have caught the bug.
     *
     * SAID PRECISELY, because the first version of this check overstated it and the numbers
     * corrected it. The 39.9-mile error is at ZIP level: ZCTA 93001 is Ventura plus the Channel
     * Islands and its internal point is in the ocean. The AREA called ventura averages several
     * ZIPs, so the offshore one is diluted to 10.4 miles rather than 40 — far enough to lose the
     * city its own top spot to Oak View, not far enough to look absurd on the board. That is the
     * more dangerous version of the fault, and it is what this asserts.
     */
    /**
     * REPRODUCE THE PRE-032 WORLD, WHATEVER THE DATABASE'S HISTORY. The first version of this
     * check simply read the board, which only shows the bug while 032 is unapplied — so the day
     * 032 was applied to the live database the check went red, not because the fix broke but
     * because the "before" it wanted no longer existed there. A gate that can only prove a fix on
     * a database that has not received it has a shelf life. So if 032 is present, its population
     * column is renamed out of sight INSIDE THIS TRANSACTION, the board is read on the polygon, and
     * the name is put back — all of it rolled back at the end either way.
     */
    const had032 = await populatedCentres(c);
    if (had032) await c.query(`alter table area_postal_codes rename column populated_lat to populated_lat_hidden_by_gate`);
    const before032 = await routeDensity(c);
    if (had032) await c.query(`alter table area_postal_codes rename column populated_lat_hidden_by_gate to populated_lat`);
    check(before032.geo_basis === 'polygon', 'the pre-032 board was really read on the polygon',
      `geo_basis=${before032.geo_basis}${had032 ? ' — 032 is applied here, so it was hidden for this read' : ''}`);
    const ventura031 = before032.areas.find((a) => a.slug === 'ventura');
    const nearest031 = before032.areas.reduce((a, b) => (a.depot_miles < b.depot_miles ? a : b));
    const { rows: [z93001] } = await c.query(
      `select 3958.8 * 2 * asin(sqrt(power(sin(radians(latitude - 34.2954755) / 2), 2)
              + cos(radians(34.2954755)) * cos(radians(latitude))
              * power(sin(radians(longitude - (-119.2912215)) / 2), 2))) as mi
         from area_postal_codes where postal_code = '93001'`);
    check(Number(z93001.mi) > 35,
      'BEFORE 032: ZIP 93001 — the depot’s own ZIP — sits ~40 miles out in the ocean',
      `${Number(z93001.mi).toFixed(1)}mi from a depot inside Ventura, because ZCTA 93001 includes the Channel Islands`);
    check(!!ventura031 && nearest031.slug !== 'ventura',
      'and the depot’s own city is therefore NOT the nearest area on the board',
      ventura031 ? `ventura ${ventura031.depot_miles}mi, beaten by ${nearest031.slug} at ${nearest031.depot_miles}mi — this is the bug, reproduced`
        : 'ventura missing');

    if (!(await populatedCentres(c))) {
      const popBody = readFileSync(POPULATED, 'utf8')
        .replace(/^[ \t]*begin[ \t]*;[ \t]*$/gim, '').replace(/^[ \t]*commit[ \t]*;[ \t]*$/gim, '');
      await c.query(popBody);
    }
    check(await populatedCentres(c) === true, '032 gives the ZIPs a population centre', 'applied in this transaction, rolled back');

    const board = await routeDensity(c);
    check(board.geo_basis === 'population',
      'and the board reads it rather than the polygon', `geo_basis=${board.geo_basis}`);

    const venturaNow = board.areas.find((a) => a.slug === 'ventura');
    const nearestNow = board.areas.reduce((a, b) => (a.depot_miles < b.depot_miles ? a : b));
    check(!!venturaNow && nearestNow.slug === 'ventura',
      'AFTER 032: the depot’s own city is the nearest city in the network',
      venturaNow ? `ventura ${venturaNow.depot_miles}mi (was ${ventura031.depot_miles}mi); nearest is ${nearestNow.slug}` : 'ventura missing');
    check(!!venturaNow && venturaNow.depot_miles < 5,
      'and it is a few miles away, not ten', `ventura ${venturaNow?.depot_miles}mi from a depot inside Ventura`);
    const { rows: [p93001] } = await c.query(
      `select 3958.8 * 2 * asin(sqrt(power(sin(radians(populated_lat - 34.2954755) / 2), 2)
              + cos(radians(34.2954755)) * cos(radians(populated_lat))
              * power(sin(radians(populated_lon - (-119.2912215)) / 2), 2))) as mi
         from area_postal_codes where postal_code = '93001'`);
    check(Number(p93001.mi) < 2, 'and ZIP 93001 comes ashore',
      `${Number(z93001.mi).toFixed(1)}mi -> ${Number(p93001.mi).toFixed(1)}mi`);

    check(board.measured === true && board.areas.length === 16,
      'every service area gets a number', `${board.areas.length} areas`);
    /**
     * EVERY `.every()` BELOW IS GUARDED BY A LENGTH. The first run of this gate reported
     * "every area has geometry — PASS" and "ordered cheapest first — PASS" while the board
     * contained ZERO areas, because `[].every(...)` is true. Two green checks over nothing, sat
     * directly beneath the red one that said `0 areas`. A check that cannot distinguish "all fine"
     * from "nothing there" is not a check.
     */
    check(board.areas.length === 16 && board.areas.every((a) => a.zips > 0 && a.area_sq_mi > 0 && a.depot_miles > 0),
      'every area has geometry', `${board.areas.length} areas, a null would silently read as "nobody there"`);

    // Cheapest-first IS the recommendation, so the ordering is part of the contract.
    const m = board.areas.map((a) => a.marginal_drive_minutes);
    check(m.length === 16 && m.every((v, i) => i === 0 || v >= m[i - 1]),
      'the board is ordered cheapest marginal customer first', `${m.length} values: ${m[0]}..${m[m.length - 1]} min`);

    // Ground it against the geography anyone can check on a map.
    const by = Object.fromEntries(board.areas.map((a) => [a.slug, a]));
    check(by.oxnard.depot_miles < by['santa-barbara'].depot_miles && by['santa-barbara'].depot_miles < 40,
      'the distances are the real ones',
      `oxnard ${by.oxnard.depot_miles}mi, santa-barbara ${by['santa-barbara'].depot_miles}mi, malibu ${by.malibu.depot_miles}mi`);
    check(by.oxnard.marginal_drive_minutes < by.malibu.marginal_drive_minutes,
      'a first customer in Oxnard is cheaper than a first customer in Malibu',
      `${by.oxnard.marginal_drive_minutes} min vs ${by.malibu.marginal_drive_minutes} min of driving, for ${board.parameters.referenceServiceMinutes} min of work`);

    // 8. no money anywhere
    check(board.areas.length === 16 && board.areas.every((a) => a.margin_per_visit.measured === false && a.margin_per_visit.value === null),
      'no area is given a dollar margin', 'nobody has asked Josue what his hour costs');
    const { rows: costRows } = await c.query(`select count(*)::int as n from settings where key like 'routing.cost_%'`);
    check(costRows[0].n === 0, 'and no cost row was seeded to make one possible',
      'the absence is the invariant, not an oversight');

    /**
     * 7. THE RANKING RESPONDS TO THE BOOK OF BUSINESS.
     *
     * This is the property that distinguishes the board from a list of cities sorted by distance,
     * and it is the one a reader would most reasonably doubt. Plant enough customers in the
     * FURTHEST city and its marginal customer must become cheaper than the nearest city's, which
     * has none. A distance-sorted list can never do that.
     */
     const furthest = board.areas.reduce((a, b) => (a.depot_miles > b.depot_miles ? a : b));
     const nearest = board.areas.reduce((a, b) => (a.depot_miles < b.depot_miles ? a : b));
     check(furthest.marginal_drive_minutes > nearest.marginal_drive_minutes,
       'before planting, the furthest city is the dearest', `${furthest.slug} ${furthest.marginal_drive_minutes} > ${nearest.slug} ${nearest.marginal_drive_minutes}`);

    const { rows: [z] } = await c.query(`select postal_code from area_postal_codes where area_slug = $1 limit 1`, [furthest.slug]);
    const { rows: [cust] } = await c.query(
      `insert into customers (name, email, phone) values ('GATE density', 'gate+density@example.invalid', '8055550002') returning id`);
    for (let i = 0; i < 12; i++) {
      const { rows: [prop] } = await c.query(
        `insert into properties (customer_id, address, city, postal_code) values ($1, $2, 'x', $3) returning id`,
        [cust.id, `${i} Gate Way`, z.postal_code]);
      await c.query(
        `insert into subscriptions (customer_id, property_id, service_slug, state, monthly_price_cents, source)
         values ($1, $2, 'weekly-pooper-scooper-service', 'active', 10000, 'online')`, [cust.id, prop.id]);
    }
    const after = await routeDensity(c);
    const f2 = after.areas.find((a) => a.slug === furthest.slug);
    const n2 = after.areas.find((a) => a.slug === nearest.slug);
    check(f2.customers_now === 12, 'the planted customers are counted against their ZIP',
      'joined through area_postal_codes, not through a typed city name');
    check(f2.marginal_drive_minutes < furthest.marginal_drive_minutes,
      'and the furthest city gets cheaper as it fills',
      `${furthest.slug}: ${furthest.marginal_drive_minutes} -> ${f2.marginal_drive_minutes} min`);
    check(f2.marginal_drive_minutes < n2.marginal_drive_minutes,
      'so a full far city now beats an empty near one',
      `${f2.slug} ${f2.marginal_drive_minutes} < ${n2.slug} ${n2.marginal_drive_minutes} — a distance-sorted list cannot express this`);
    check(f2.drive_minutes_per_visit_now !== null && n2.drive_minutes_per_visit_now === null,
      'and per-visit driving is reported only where there are visits',
      'a city with no customers has no driving per visit, which is not zero');

    // ---- the waitlist reader
    const wl = await waitlistZips(c);
    check(wl.measured === true && wl.zips.length === 21,
      'every known-and-not-served ZIP is ranked', `${wl.zips.length} ZIPs`);
    const wm = wl.zips.map((x) => x.depot_miles);
    check(wm.length === 21 && wm.every((v, i) => i === 0 || v >= wm[i - 1]), 'nearest first', `${wm.length} ZIPs, ${wm[0]}mi to ${wm[wm.length - 1]}mi`);
    /**
     * 93042, AND WHY IT NOW TAKES TWO NUMBERS.
     *
     * This check used to read "San Nicolas Island is still sixty miles out to sea" off
     * `depot_miles`, and it was right about the polygon. It was not a statement about customers:
     * the 2020 ZCTA also covers the Point Mugu end of the naval air station, and every one of
     * 93042's 1,075 residents lives there, sixteen miles from the depot. So the gate asserts BOTH
     * — the land is an island, the people are on the mainland — which is strictly more than it
     * checked before and is what the waitlist actually needs to know.
     */
    const island = wl.zips.find((x) => x.postal_code === '93042');
    check(!!island && island.polygon_miles > 50,
      'the waitlist can still tell an island from a suburb',
      island ? `93042's land is ${island.polygon_miles}mi out` : '93042 missing');
    check(!!island && island.depot_miles < 25,
      'and it ranks by where 93042’s people actually live, at Point Mugu',
      island ? `${island.depot_miles}mi for ${island.city_name}` : '93042 missing');

    // ---- negative controls
    console.log('\nnegative controls');
    const { rows: [{ n: nz }] } = await c.query(`select count(*)::int as n from area_postal_codes where latitude is null`);
    check(nz === 0, 'no served ZIP is missing a coordinate', 'a null would drop a city out of the board silently');
    await c.query(`alter table area_postal_codes drop column populated_lat`);
    check(await populatedCentres(c) === false, 'with a population column gone, populatedCentres() says so');
    const backToPolygon = await routeDensity(c);
    const v2 = backToPolygon.areas.find((a) => a.slug === 'ventura');
    const n3 = backToPolygon.areas.reduce((a, b) => (a.depot_miles < b.depot_miles ? a : b));
    check(backToPolygon.geo_basis === 'polygon' && n3.slug !== 'ventura' && v2.depot_miles > ventura031.depot_miles - 0.1,
      'and the bug comes straight back — so the check above is not a constant',
      `ventura ${v2.depot_miles}mi, nearest ${n3.slug} ${n3.depot_miles}mi`);

    await c.query(`alter table area_postal_codes drop column latitude`);
    check(await geocoded(c) === false, 'with a coordinate column gone, geocoded() says so');
    const gone = await routeDensity(c);
    check(gone.measured === false && gone.areas.length === 0,
      'and the board reports unmeasured rather than a stale answer',
      'so the measured=true above was not a constant');
  } catch (e) {
    no('the gate ran to the end', String(e.message ?? e));
  } finally {
    await c.query('rollback').catch(() => {});
    await c.end().catch(() => {});
    cleanupCompile();
  }
}

console.log(`\n${fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`}`);
process.exit(fail ? 1 : 0);
