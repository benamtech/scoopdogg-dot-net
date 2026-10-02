/**
 * Build migrations/031_where_the_zips_actually_are.sql from a primary source.
 *
 *   node scripts/build-postal-geo.mjs [--out migrations/031_where_the_zips_actually_are.sql]
 *
 * Migration 020 answered WHICH ZIPs are on a route. This answers WHERE THEY ARE, which is the
 * fact the route economics need and the one nothing on this project has ever held.
 *
 * Every row here is geography from the US Census Bureau's 2020 ZCTA Gazetteer — the internal
 * point (a representative coordinate inside the ZCTA) and its land area in square miles — with
 * the source URL and pull date recorded on the row, exactly as 020 does.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: invent a coordinate for a ZIP the Gazetteer does not have,
 * and touch the `area_slug` column. Coverage is Josue's claim and lives in 020; this script only
 * ever adds geometry to rows that already exist. If the Gazetteer is missing one of them it says
 * so and writes nothing, because a null coordinate would silently drop that ZIP out of every
 * density calculation downstream and look like "no customers there".
 *
 * THE DEPOT IS A SEPARATE KIND OF FACT and it is in the migration rather than here: Google's own
 * placement of Scoop Dogg, read out of the Maps link Josue's site publishes. See the migration.
 *
 * Nothing here touches the database. It writes SQL, which is rehearsed like any other migration.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SOURCE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip';
const SOURCE_TAG = 'census-gazetteer-zcta-2020';
const CACHE_ZIP = 'output/2020_Gaz_zcta_national.zip';
const CACHE_TXT = 'output/2020_Gaz_zcta_national.txt';
const MIGRATION = 'migrations/020_postal_codes.sql';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'migrations/031_where_the_zips_actually_are.sql';
const today = new Date().toISOString().slice(0, 10);

// ---- the ZIPs this business has rows for, read from 020 rather than retyped ----------------
const mig = readFileSync(MIGRATION, 'utf8');
const zips = [...mig.matchAll(/^\s*\('(\d{5})',\s*(null|'[a-z-]+')/gm)]
  .map((m) => ({ zip: m[1], area: m[2] === 'null' ? null : m[2].slice(1, -1) }));
if (zips.length < 40) { console.error(`only found ${zips.length} ZIPs in ${MIGRATION} — refusing`); process.exit(1); }
console.error(`${zips.length} ZIPs in ${MIGRATION} (${zips.filter((z) => z.area).length} served)`);

// ---- the Gazetteer -------------------------------------------------------------------------
mkdirSync('output', { recursive: true });
if (!existsSync(CACHE_TXT)) {
  if (!existsSync(CACHE_ZIP)) {
    console.error(`fetching ${SOURCE}`);
    const r = await fetch(SOURCE);
    if (!r.ok) { console.error(`fetch failed: ${r.status}`); process.exit(1); }
    writeFileSync(CACHE_ZIP, Buffer.from(await r.arrayBuffer()));
  }
  // `unzip -p` rather than a zip reader in here: the file is a plain single-entry archive and a
  // hand-rolled inflate would be more code than the thing it serves.
  writeFileSync(CACHE_TXT, execFileSync('unzip', ['-p', CACHE_ZIP], { maxBuffer: 64 * 1024 * 1024 }));
}
const txt = readFileSync(CACHE_TXT, 'latin1');
const lines = txt.split(/\r?\n/).filter(Boolean);
const head = lines[0].split('\t').map((h) => h.trim());
const col = (name) => { const i = head.indexOf(name); if (i < 0) { console.error(`no ${name} column`); process.exit(1); } return i; };
const iGeo = col('GEOID'), iLat = col('INTPTLAT'), iLon = col('INTPTLONG'), iLand = col('ALAND_SQMI');

const G = new Map();
for (const l of lines.slice(1)) {
  const f = l.split('\t');
  const zip = (f[iGeo] ?? '').trim();
  if (!/^\d{5}$/.test(zip)) continue;
  const lat = Number((f[iLat] ?? '').trim()), lon = Number((f[iLon] ?? '').trim()), land = Number((f[iLand] ?? '').trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(land)) continue;
  G.set(zip, { lat, lon, land });
}
console.error(`${G.size} ZCTAs in the Gazetteer`);

const missing = zips.filter((z) => !G.has(z.zip));
if (missing.length) {
  console.error(`REFUSING: the Gazetteer has no row for ${missing.map((m) => m.zip).join(', ')}.`);
  console.error('A null coordinate would drop that ZIP out of every density calculation and read as "nobody there".');
  process.exit(1);
}

/**
 * Sanity, because a unit error in a coordinate is invisible in SQL and fatal downstream: every
 * ZIP ON A ROUTE must land inside a box around the Southern California coast.
 *
 * SERVED ONLY, and the first run of this script is why. It refused on 93042 at 33.26,-119.50 —
 * which is correct geography: 93042 is San Nicolas Island, sixty miles out to sea, and migration
 * 020's own header names it as one of the three ZIPs that make deriving coverage from land area a
 * mistake. It is in the table as KNOWN AND NOT SERVED, which is the right row, and its real
 * coordinate is worth having: it is how the waitlist can tell an island from a suburb.
 *
 * So the box is a check on the business's own service claim, not on the Census. A not-served ZIP
 * outside the box is reported and kept.
 */
