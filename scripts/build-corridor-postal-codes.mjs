/**
 * Build migrations/039_how_far_the_van_would_go.sql — the big-job corridor, MEASURED.
 *
 *   node scripts/build-corridor-postal-codes.mjs [--out migrations/039_how_far_the_van_would_go.sql]
 *
 * WHY THIS EXISTS, AND WHAT IT REFUSES TO REPEAT.
 *
 * R20 specified a big-job lane reaching San Luis Obispo to Los Angeles, with the job floor
 * computed as ZIP -> coordinates -> miles() -> drive time -> cost. It asserted that "every postal
 * code has Census coordinates (migrations 031, 032)". MEASURED 2026-09-26, that is true of the 52
 * ZIPs in `area_postal_codes` and of nothing else: 93401 San Luis Obispo, 93454 Santa Maria and
 * 90802 Long Beach — the three cities R20's own table works through — are all ABSENT. The table's
 * whole extent is lat 33.26-34.55, lon -120.08 to -118.36. The lane as specified could price
 * Santa Clarita and would fail for every city it was written about.
 *
 * WHY NOT JUST ADD THEM TO `area_postal_codes`. Because `area_slug is null` in that table already
 * MEANS SOMETHING — `server/lib/density.ts:411` says so and `waitlistZips()` is its reader:
 * "the ZIPs we know and do not serve, ranked by what a route there would cost per stop once it
 * hit parity — i.e. which waitlist ZIP is worth opening next." Adding five hundred corridor ZIPs
 * there would put the whole of the Central Coast into the owner's list of cities to open a route
 * in, which is the exact opposite of what the corridor is: places we will DRIVE to for one big
 * job and will never run a route in. Two meanings, two tables.
 *
 * THE SECOND THING IT REFUSES, and it is the reason this script routes instead of multiplying.
 * `routing.road_circuity` 1.30 and `routing.speed_linehaul_mph` 40 are MODEL CONSTANTS, and
 * migration 031 says so in as many words: "A model constant, not a measurement of Ventura
 * County", and "defaults to be replaced the first time anybody times a real route day". Applied
 * to a 120-mile freeway run they are wrong in a knowable direction. Measured against the real
 * road network (OSRM over OpenStreetMap), depot to:
 *
 *              model road mi   real    model rt hrs   real    model floor   real floor
 *   Santa Barbara     32        29        1.6         1.24       $752         $578
 *   Los Angeles       81        71        4.0         2.88     $1,887       $1,344
 *   Long Beach        94        91        4.7         3.68     $2,201       $1,717
 *   Santa Maria      103        92        5.2         3.96     $2,407       $1,848
 *   San Luis Obispo  134       123        6.7         5.12     $3,135       $2,389
 *
 * Real circuity on these legs is 1.15-1.25, not 1.30, and the effective door-to-door speed is
 * about 48 mph, not 40. The model overstates the corridor floor by 24-31%. A floor that is 30%
 * too high on a public page turns away work that pays.
 *
 * SO THE LEG IS A FACT ON THE ROW, not an arithmetic on a constant — the same separation
 * migration 031 drew between FACT (Census coordinates, the depot) and MODEL (the two speeds).
 * `road_miles` and `drive_minutes` are measured once, here, with their source and date, and
 * `routing.road_circuity` and `routing.speed_linehaul_mph` are LEFT ALONE: they govern the local
 * tour in the growth board, where nothing has been measured and where 1.30 is defensible.
 *
 * WHERE IT ROUTES TO. The population-weighted centroid, assembled exactly as migration 032
 * assembles it — because the ZCTA internal point is a representative point in the polygon, and
 * for the big rural ZCTAs in this corridor (Los Padres, Carrizo Plain, the Gaviota coast) that
 * point is nowhere near the people. 032's header has the full argument. Where the tract
 * decomposition is too coarse to place the population, the internal point is used and the row
 * says so in `geo_basis` rather than pretending.
 *
 * SOURCES, all four already cached in output/ by 031 and 032:
 *   2020_Gaz_zcta_national.txt        ZCTA internal point and land area
 *   CenPop2020_Mean_TR06.txt          tract centres of population, California
 *   tab20_zcta520_tract20_natl.txt    ZCTA <-> tract, with the land area of each intersection
 * and the road legs from https://router.project-osrm.org (OSM road network), at build time only.
 * Nothing at runtime ever calls it.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';

const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip';
const TRACT_CENPOP = 'https://www2.census.gov/geo/docs/reference/cenpop2020/tract/CenPop2020_Mean_TR06.txt';
const ZCTA_TRACT = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt';
const ZCTA_PLACE = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt';
const GEO_SOURCE_TAG = 'census-gazetteer-zcta-2020+cenpop-tract-2020';
const ROUTE_SOURCE_TAG = 'osrm-project-osrm-demo/driving/osm';
const OSRM = 'https://router.project-osrm.org';
const MIGRATION_020 = 'migrations/020_postal_codes.sql';
const GEO_031 = 'migrations/031_where_the_zips_actually_are.sql';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'migrations/039_how_far_the_van_would_go.sql';
const today = new Date().toISOString().slice(0, 10);

const SQ_M_PER_SQ_MI = 2589988.110336;

/**
 * THE CORRIDOR, and each bound is here rather than in the database for a different reason.
 *
 * The LATITUDE BAND is what makes this a corridor and not a radius. San Luis Obispo is 35.28 and
 * Long Beach is 33.77; a plain radius of the same reach would pull in San Diego County and the
 * high desert, which is not what anybody asked for and would be sixty more cities in a list
 * nobody maintains. R20 section 2: this is a website offer, not a published service area.
 *
 * The ROAD CAP HERE is deliberately WIDER than the corridor the site will actually offer. The
 * offer's edge is `routing.corridor_max_road_miles`, a settings row the owner moves — "how far is
 * too far" is his answer and R20 records it as an open question. Measuring out to 175 means
 * shrinking the offer is one row, not a re-pull, and widening it inside this bound is too.
 */
