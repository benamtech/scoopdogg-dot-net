/**
 * Build migrations/032_where_the_customers_actually_are.sql from two primary sources.
 *
 *   node scripts/build-postal-centroids.mjs [--out migrations/032_where_the_customers_actually_are.sql]
 *
 * WHAT WENT WRONG, MEASURED. Migration 031 gave every ZIP the Census ZCTA **internal point** — a
 * representative coordinate inside the polygon, which is all it claims to be, and its own column
 * comment says so in the migration. `server/lib/density.ts` then used it as the place the
 * customers are. For a compact suburb those are nearly the same point. For ZCTA 93001 they are
 * not: 93001 is Ventura **plus the Channel Islands**, 205.2 square miles of it, so its internal
 * point sits at 34.0586, -119.9291 — in the ocean, 39.9 miles from a depot that is inside
 * Ventura. The growth board therefore ranked the depot's own city as the most expensive place in
 * the network to serve one more customer, and the `where_next` recommendation is exactly the
 * thing that number drives.
 *
 * Ojai 93023 has the same fault from the mountains (270.1 sq mi), Goleta 93117 from Gaviota
 * (170.1), Santa Barbara 93105 from the back country (97.1), Malibu 90265 from the canyons
 * (107.8). The guard could not catch any of them: it checked longitude between -120.7 and -118,
 * a box containing the open Pacific.
 *
 * AND THE AREA IS WRONG FOR THE SAME REASON, which matters just as much and is easier to miss.
 * The Beardwood-Halton-Hammersley term in density.ts is `k * sqrt(n * A)` — the local tour
 * through n stops scattered across area A. The stops are scattered where the PEOPLE are, not
 * across the polygon: 93001's people occupy a narrow coastal strip, not 205 square miles of
 * island and water. Feeding the polygon's area in overstates the local driving by sqrt(205/15),
 * about 3.7x, for every city with an empty half.
 *
 * SO THIS SCRIPT COMPUTES BOTH, FROM POPULATION:
 *
 *   populated_lat/lon   the population-weighted centroid — where the customers could be
 *   populated_sq_mi     the area that population actually occupies (see below)
 *
 * THE TWO SOURCES, both US Census Bureau, both recorded on the row:
 *
 *   A. 2020 Centers of Population by census tract, California
 *      cenpop2020/tract/CenPop2020_Mean_TR06.txt — population and the population-weighted
 *      centre of each tract. This is the Census's own measure of where people are, not a
 *      polygon centre.
 *   B. 2020 ZCTA-to-Census-Tract Relationship File
 *      rel2020/zcta520/tab20_zcta520_tract20_natl.txt — which tracts intersect which ZCTA, and
 *      the land area of each intersection.
 *
 * There is no published centre of population for ZCTAs — `cenpop2020/` carries state, county,
 * tract and block group and stops there — which is why this is assembled rather than downloaded.
 *
 * THE ONE APPROXIMATION, named rather than buried. A tract wholly inside a ZCTA contributes its
 * whole population at its own centre of population, and that is exact. A tract that straddles the
 * boundary is split by LAND AREA — `AREALAND_PART / AREALAND_TRACT` — because nothing finer is
 * published at this level. So the error is areal apportionment WITHIN a straddling tract, which
 * is second order: for 93001 the Channel Islands tracts carry almost no population at all, so
 * they fall out by weight rather than by any rule this script applies to them.
 *
 * POPULATED AREA, and why it is not invented. Census's own "population-weighted density" is the
 * density the average resident experiences: d = sum(p_i * p_i/a_i) / sum(p_i). The area that
 * density implies for the whole population is A = sum(p_i) / d = sum(p_i)^2 / sum(p_i^2/a_i).
 * For a uniformly populated ZIP it returns the land area unchanged; for one with an empty half it
 * returns the populated half. It is a restatement of the Census measure, not a new constant.
 *
 * WHAT IT DOES NOT TOUCH: `latitude`, `longitude` and `land_sq_mi` from 031 stay exactly as they
 * are. They are the correct answer to a different question and the migration keeps both, so a
 * reader can always see what the polygon says and what the population says.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';

const TRACT_CENPOP = 'https://www2.census.gov/geo/docs/reference/cenpop2020/tract/CenPop2020_Mean_TR06.txt';
const ZCTA_TRACT = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt';
const SOURCE_TAG = 'census-cenpop-tract-2020+zcta-tract-rel-2020';
const MIGRATION = 'migrations/020_postal_codes.sql';
const GEO_031 = 'migrations/031_where_the_zips_actually_are.sql';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'migrations/032_where_the_customers_actually_are.sql';
const today = new Date().toISOString().slice(0, 10);

const SQ_M_PER_SQ_MI = 2589988.110336;

/**
 * The absolute refusal bound. Santa Clarita 91390 and Goleta 93117 are the far ends of the
 * network Josue publishes /areas pages for, and both are inside 60 miles of the depot by road.
 * 70 is generous enough not to argue with a real coverage decision and tight enough that a sign
 * error, a swapped lat/lon or an ocean coordinate cannot survive it — the box it replaces
 * contained 120 miles of open Pacific.
 *
 * THIS IS NOT THE TIGHT CHECK. `gates/route-density.mjs` holds that one: the depot's own city
 * must rank nearest in the served network. A bound wide enough to allow the real business is
 * always wide enough to allow some wrong answers, so the ordering is what actually pins it.
 */