const BOX = { lat: [33.5, 35.2], lon: [-120.7, -118.0] };
const inBox = (g) => g.lat >= BOX.lat[0] && g.lat <= BOX.lat[1] && g.lon >= BOX.lon[0] && g.lon <= BOX.lon[1];
const servedOutside = zips.filter((z) => z.area && !inBox(G.get(z.zip)));
if (servedOutside.length) {
  console.error(`REFUSING: ${servedOutside.map((z) => `${z.zip} (${z.area}) at ${G.get(z.zip).lat},${G.get(z.zip).lon}`).join('; ')} is on a route and outside the region box.`);
  process.exit(1);
}
const farAfield = zips.filter((z) => !z.area && !inBox(G.get(z.zip)));
if (farAfield.length) {
  console.error(`note: ${farAfield.length} known-not-served ZIP(s) sit outside the box and are kept: `
    + farAfield.map((z) => `${z.zip} at ${G.get(z.zip).lat.toFixed(3)},${G.get(z.zip).lon.toFixed(3)}`).join(', '));
}

const rows = zips.map(({ zip }) => {
  const g = G.get(zip);
  return `  ('${zip}', ${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}, ${g.land.toFixed(3)})`;
}).join(',\n');

const sql = `-- Scoop Dogg — where the ZIPs actually are, so route density can stop being a feeling.
--
-- GENERATED by scripts/build-postal-geo.mjs on ${today}. Do not hand-edit: re-run the script.
--
-- Source: ${SOURCE}
-- (US Census Bureau, 2020 ZCTA Gazetteer. Internal point and land area, ${zips.length} rows matched.)
--
-- WHY THIS EXISTS. Migration 020 answered WHICH ZIPs are on a route and made the funnel's first
-- question answerable from rows. It could not answer the question underneath it: what it COSTS to
-- serve one. Nothing on this project has ever held a coordinate, so nothing on this project could
-- tell the difference between a customer four miles away and one thirty-four miles away.
--
-- That difference is not small and it is not linear. The Beardwood-Halton-Hammersley result, and
-- Daganzo's distribution form of it, give the length of a good route through n stops scattered in
-- an area A at distance r from the depot as roughly
--
--     distance  ~=  2r  +  k * sqrt(n * A)
--
-- so the DRIVING PER STOP is (2r + k*sqrt(nA)) / n, which falls like 1/n in the line-haul term
-- and like 1/sqrt(n) in the local one. The consequence is the whole reason for this migration:
-- the cost of serving a city is a function of how many customers are already in it, so "where
-- should the next customer come from" has an arithmetic answer, and the answer changes as the
-- book of business changes. server/lib/density.ts is that arithmetic.
--
-- WHAT IS A FACT HERE AND WHAT IS A MODEL, kept apart on purpose:
--
--   FACT     the coordinates and land areas below (Census, with the URL and the date)
--   FACT     the depot, from Google's own placement of Scoop Dogg (see below)
--   MODEL    the two speeds and the circuity factor, which are defaults with reasons
--   UNKNOWN  what an hour of Josue's time and a mile of his van cost. NOT SEEDED, deliberately.
--
-- The last line is the one that matters. It would be easy to put a plausible \$25/hour in a row
-- and start printing dollar margins per city, and every one of them would be a number about a
-- business nobody asked. So \`routing.cost_per_hour_cents\` is absent, density.ts reports
-- \`measured: false\` for anything denominated in money, and the output that needs no cost at all
-- — DRIVING MINUTES PER VISIT, against the service minutes already recorded on every tier — is
-- the number the admin shows. It is enough to rank cities, which is the decision.
--
-- THE DEPOT. Josue's site links his Google Maps place from the footer and every /areas page; that
-- link resolves to \`@34.2954755,-119.2912215\`, which is Google's own placement of the business.
-- It is the best-evidenced origin available without asking him where he keeps the van, and when he
-- says, it is one row. \`node scripts/derive-place-id.mjs\` prints the same resolution.

-- rehearse: select count(*) = ${zips.length} from area_postal_codes where latitude is not null and longitude is not null
-- rehearse: select count(*) = 0 from area_postal_codes where latitude is null
-- rehearse: select count(*) = 0 from area_postal_codes where area_slug is not null and (latitude not between ${BOX.lat[0]} and ${BOX.lat[1]} or longitude not between ${BOX.lon[0]} and ${BOX.lon[1]})
-- rehearse: select count(*) = 0 from area_postal_codes where land_sq_mi is null or land_sq_mi <= 0
-- rehearse: select count(*) = 0 from area_postal_codes where geo_source <> '${SOURCE_TAG}'
-- rehearse: select count(*) = 3 from settings where key in ('routing.depot_lat', 'routing.depot_lon', 'routing.road_circuity')
-- rehearse: select count(*) = 0 from settings where key = 'routing.cost_per_hour_cents'
-- rehearse: select (select value::numeric from settings where key = 'routing.depot_lat') between ${BOX.lat[0]} and ${BOX.lat[1]}
-- rehearse: select (select value::numeric from settings where key = 'routing.road_circuity') between 1.0 and 2.0

begin;

alter table area_postal_codes
  add column latitude         numeric(9, 6),
  add column longitude        numeric(9, 6),
  add column land_sq_mi       numeric(10, 3),
  add column geo_source       text,
  add column geo_retrieved_on date;

comment on column area_postal_codes.latitude is
  'Census internal point: a representative coordinate INSIDE the ZCTA, not a population centroid '
  'and not a mailing address. Good enough to rank cities by distance, not good enough to route a '
  'van between two houses.';

update area_postal_codes z
   set latitude = g.lat, longitude = g.lon, land_sq_mi = g.land,
       geo_source = '${SOURCE_TAG}', geo_retrieved_on = '${today}'
  from (values
${rows}
       ) as g(zip, lat, lon, land)
 where z.postal_code = g.zip;

-- Every existing row got geometry, or this migration is wrong about its own source.
do $$
declare n int;
begin
  select count(*) into n from area_postal_codes where latitude is null;
  if n > 0 then raise exception 'area_postal_codes: % rows have no coordinate', n; end if;
end $$;

alter table area_postal_codes
  alter column latitude   set not null,
  alter column longitude  set not null,
  alter column land_sq_mi set not null,
  alter column geo_source set not null;

insert into settings (key, value, updated_by) values
  -- Google's own placement of the business, from the Maps link the site already publishes.
  ('routing.depot_lat',      '34.2954755'::jsonb,                    'migration:031'),
  ('routing.depot_lon',      '-119.2912215'::jsonb,                  'migration:031'),
  ('routing.depot_source',   '"google-maps-place:ChIJx2f0lVCt6YARL_qslmyUQKM"'::jsonb, 'migration:031'),
  -- Road distance / straight-line distance. 1.2-1.4 is the usual range for US metros; 1.3 is the
  -- middle of it. A model constant, not a measurement of Ventura County.
  ('routing.road_circuity',  '1.30'::jsonb,                          'migration:031'),
  -- Depot-to-area and stop-to-stop. Both are defaults to be replaced the first time anybody
  -- times a real route day, which is the point of writing them down as rows.
  ('routing.speed_linehaul_mph', '40'::jsonb,                        'migration:031'),
  ('routing.speed_local_mph',    '22'::jsonb,                        'migration:031'),
  -- The BHH/Daganzo local-tour constant. 0.7124 is the asymptotic value for an optimal tour over
  -- uniformly scattered points; 0.75 leaves a little room for a route that is good, not optimal.
  ('routing.bhh_k',              '0.75'::jsonb,                      'migration:031')
on conflict (key) do nothing;

-- DELIBERATELY NOT SEEDED: routing.cost_per_hour_cents, routing.cost_per_mile_cents.
-- Nobody has asked Josue what his hour or his mile costs. Until somebody does, density.ts
-- reports every money figure as unmeasured and ranks on time instead.

commit;
`;

writeFileSync(out, sql);
console.error(`wrote ${out} — ${zips.length} rows`);