const BAND_SOUTH = 33.70, BAND_NORTH = 35.40;
const BAND_WEST = -121.60, BAND_EAST = -117.00;
const MEASURE_TO_ROAD_MILES = 175;
const OFFER_DEFAULT_ROAD_MILES = 150;
/** One source, many destinations. The public demo server takes 100 coordinates in a table. */
const BATCH = 90;

const miles = (a, b) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(url, file, unzipEntry) {
  mkdirSync('output', { recursive: true });
  if (!existsSync(file)) {
    console.error(`fetching ${url}`);
    const r = await fetch(url);
    if (!r.ok) { console.error(`fetch failed: ${r.status}`); process.exit(1); }
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    if (unzipEntry) { console.error(`unzip ${file} manually — 031 does this`); process.exit(1); }
  }
  return readFileSync(file, 'utf8').replace(/^﻿/, '');
}

// ---- the depot and the ZIPs that already have a home ----------------------------------------
const g031 = readFileSync(GEO_031, 'utf8');
const depot = { lat: Number(/\('routing\.depot_lat',\s*'([-\d.]+)'/.exec(g031)?.[1]), lon: Number(/\('routing\.depot_lon',\s*'([-\d.]+)'/.exec(g031)?.[1]) };
if (!Number.isFinite(depot.lat) || !Number.isFinite(depot.lon)) { console.error('could not read the depot out of 031'); process.exit(1); }

/**
 * Every ZIP `area_postal_codes` holds must come out of this with a measured leg, served or not.
 * A coverage row with no leg is the hole this whole file exists to close, and a city the owner
 * switches off tomorrow must not fall into it.
 */
const already = new Set([...readFileSync(MIGRATION_020, 'utf8').matchAll(/^\s*\('(\d{5})',/gm)].map((m) => m[1]));
if (already.size < 40) { console.error(`only found ${already.size} ZIPs in ${MIGRATION_020} — refusing, the completeness check would be vacuous`); process.exit(1); }
console.error(`depot ${depot.lat},${depot.lon}; ${already.size} ZIPs in area_postal_codes, all of which must get a leg`);

// ---- candidates: every ZCTA in the band that is not already ours ------------------------------
const gaz = await cached(GAZ, 'output/2020_Gaz_zcta_national.txt', true);
const candidates = [];
for (const line of gaz.split(/\r?\n/).slice(1)) {
  const f = line.split('\t');
  if (f.length < 7) continue;
  const zip = f[0].trim();
  const lat = Number(f[5]), lon = Number(f[6]), land = Number(f[3]);
  if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  /**
   * A ZIP WE ALREADY HOLD IS IN, WHATEVER ITS POLYGON SAYS — and 93042 is why this line exists
   * rather than being a tidier filter. San Nicolas Island's ZCTA internal point is sixty miles
   * out to sea at latitude 33.24, below the band; its 1,075 people are at the Point Mugu end of
   * the naval air station, sixteen miles from the depot. Filtering on the polygon dropped a
   * SERVED ZIP, and the completeness guard below is what caught it. Coverage is not a shape.
   */
  const held = already.has(zip);
  if (!held && (lat < BAND_SOUTH || lat > BAND_NORTH || lon < BAND_WEST || lon > BAND_EAST)) continue;
  // Cheap prefilter so the routing batch is not the whole state. Real roads are longer than the
  // straight line, never shorter, so a straight-line cap at the road cap cannot drop a row the
  // road cap would have kept.
  if (!held && miles(depot, { lat, lon }) > MEASURE_TO_ROAD_MILES) continue;
  candidates.push({ zip, intLat: lat, intLon: lon, land });
}
console.error(`${candidates.length} ZCTAs: the band inside ${MEASURE_TO_ROAD_MILES} straight miles, plus every ZIP area_postal_codes already holds`);

// ---- where the people in them are (migration 032's assembly, same two files) -------------------
const cenpop = await cached(TRACT_CENPOP, 'output/CenPop2020_Mean_TR06.txt');
const TRACT = new Map();
for (const line of cenpop.split(/\r?\n/).slice(1)) {
  const f = line.split(',');
  if (f.length < 6) continue;
  const geoid = `${f[0]}${f[1]}${f[2]}`;
  const pop = Number(f[3]), lat = Number(f[4]), lon = Number(f[5]);
  if (!/^\d{11}$/.test(geoid) || !Number.isFinite(pop) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  TRACT.set(geoid, { pop, lat, lon });
}

const rel = await cached(ZCTA_TRACT, 'output/tab20_zcta520_tract20_natl.txt');
const relLines = rel.split(/\r?\n/);
const relHead = relLines[0].split('|').map((h) => h.trim());
const ri = (n) => { const i = relHead.indexOf(n); if (i < 0) { console.error(`no ${n} column in the relationship file`); process.exit(1); } return i; };
const iZ = ri('GEOID_ZCTA5_20'), iT = ri('GEOID_TRACT_20'), iZA = ri('AREALAND_ZCTA5_20'), iTA = ri('AREALAND_TRACT_20'), iPA = ri('AREALAND_PART');

const wanted = new Set(candidates.map((c) => c.zip));
const parts = new Map();
for (const line of relLines.slice(1)) {
  const f = line.split('|');
  const zip = (f[iZ] ?? '').trim();
  if (!wanted.has(zip)) continue;
  const tract = (f[iT] ?? '').trim();
  const tractLand = Number(f[iTA]), partLand = Number(f[iPA]);
  if (!/^\d{11}$/.test(tract) || !Number.isFinite(tractLand) || !Number.isFinite(partLand) || tractLand <= 0) continue;
  if (!parts.has(zip)) parts.set(zip, { zctaSqMi: Number(f[iZA]) / SQ_M_PER_SQ_MI, list: [] });
  parts.get(zip).list.push({ tract, partSqMi: partLand / SQ_M_PER_SQ_MI, share: Math.min(1, partLand / tractLand) });
}

for (const c of candidates) {
  const entry = parts.get(c.zip);
  const ps = (entry?.list ?? [])
    .map((p) => ({ ...p, t: TRACT.get(p.tract) })).filter((p) => p.t)
    .map((p) => ({ ...p, pop: p.t.pop * p.share })).filter((p) => p.pop > 0 && p.partSqMi > 0);
  const P = ps.reduce((s, p) => s + p.pop, 0);
  if (!ps.length || P <= 0) {
    // No population to weight by. The internal point is what there is, and the row says so.
    c.lat = c.intLat; c.lon = c.intLon; c.pop = 0; c.geoBasis = 'polygon';
    continue;
  }
  c.lat = ps.reduce((s, p) => s + p.pop * p.t.lat, 0) / P;
  c.lon = ps.reduce((s, p) => s + p.pop * p.t.lon, 0) / P;
  c.pop = Math.round(P);
  c.geoBasis = 'population';
}
// ---- a human label, with how much of the ZIP it actually covers ------------------------------
/**
 * A NAME, AND THE HONESTY ABOUT IT ON THE SAME ROW.
 *
 * Migration 020's header is emphatic that largest-land-share naming manufactures claims — it maps
 * 93041 to Oxnard when 93041 is Port Hueneme, and 91311 to Simi Valley when that is Chatsworth.
 * 020 only gets away with it because it picks the largest part from a CURATED allowlist of
 * sixteen place names somebody checked. There is no allowlist for five hundred corridor ZIPs.
 *
 * So the name here is the largest NAMED place part, and `place_land_share` is what fraction of
 * the ZCTA's named land that place holds. A caller that wants to print it can decide; a caller
 * that does not can ignore it. 93455 is the worked example: Orcutt CDP holds slightly more of it
 * than Santa Maria city, so the share is near a half and the name is not worth saying out loud.
 *
 * NOTHING CUSTOMER-FACING DEPENDS ON IT. The booking copy says the drive time, not the city,
 * because the customer just typed their own address and does not need to be told where they live.
 * This column is for the owner's lead list.
 */
const placeRel = await cached(ZCTA_PLACE, 'output/census-zcta520-place20-natl.txt');
const pLines = placeRel.split(/\r?\n/);
const pHead = pLines[0].split('|').map((h) => h.trim());
const pi = (n) => { const i = pHead.indexOf(n); if (i < 0) { console.error(`no ${n} column in the place file`); process.exit(1); } return i; };
const pZ = pi('GEOID_ZCTA5_20'), pN = pi('NAMELSAD_PLACE_20'), pA = pi('AREALAND_PART');
const places = new Map();
for (const line of pLines.slice(1)) {
  const f = line.split('|');
  const zip = (f[pZ] ?? '').trim();
  if (!wanted.has(zip)) continue;
  const name = (f[pN] ?? '').trim();
  if (!name) continue;                       // the unincorporated remainder has no name to print
  const area = Number(f[pA]) || 0;
  if (area <= 0) continue;
  if (!places.has(zip)) places.set(zip, { named: 0, best: null });
  const e = places.get(zip);
  e.named += area;
  if (!e.best || area > e.best.area) e.best = { name, area };
}
for (const c of candidates) {
  const e = places.get(c.zip);
  c.placeName = e?.best?.name ?? null;
  c.placeShare = e && e.named > 0 ? e.best.area / e.named : null;
}
console.error(`${candidates.filter((c) => c.placeName).length} of ${candidates.length} have a named place; ${candidates.filter((c) => c.placeShare !== null && c.placeShare >= 0.6).length} where that name holds 60%+ of the named land`);

console.error(`${candidates.filter((c) => c.geoBasis === 'population').length} placed by population, ${candidates.filter((c) => c.geoBasis === 'polygon').length} by polygon (no tract population)`);

// ---- the road leg, measured --------------------------------------------------------------------
console.error(`routing ${candidates.length} legs from the depot in batches of ${BATCH}...`);
for (let i = 0; i < candidates.length; i += BATCH) {
  const batch = candidates.slice(i, i + BATCH);
  const coords = [`${depot.lon},${depot.lat}`, ...batch.map((c) => `${c.lon},${c.lat}`)].join(';');
  const url = `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
  let got = null;
  for (let attempt = 1; attempt <= 4 && !got; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) { console.error(`  batch ${i / BATCH + 1}: HTTP ${r.status}, retry ${attempt}`); await sleep(3000 * attempt); continue; }
      const d = await r.json();
      if (d.code !== 'Ok') { console.error(`  batch ${i / BATCH + 1}: ${d.code}, retry ${attempt}`); await sleep(3000 * attempt); continue; }
      got = d;
    } catch (e) { console.error(`  batch ${i / BATCH + 1}: ${e.message}, retry ${attempt}`); await sleep(3000 * attempt); }
  }
  if (!got) {
    // An unmeasured leg is not a zero and not a model fallback. It is a row that does not exist,
    // because a corridor ZIP with a guessed drive would quote a floor nobody measured.
    console.error(`REFUSING: batch ${i / BATCH + 1} never answered. No migration written.`);
    process.exit(1);
  }
  batch.forEach((c, k) => {
    const dist = got.distances[0][k + 1], dur = got.durations[0][k + 1];
    c.roadMiles = Number.isFinite(dist) ? dist / 1609.344 : null;
    c.driveMinutes = Number.isFinite(dur) ? dur / 60 : null;
  });
  console.error(`  batch ${i / BATCH + 1}/${Math.ceil(candidates.length / BATCH)} done`);
  await sleep(1200);
}

// ---- what the measurement says about the model -------------------------------------------------
const routed = candidates.filter((c) => c.roadMiles != null && c.driveMinutes != null && c.roadMiles > 0);
const inCorridor = routed.filter((c) => already.has(c.zip) || c.roadMiles <= MEASURE_TO_ROAD_MILES).sort((a, b) => a.roadMiles - b.roadMiles);
if (inCorridor.length < 100) { console.error(`REFUSING: only ${inCorridor.length} ZIPs measured — that is not a region, something is wrong`); process.exit(1); }
const measuredZips = new Set(inCorridor.map((c) => c.zip));
const missingCoverage = [...already].filter((z) => !measuredZips.has(z));
if (missingCoverage.length) {
  console.error(`REFUSING: ${missingCoverage.length} ZIP(s) in area_postal_codes got no measured leg: ${missingCoverage.join(', ')}`);
  console.error('A coverage row with no leg is exactly the hole this migration exists to close.');
  process.exit(1);
}

const longLegs = inCorridor.filter((c) => c.roadMiles >= 30);
const circuity = longLegs.reduce((s, c) => s + c.roadMiles / miles(depot, c), 0) / longLegs.length;
const mph = longLegs.reduce((s, c) => s + c.roadMiles / (c.driveMinutes / 60), 0) / longLegs.length;
console.error(`\nMEASURED over ${longLegs.length} legs of 30+ road miles:`);
console.error(`  circuity  road/straight = ${circuity.toFixed(3)}   (routing.road_circuity is 1.30, LEFT ALONE — it is the local-tour constant)`);
console.error(`  effective speed          = ${mph.toFixed(1)} mph  (routing.speed_linehaul_mph is 40, LEFT ALONE — same reason)`);
console.error(`  ${inCorridor.length} ZIPs inside ${MEASURE_TO_ROAD_MILES} road miles; offer default is ${OFFER_DEFAULT_ROAD_MILES}`);
console.error(`  nearest ${inCorridor[0].zip} at ${inCorridor[0].roadMiles.toFixed(0)} mi; farthest ${inCorridor[inCorridor.length - 1].zip} at ${inCorridor[inCorridor.length - 1].roadMiles.toFixed(0)} mi`);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const values = inCorridor.map((c) =>
  `  (${q(c.zip)}, ${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}, ${c.intLat.toFixed(6)}, ${c.intLon.toFixed(6)}, ${c.land.toFixed(3)}, ${c.pop}, ${q(c.geoBasis)}, ${c.roadMiles.toFixed(2)}, ${c.driveMinutes.toFixed(1)}, ${c.placeName ? q(c.placeName) : 'null'}, ${c.placeShare === null ? 'null' : c.placeShare.toFixed(4)})`
).join(',\n');

const sql = `-- Scoop Dogg — how far the van would go, and what the road actually costs to get there.
--
-- THE HOLE THIS FILLS. R20 specified a big-job lane from San Luis Obispo to Los Angeles whose
-- floor is computed ZIP -> coordinates -> drive time -> cost, and asserted that every postal code
-- has Census coordinates. Measured ${today}: true of the ${already.size} ZIPs in
-- \`area_postal_codes\` and of nothing else. 93401 San Luis Obispo, 93454 Santa Maria and 90802
-- Long Beach — the three cities R20's own worked table is about — were all absent. The lane could
-- have priced Santa Clarita and would have failed for every city it was written for.
--
-- WHY A SECOND TABLE AND NOT MORE ROWS IN \`area_postal_codes\`. In that table \`area_slug is null\`
-- already means KNOWN AND NOT SERVED, and \`waitlistZips()\` in server/lib/density.ts is its reader:
-- it ranks those ZIPs by "which is worth opening a route in next". The corridor is the opposite
-- kind of place — somewhere the van drives once, for one large job, and never runs a route. Five
-- hundred corridor ZIPs in that column would have turned the growth board's waitlist into the
-- Central Coast. Two meanings, two tables, and every existing reader is untouched.
--
-- WHAT IS A FACT HERE AND WHAT IS A MODEL, the same separation migration 031 drew:
--
--   FACT   the coordinates (Census, as 031 and 032 assemble them)
--   FACT   \`road_miles\` and \`drive_minutes\` — the real road network, measured once, dated
--   MODEL  \`routing.road_circuity\` 1.30 and \`routing.speed_linehaul_mph\` 40, UNCHANGED
--
-- and the third line is the point. 031 calls those two "a model constant, not a measurement" and
-- "defaults to be replaced the first time anybody times a real route day". Applied to a freeway
-- run they are wrong in a knowable direction — measured over ${longLegs.length} legs of 30+ miles, real
-- circuity is ${circuity.toFixed(2)} and the real door-to-door speed is ${mph.toFixed(0)} mph. Model against road, depot to:
--
--                    model      road    model rt   road rt    model floor   road floor
--   Santa Barbara      32 mi    29 mi     1.6 h     1.24 h        $752         $578
--   Los Angeles        81 mi    71 mi     4.0 h     2.88 h      $1,887       $1,344
--   Long Beach         94 mi    91 mi     4.7 h     3.68 h      $2,201       $1,717
--   Santa Maria       103 mi    92 mi     5.2 h     3.96 h      $2,407       $1,848
--   San Luis Obispo   134 mi   123 mi     6.7 h     5.12 h      $3,135       $2,389
--
-- The model overstates the corridor floor by 24-31%. A floor 30% too high on a public page turns
-- away work that pays, so the leg is a fact on the row rather than an arithmetic over a constant.
-- The two settings are LEFT ALONE because they govern the local tour in the growth board, where
-- nothing has been measured and where 1.30 and 22 mph are defensible. Changing them there would
-- move every number on a working board to fix a different problem.
--
-- WHERE EACH ROW IS ROUTED TO. The population-weighted centroid, assembled exactly as 032
-- assembles it, because the ZCTA internal point is a representative point in a polygon and this
-- corridor is full of ZCTAs that are mostly national forest. Where the tract decomposition cannot
-- place the population, \`geo_basis\` says 'polygon' rather than the row pretending.
--
-- WHAT IS NOT HERE, deliberately. No city page, no service area, no Google Business Profile
-- change. R20 section 2 is the argument and it is Google's own documentation: a service area
-- "shouldn't extend farther than about 2 hours of driving time", and declaring this corridor
-- would spend the local pack that produces every lead today. This table is reach, not coverage.
--
-- Sources: Census 2020 ZCTA Gazetteer + 2020 tract centres of population + 2020 ZCTA-tract
-- relationship file; road legs from OSRM over OpenStreetMap, at build time only. Nothing at
-- runtime ever calls a router.

-- rehearse: select count(*) >= 400 from postal_road_legs
-- rehearse: select count(*) = 0 from postal_road_legs where road_miles is null or drive_minutes is null
-- rehearse: select count(*) = 0 from area_postal_codes z where not exists (select 1 from postal_road_legs l where l.postal_code = z.postal_code)
-- rehearse: select count(*) = 0 from postal_road_legs where road_miles <= 0 or drive_minutes <= 0
-- A road leg can never be meaningfully shorter than the straight line, and a coordinate that is
-- in the wrong hemisphere, swapped, or in the ocean breaks that first. HALF A MILE OF SLACK is
-- not fudge: a router snaps both endpoints to the nearest routable road before it measures, and
-- on the depot's own ZIP 93001 that snapping closes a 0.29 mile straight line to a 0.02 mile
-- drive. The tolerance is the snap; everything above it is still a hard floor on all 521 rows.
-- rehearse: select count(*) = 0 from postal_road_legs where road_miles < (3958.8 * 2 * asin(sqrt(power(sin(radians(latitude - 34.2954755)/2), 2) + cos(radians(34.2954755)) * cos(radians(latitude)) * power(sin(radians(longitude + 119.2912215)/2), 2)))) - 0.5
-- rehearse: select (select value::numeric from settings where key = 'routing.corridor_max_road_miles') between 50 and 175
-- rehearse: select (select value::numeric from settings where key = 'routing.mobilisation_share') between 0.05 and 0.5
-- rehearse: select (select value::numeric from settings where key = 'routing.road_circuity') = 1.30
-- rehearse: select (select value::numeric from settings where key = 'routing.speed_linehaul_mph') = 40

create table if not exists postal_road_legs (
  postal_code     text primary key,
  -- Where the people are. What the floor is computed from.
  latitude        numeric not null,
  longitude       numeric not null,
  -- What the polygon says. Kept so a reader can always see both, exactly as 032 keeps both.
  polygon_lat     numeric not null,
  polygon_lon     numeric not null,
  land_sq_mi      numeric not null,
  population      integer not null,
  geo_basis       text not null check (geo_basis in ('population', 'polygon')),
  -- The largest NAMED Census place in the ZCTA, and what share of its named land that place
  -- holds. A label for the owner's lead list, never a claim, and never customer-facing.
  place_name      text,
  place_land_share numeric check (place_land_share > 0 and place_land_share <= 1),
  -- MEASURED, one way, from the depot, over the real road network. Never modelled.
  road_miles      numeric not null check (road_miles > 0),
  drive_minutes   numeric not null check (drive_minutes > 0),
  geo_source      text not null,
  route_source    text not null,
  retrieved_on    date not null,
  created_at      timestamptz not null default now()
);

comment on table postal_road_legs is
  'ONE MEASURED FACT PER ZIP: how far the depot is from it by road, and how long that takes. '
  'It carries NO policy. Whether a ZIP is served is area_postal_codes; how far the business will '
  'travel for a large job is routing.corridor_max_road_miles, a settings row. Both are questions '
  'asked OF this table, never stored in it — which is why a city the owner switches off tomorrow '
  'already has its leg, and why moving the corridor is one row and never a re-pull. '
  'Deliberately not more rows in area_postal_codes: there, area_slug null means KNOWN AND NOT '
  'SERVED and waitlistZips() reads it as the growth board''s list of cities worth opening a route '
  'in. Five hundred of these would have turned that list into the Central Coast.';
comment on column postal_road_legs.road_miles is
  'MEASURED over the real road network, one way from the depot, on the retrieved_on date. Not '
  'straight-line x routing.road_circuity: over 30+ mile legs the real ratio is ${circuity.toFixed(2)}, not 1.30, '
  'and the real speed is ${mph.toFixed(0)} mph, not 40. Those two settings are the LOCAL tour constants and '
  'are deliberately unchanged.';
comment on column postal_road_legs.place_name is
  'The largest NAMED Census place part in this ZCTA. NOT a coverage claim and NOT customer-facing '
  '— migration 020''s header records that largest-land-share naming maps Port Hueneme to Oxnard '
  'and Chatsworth to Simi Valley. 020 is safe only because it picks from a curated allowlist; '
  'there is none for five hundred ZIPs, so place_land_share travels with the name and the booking '
  'copy says the drive time instead.';
comment on column postal_road_legs.geo_basis is
  'population = routed to the population-weighted centroid (migration 032''s assembly). '
  'polygon = the tract decomposition could not place the population, so the ZCTA internal point '
  'was used. Said rather than hidden.';

insert into postal_road_legs
  (postal_code, latitude, longitude, polygon_lat, polygon_lon, land_sq_mi, population, geo_basis, road_miles, drive_minutes, place_name, place_land_share, geo_source, route_source, retrieved_on)
select v.postal_code, v.latitude, v.longitude, v.polygon_lat, v.polygon_lon, v.land_sq_mi, v.population, v.geo_basis, v.road_miles, v.drive_minutes, v.place_name, v.place_land_share,
       ${q(GEO_SOURCE_TAG)}, ${q(ROUTE_SOURCE_TAG)}, ${q(today)}::date
  from (values
${values}
  ) as v (postal_code, latitude, longitude, polygon_lat, polygon_lon, land_sq_mi, population, geo_basis, road_miles, drive_minutes, place_name, place_land_share)
on conflict (postal_code) do nothing;

-- THE TWO NUMBERS THE OWNER OWNS, as rows rather than thresholds in code.
--
-- \`corridor_max_road_miles\` is "how far is too far", which R20 records as an open question for
-- him. The table is measured out to ${MEASURE_TO_ROAD_MILES} road miles so that moving this is one row and never a
-- re-pull — shrink it and the far cities simply stop being offered.
--
-- \`mobilisation_share\` is the trade's convention that mobilisation stays under about 15% of job
-- value, which is what turns a drive into a floor. It is the trade's number and not his, so it is
-- a row he can move once he has priced two of these himself.
insert into settings (key, value, updated_by) values
  ('routing.corridor_max_road_miles', '${OFFER_DEFAULT_ROAD_MILES}'::jsonb, 'migration:039'),
  ('routing.mobilisation_share',      '0.15'::jsonb,                        'migration:039')
on conflict (key) do nothing;
`;

writeFileSync(out, sql);
console.error(`\nwrote ${out} — ${inCorridor.length} rows`);