const MAX_SERVED_MILES = 70;

const miles = (a, b) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
};

async function cached(url, file) {
  mkdirSync('output', { recursive: true });
  if (!existsSync(file)) {
    console.error(`fetching ${url}`);
    const r = await fetch(url);
    if (!r.ok) { console.error(`fetch failed: ${r.status}`); process.exit(1); }
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(file, 'utf8').replace(/^﻿/, '');
}

// ---- the ZIPs this business has rows for, read from 020 rather than retyped ----------------
const mig = readFileSync(MIGRATION, 'utf8');
const zips = [...mig.matchAll(/^\s*\('(\d{5})',\s*(null|'[a-z-]+')/gm)]
  .map((m) => ({ zip: m[1], area: m[2] === 'null' ? null : m[2].slice(1, -1) }));
if (zips.length < 40) { console.error(`only found ${zips.length} ZIPs in ${MIGRATION} — refusing`); process.exit(1); }

// The depot, read out of migration 031 rather than retyped. One fact, one home.
const depotLat = Number(/\('routing\.depot_lat',\s*'([-\d.]+)'/.exec(readFileSync(GEO_031, 'utf8'))?.[1]);
const depotLon = Number(/\('routing\.depot_lon',\s*'([-\d.]+)'/.exec(readFileSync(GEO_031, 'utf8'))?.[1]);
if (!Number.isFinite(depotLat) || !Number.isFinite(depotLon)) { console.error('could not read the depot out of 031'); process.exit(1); }
const depot = { lat: depotLat, lon: depotLon };

// What 031 recorded, so the migration can print the correction rather than only the answer.
const internal = new Map([...readFileSync(GEO_031, 'utf8').matchAll(/^\s*\('(\d{5})',\s*([-\d.]+),\s*([-\d.]+),\s*([\d.]+)\)/gm)]
  .map((m) => [m[1], { lat: Number(m[2]), lon: Number(m[3]), land: Number(m[4]) }]));

console.error(`${zips.length} ZIPs in ${MIGRATION} (${zips.filter((z) => z.area).length} served); depot ${depot.lat},${depot.lon}`);

// ---- A. tract centres of population, California --------------------------------------------
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
console.error(`${TRACT.size} California tracts with a centre of population`);

// ---- B. which tracts are in which ZCTA, and how much of each ---------------------------------
const rel = await cached(ZCTA_TRACT, 'output/tab20_zcta520_tract20_natl.txt');
const relLines = rel.split(/\r?\n/);
const relHead = relLines[0].split('|').map((h) => h.trim());
const ri = (n) => { const i = relHead.indexOf(n); if (i < 0) { console.error(`no ${n} column in the relationship file`); process.exit(1); } return i; };
const iZ = ri('GEOID_ZCTA5_20'), iT = ri('GEOID_TRACT_20'), iZA = ri('AREALAND_ZCTA5_20'), iTA = ri('AREALAND_TRACT_20'), iPA = ri('AREALAND_PART');

const wanted = new Set(zips.map((z) => z.zip));
const parts = new Map();   // zip -> [{tract, landPartSqMi, share}]
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
console.error(`${parts.size} of ${zips.length} ZIPs matched at least one tract part`);

// ---- the arithmetic --------------------------------------------------------------------------
const rows = [];
const problems = [];
for (const { zip, area } of zips) {
  const entry = parts.get(zip);
  const zctaSqMi = entry?.zctaSqMi ?? null;
  const ps = (entry?.list ?? [])
    .map((p) => ({ ...p, t: TRACT.get(p.tract) }))
    .filter((p) => p.t)
    .map((p) => ({ ...p, pop: p.t.pop * p.share }))
    .filter((p) => p.pop > 0 && p.partSqMi > 0);

  const P = ps.reduce((s, p) => s + p.pop, 0);
  if (!ps.length || P <= 0) { problems.push({ zip, area, why: 'no tract part with population' }); continue; }

  const lat = ps.reduce((s, p) => s + p.pop * p.t.lat, 0) / P;
  const lon = ps.reduce((s, p) => s + p.pop * p.t.lon, 0) / P;
  /**
   * Census population-weighted density, inverted into the area that population occupies.
   *
   * AND THE RESOLUTION CHECK THAT DECIDES WHETHER IT MEANS ANYTHING. A = sum(p)^2/sum(p^2/a) can
   * only see concentration that the tract decomposition can see. Where one tract part IS the
   * ZCTA — 93040 is 372 square miles of back country covered by a single part of one 974 sq mi
   * tract — the formula returns that part's area and has learned nothing: it cannot tell 1,309
   * people in a village from 1,309 people spread over the county. Writing the number anyway would
   * be a measurement-shaped guess, so it is NULL there and density.ts falls back to land area.
   *
   * COARSE means one part supplying 90% or more of the ZCTA's land. The number is a resolution
   * threshold rather than a model constant, and the thing that removes the need for it is finer
   * input: 2020 block-group centres of population exist (cenpop2020/blkgrp/) and the missing
   * piece is a block-group-to-ZCTA map, which the Census publishes only at block level in a 1 GB
   * national file. That is the measurement that closes this, and it is written down in the
   * migration rather than left as a comment nobody finds.
   */
  const biggest = Math.max(...ps.map((p) => p.partSqMi));
  const coarse = zctaSqMi ? biggest / zctaSqMi >= 0.9 : true;
  const popArea = coarse ? null : (P * P) / ps.reduce((s, p) => s + (p.pop * p.pop) / p.partSqMi, 0);

  const was = internal.get(zip);
  rows.push({
    zip, area, lat, lon, pop: Math.round(P), popArea, zctaSqMi, coarse, tracts: ps.length,
    dNow: miles(depot, { lat, lon }),
    dWas: was ? miles(depot, was) : null,
    landWas: was?.land ?? null,
  });
}

if (problems.length) {
  const served = problems.filter((p) => p.area);
  console.error(`${problems.length} ZIP(s) produced no populated centre: ${problems.map((p) => `${p.zip}${p.area ? ` (${p.area})` : ''}`).join(', ')}`);
  if (served.length) {
    console.error('REFUSING: a ZIP ON A ROUTE has no population to weight by. A null here would silently');
    console.error('drop that city out of every density calculation and read as "nobody there".');
    process.exit(1);
  }
  console.error('  all of them are known-and-not-served, so they keep their 031 coordinate and are skipped.');
}

// ---- the guards ------------------------------------------------------------------------------
const tooFar = rows.filter((r) => r.area && r.dNow > MAX_SERVED_MILES);
if (tooFar.length) {
  console.error(`REFUSING: ${tooFar.map((r) => `${r.zip} (${r.area}) at ${r.dNow.toFixed(1)} mi`).join('; ')} is on a route and beyond ${MAX_SERVED_MILES} miles of the depot.`);
  process.exit(1);
}

const served = rows.filter((r) => r.area).sort((a, b) => a.dNow - b.dNow);
const nearest = served[0], farthest = served[served.length - 1];
let span = 0, spanPair = null;
for (const a of served) for (const b of served) { const d = miles(a, b); if (d > span) { span = d; spanPair = [a, b]; } }

console.error(`\nnearest served: ${nearest.zip} ${nearest.area} at ${nearest.dNow.toFixed(1)} mi (was ${nearest.dWas?.toFixed(1)})`);
console.error(`farthest served: ${farthest.zip} ${farthest.area} at ${farthest.dNow.toFixed(1)} mi (was ${farthest.dWas?.toFixed(1)})`);
console.error(`network span: ${span.toFixed(1)} mi between ${spanPair[0].zip} and ${spanPair[1].zip}`);
console.error('\nthe ten biggest corrections:');
for (const r of [...rows].filter((r) => r.dWas !== null).sort((a, b) => Math.abs(b.dNow - b.dWas) - Math.abs(a.dNow - a.dWas)).slice(0, 10)) {
  console.error(`  ${r.zip} ${(r.area ?? '—').padEnd(14)} ${r.dWas.toFixed(1).padStart(5)} -> ${r.dNow.toFixed(1).padStart(5)} mi   2010 land ${r.landWas.toFixed(1).padStart(6)} / 2020 ${(r.zctaSqMi ?? 0).toFixed(1).padStart(6)} -> populated ${(r.popArea === null ? 'coarse' : r.popArea.toFixed(1)).padStart(6)} sq mi   pop ${String(r.pop).padStart(6)}`);
}

// ---- the migration ---------------------------------------------------------------------------
const values = rows.map((r) =>
  `  ('${r.zip}', ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}, ${r.popArea === null ? 'null' : r.popArea.toFixed(3)}, ${r.zctaSqMi === null ? 'null' : r.zctaSqMi.toFixed(3)}, ${r.pop}, ${r.tracts})`).join(',\n');
const coarseCount = rows.filter((r) => r.coarse).length;
const coarseServed = rows.filter((r) => r.coarse && r.area);

const sql = `-- Scoop Dogg — where the CUSTOMERS are, which is not where the polygon is.
--
-- GENERATED by scripts/build-postal-centroids.mjs on ${today}. Do not hand-edit: re-run the script.
--
-- Sources, both US Census Bureau, 2020:
--   ${TRACT_CENPOP}
--   ${ZCTA_TRACT}
--
-- WHAT 031 GOT WRONG, AND IT SAID SO ITSELF. Migration 031 wrote the ZCTA internal point and gave
-- the column this comment: "a representative coordinate INSIDE the ZCTA, not a population
-- centroid and not a mailing address". server/lib/density.ts then used it as where the customers
-- are. For a compact suburb that is nearly true. For ZCTA 93001 — Ventura PLUS the Channel
-- Islands, 205.2 sq mi — the internal point lands at 34.0586,-119.9291, in the ocean, and put the
-- depot's own city ${internal.get('93001') ? miles(depot, internal.get('93001')).toFixed(1) : '39.9'} miles from a depot that is inside it. The growth board's
-- "where should the next customer come from" ranked Ventura as the most expensive city in the
-- network to serve. Ojai 93023 (270.1 sq mi) had it from the mountains, Goleta 93117 (170.1) from
-- Gaviota, Santa Barbara 93105 (97.1) from the back country, Malibu 90265 (107.8) from the canyons.
--
-- THE AREA WAS WRONG THE SAME WAY, and that is half the error. density.ts scatters n stops across
-- area A in the Beardwood-Halton-Hammersley term k*sqrt(n*A). Stops are scattered where the PEOPLE
-- are. Using the polygon's land area overstates the local driving by sqrt(A_polygon / A_populated)
-- — about 3.7x for 93001 — in every city with an empty half.
--
-- SO THERE ARE TWO NEW COLUMNS AND THE OLD ONES ARE UNTOUCHED. \`latitude\`, \`longitude\` and
-- \`land_sq_mi\` remain exactly what 031 wrote: the correct answer to "where is this polygon and
-- how big is it". The new columns answer "where are the people in it and how much ground do they
-- cover", and a reader can see both and tell which one a number came from.
--
--   populated_lat/lon  population-weighted centroid of the tract centres of population in the ZCTA
--   populated_sq_mi    the area that population occupies, from the Census's own population-weighted
--                      density d = sum(p*p/a)/sum(p), inverted: A = sum(p)^2 / sum(p^2/a)
--   population         the apportioned 2020 count, so a reader can see what the weight was
--
-- THE ONE APPROXIMATION, named. A tract wholly inside a ZCTA contributes all of its population at
-- its own centre of population, and that is exact. A tract straddling the boundary is split by
-- land area (AREALAND_PART / AREALAND_TRACT), because nothing finer is published at this level.
-- The residual error is areal apportionment inside a straddling tract, and it is second order:
-- the Channel Islands tracts fall out of 93001 by carrying almost no people, not by any rule.
--
-- WHAT THIS DOES NOT CLAIM. It is not a routing geocode. It is the centre of where customers can
-- be, which is what ranks cities; it is not good enough to drive a van between two houses, and
-- density.ts has never claimed otherwise.
--
-- MEASURED ON GENERATION (${today}):
--   nearest served   ${nearest.zip} ${nearest.area} at ${nearest.dNow.toFixed(1)} mi (031 said ${nearest.dWas.toFixed(1)})
--   farthest served  ${farthest.zip} ${farthest.area} at ${farthest.dNow.toFixed(1)} mi (031 said ${farthest.dWas.toFixed(1)})
--   network span     ${span.toFixed(1)} mi, ${spanPair[0].zip} to ${spanPair[1].zip} (031's figure was 73.1)

-- rehearse: select count(*) = ${rows.length} from area_postal_codes where populated_lat is not null and populated_lon is not null
-- rehearse: select count(*) = 0 from area_postal_codes where area_slug is not null and populated_lat is null
-- rehearse: select count(*) = 0 from area_postal_codes where populated_sq_mi is not null and populated_sq_mi <= 0
-- rehearse: select count(*) = 0 from area_postal_codes where populated_sq_mi is not null and zcta2020_sq_mi is not null and populated_sq_mi > zcta2020_sq_mi * 1.001
-- rehearse: select count(*) = ${coarseCount} from area_postal_codes where populated_lat is not null and populated_sq_mi is null
-- rehearse: select count(*) = 0 from area_postal_codes where population is not null and population < 0
-- rehearse: select count(*) = 0 from area_postal_codes where populated_geo_source is not null and populated_geo_source <> '${SOURCE_TAG}'
-- rehearse: select count(*) = 0 from area_postal_codes where area_slug is not null and 3958.8 * 2 * asin(sqrt(power(sin(radians(populated_lat - ${depot.lat}) / 2), 2) + cos(radians(${depot.lat})) * cos(radians(populated_lat)) * power(sin(radians(populated_lon - (${depot.lon})) / 2), 2))) > ${MAX_SERVED_MILES}
-- rehearse: select 3958.8 * 2 * asin(sqrt(power(sin(radians(populated_lat - ${depot.lat}) / 2), 2) + cos(radians(${depot.lat})) * cos(radians(populated_lat)) * power(sin(radians(populated_lon - (${depot.lon})) / 2), 2))) < 8 from area_postal_codes where postal_code = '93003'

begin;

alter table area_postal_codes
  add column populated_lat        numeric(9, 6),
  add column populated_lon        numeric(9, 6),
  add column populated_sq_mi      numeric(10, 3),
  add column zcta2020_sq_mi       numeric(10, 3),
  add column population           integer,
  add column populated_tracts     integer,
  add column populated_geo_source text,
  add column populated_retrieved_on date;

comment on column area_postal_codes.populated_lat is
  'Population-weighted centroid: where the PEOPLE in this ZCTA are, assembled from Census tract '
  'centres of population. Use this for anything that models where customers are. \`latitude\` is '
  'the polygon''s internal point and is a different fact — 93001''s is in the ocean.';
comment on column area_postal_codes.populated_sq_mi is
  'The area that population occupies, from the Census population-weighted density inverted: '
  'sum(p)^2 / sum(p^2/a). This is the A in the BHH local-tour term, because stops are scattered '
  'where people are and not across the polygon. \`land_sq_mi\` is the whole polygon and for 93001 '
  'is 205.2 against a populated ${rows.find((r) => r.zip === '93001')?.popArea.toFixed(1) ?? '?'}.';

update area_postal_codes z
   set populated_lat = g.lat, populated_lon = g.lon, populated_sq_mi = g.area,
       zcta2020_sq_mi = g.zcta_area, population = g.pop, populated_tracts = g.tracts,
       populated_geo_source = '${SOURCE_TAG}', populated_retrieved_on = '${today}'
  from (values
${values}
       ) as g(zip, lat, lon, area, zcta_area, pop, tracts)
 where z.postal_code = g.zip;

-- Every ZIP ON A ROUTE got a populated centre, or this migration is wrong about its own source.
-- A not-served ZIP may legitimately have none: 93042 is San Nicolas Island.
do $$
declare n int;
begin
  select count(*) into n from area_postal_codes where area_slug is not null and populated_lat is null;
  if n > 0 then raise exception 'area_postal_codes: % served rows have no populated centre', n; end if;
end $$;

commit;
`;

writeFileSync(out, sql);
console.error(`\nwrote ${out} — ${rows.length} rows`);
