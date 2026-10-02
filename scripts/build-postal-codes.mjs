/**
 * Build migrations/020_postal_codes.sql from a primary source.
 *
 *   node scripts/build-postal-codes.mjs [--out migrations/020_postal_codes.sql]
 *
 * P16 §2. The funnel's first question becomes a ZIP, and the answer has to come from rows rather
 * than from the 30-entry constant hardcoded at BookingFlow.tsx:49 — which has no provenance, no
 * server-side reader, and holes that each send a real household to "somewhere else".
 *
 * TWO SOURCES, AND THE SPLIT BETWEEN THEM IS THE POINT.
 *
 *   WHICH ZIPS ARE SERVED is a claim about Josue's business, and only he can make it. The set
 *   below is the one his own site has claimed for years (the constant at BookingFlow.tsx:49).
 *   It is copied here as a claim, tagged as one, and the admin's "Where you work" checklist is
 *   where it changes.
 *
 *   WHERE THOSE ZIPS ARE, and which other ZIPs exist around them, is a fact, and it comes from
 *   the Census Bureau's 2020 ZCTA-to-place relationship file with its URL and pull date on every
 *   row.
 *
 * Deriving coverage from the geography instead was tried first and it manufactures claims in
 * both directions: largest-land-share maps 93041 to Oxnard (93041 is Port Hueneme, a city of its
 * own), 91311 to Simi Valley (that is Chatsworth, over the hill in Los Angeles) and 93042 to
 * Oxnard (San Nicolas Island, sixty miles offshore). Each of those would have told real
 * households they are on a route. A ZCTA is a set of delivery routes, not a shape, and no
 * arithmetic over land area turns it into a service area.
 *
 * A ZIP WE KNOW AND DO NOT SERVE GETS A ROW TOO, with area_slug null. P19 §4: that row is a
 * growth asset, not a lookup miss. It is what lets the site say "we're not on a route in 93012
 * yet" instead of shrugging, and it is what turns a waitlist into evidence about where the next
 * route day should go.
 *
 * Nothing here touches the database. It writes SQL, which is rehearsed like any other migration.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';

const SOURCE = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt';
const SOURCE_TAG = 'census-zcta520-place20-rel2020';
const CACHE = 'output/census-zcta520-place20-natl.txt';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'migrations/020_postal_codes.sql';

// The 16 areas we serve, by the Census's own place name. Ventura is the awkward one: its legal
// name is San Buenaventura and nobody in Ventura says that.
const SERVED = {
  'San Buenaventura (Ventura) city': 'ventura',
  'Ojai city': 'ojai',
  'Oak View CDP': 'oak-view',
  'Oxnard city': 'oxnard',
  'Camarillo city': 'camarillo',
  'Santa Paula city': 'santa-paula',
  'Thousand Oaks city': 'thousand-oaks',
  'Newbury Park CDP': 'newbury-park',
  'Moorpark city': 'moorpark',
  'Simi Valley city': 'simi-valley',
  'Santa Barbara city': 'santa-barbara',
  'Westlake Village city': 'westlake-village',
  'Malibu city': 'malibu',
  'Fillmore city': 'fillmore',
  'Agoura Hills city': 'agoura-hills',
  'Carpinteria city': 'carpinteria',
  // UNINCORPORATED COMMUNITIES THAT ARE THE AREA, in local terms and in the post office's.
  // 93023 is the Ojai ZIP; the Census splits it between Ojai city, Mira Monte CDP and Meiners
  // Oaks CDP, and Mira Monte holds the most land. Nobody in Mira Monte says they live in Mira
  // Monte to a scooping service - the whole ZIP is "Ojai", and these places are not cities with
  // an identity of their own to misrepresent.
  //
  // THIS IS NOT THE SAME MOVE AS CALLING PORT HUENEME "OXNARD", and the difference is the whole
  // reason both cases are written down. Port Hueneme is an incorporated city; mapping its ZIP to
  // a city we serve would tell those households they are on a route, which is a claim about
  // Josue's business nobody has made.
  'Mira Monte CDP': 'ojai',
  'Meiners Oaks CDP': 'ojai',
};

// THE BUSINESS'S CLAIM: the ZIPs scoopdogg.net has told the public it serves. Copied verbatim
// from ZIP_CITY in src/components/booking/BookingFlow.tsx, which this migration retires. Nothing
// is added to it here and nothing is taken away - widening or narrowing a service area is Josue's
// decision, and the screen for it is the onboarding checklist (P18 §2, item 5).
const SERVED_ZIPS = {
  '93001': 'ventura', '93003': 'ventura', '93004': 'ventura',
  '93030': 'oxnard', '93033': 'oxnard', '93035': 'oxnard', '93036': 'oxnard',
  '93010': 'camarillo', '93012': 'camarillo',
  '93023': 'ojai', '93022': 'oak-view', '93060': 'santa-paula', '93015': 'fillmore',
  '93021': 'moorpark', '93063': 'simi-valley', '93065': 'simi-valley',
  '91360': 'thousand-oaks', '91362': 'thousand-oaks', '91320': 'newbury-park',
  '91361': 'westlake-village', '91301': 'agoura-hills',
  '90265': 'malibu', '90263': 'malibu',
  '93101': 'santa-barbara', '93103': 'santa-barbara', '93105': 'santa-barbara',
  '93108': 'santa-barbara', '93109': 'santa-barbara', '93110': 'santa-barbara', '93111': 'santa-barbara',
  '93013': 'carpinteria',
};
const CLAIM_TAG = 'business-claim:scoopdogg-service-area';

// WHERE OUR AREA LIST IS FINER THAN THE CENSUS'S PLACE LIST.
//
// This is not local knowledge overruling the source; it is reconciling two different questions.
// The Census answers "which incorporated place is this ZCTA in", and by that answer Newbury Park
// is part of Thousand Oaks city and 91361 is shared between Thousand Oaks and Westlake Village.
// `service_areas` answers "which route does this belong to", and it lists Newbury Park and
// Westlake Village separately because that is how the business and its customers talk about them.
// Each row below carries its own source tag, so a reader can see exactly which rows came from a
// file and which came from the business's own map.

// Known, and not served. Each of these is a household that types its ZIP today and is told
// "somewhere else" (P16 §2). Whether Josue serves Port Hueneme and Oak Park is HIS answer, in
// the admin - the site's job is to know the difference between not served and never heard of.
const NEARBY = [
  'Port Hueneme city', 'Oak Park CDP', 'Somis CDP', 'Piru CDP', 'Summerland CDP',
  'Santa Susana CDP', 'Casa Conejo CDP', 'Lake Sherwood CDP',
  'El Rio CDP', 'Saticoy CDP', 'Channel Islands Beach CDP', 'Montecito CDP', 'Goleta city',
  'Santa Clarita city', 'Calabasas city', 'Hidden Hills city', 'Ventura County', 'Ojai Valley',
];

async function source() {
  if (existsSync(CACHE)) return readFileSync(CACHE, 'utf8');
  process.stdout.write(`  fetching ${SOURCE}\n`);
  const res = await fetch(SOURCE, { headers: { 'User-Agent': 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)' } });
  if (!res.ok) throw new Error(`census ${res.status}`);
  const text = await res.text();
  mkdirSync('output', { recursive: true });
  writeFileSync(CACHE, text);
  return text;
}

const text = await source();
const lines = text.split('\n');
const header = lines[0].replace(/^﻿/, '').split('|');
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const need of ['GEOID_ZCTA5_20', 'GEOID_PLACE_20', 'NAMELSAD_PLACE_20', 'AREALAND_PART']) {
  if (col[need] === undefined) throw new Error(`the Census file has no ${need} column - its format changed`);
}

/** For each ZIP: the CA place sharing the most land with it, out of the places we care about. */
const best = new Map();
let scanned = 0;
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split('|');
  const zip = (f[col.GEOID_ZCTA5_20] ?? '').trim();
  const placeId = (f[col.GEOID_PLACE_20] ?? '').trim();
  if (!/^\d{5}$/.test(zip) || !placeId.startsWith('06')) continue;   // 06 = California
  const name = (f[col.NAMELSAD_PLACE_20] ?? '').trim();
  const relevant = SERVED[name] !== undefined || NEARBY.includes(name) || SERVED_ZIPS[zip] !== undefined;
  if (!relevant) continue;
  scanned++;
  const area = Number(f[col.AREALAND_PART] ?? 0) || 0;
  const prev = best.get(zip);
  if (!prev || area > prev.area) best.set(zip, { zip, name, area });
}

// Every claimed ZIP has to be a real ZCTA in the file. A typo in the constant we are copying
// would otherwise become a row that can never match a customer.
const unreal = Object.keys(SERVED_ZIPS).filter((z) => !best.has(z));
if (unreal.length) {
  console.error(`  REFUSING: ${unreal.join(', ')} is claimed as served but is not a ZCTA in the Census file.`);
  process.exit(1);
}

for (const [zip, slug] of Object.entries(SERVED_ZIPS)) {
  const seen = best.get(zip);
  best.set(zip, { ...seen, zip, slug, claim: true });
}

const rows = [...best.values()].sort((a, b) => a.zip.localeCompare(b.zip));
const served = rows.filter((r) => r.slug);
const known = rows.filter((r) => !r.slug);
const byArea = {};
for (const r of served) byArea[r.slug] = (byArea[r.slug] ?? 0) + 1;

const missing = Object.values(SERVED).filter((s) => !byArea[s]);
if (missing.length) {
  console.error(`  REFUSING: no ZIP found for ${missing.join(', ')} - the place names above do not match the file.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const esc = (s) => s.replace(/'/g, "''");
const sql = `-- Scoop Dogg — every postal code on a route, and every one we know and do not serve.
--
-- GENERATED by scripts/build-postal-codes.mjs on ${today}. Do not hand-edit: re-run the script.
--
-- Source: ${SOURCE}
-- (US Census Bureau, 2020 ZCTA-to-place relationship file. ${scanned} rows matched our places.)
--
-- WHY A TABLE AND NOT THE CONSTANT. ZIP_CITY at src/components/booking/BookingFlow.tsx:49 held 30
-- pairs typed from memory: client-side only, no provenance, no server reader, and holes that each
-- send a real household to "somewhere else". Migration 013's lesson applies to geography too — a
-- fact the site depends on belongs in a row with a source and a date.
--
-- A ZCTA is a set of delivery routes, not a shape, so a ZIP can touch several places. The row
-- kept is the place sharing the most LAND with that ZCTA, except that a place we actually serve
-- beats one we do not: if we run a route there, that is the answer the customer needs.
--
-- ${served.length} served ZIPs across ${Object.keys(byArea).length} cities; ${known.length} known and not served.
-- ${rows.filter((r) => r.claim).length} rows are the business's own service claim; the rest are Census geography.
-- area_slug null means KNOWN AND NOT SERVED — the waitlist, and evidence about where the next
-- route day should go (P19 §4). It does not mean "never heard of", which is what a missing row is.

-- rehearse: select count(*) = ${rows.length} from area_postal_codes
-- rehearse: select count(*) = ${served.length} from area_postal_codes where area_slug is not null
-- rehearse: select count(*) = 0 from service_areas s where s.bookable and s.status = 'active' and not exists (select 1 from area_postal_codes z where z.area_slug = s.slug)
-- rehearse: select count(*) = 0 from area_postal_codes where postal_code !~ '^[0-9]{5}$'
-- rehearse: select count(*) = 0 from (select postal_code from area_postal_codes group by postal_code having count(*) > 1) d
-- rehearse: select count(*) = 1 from area_postal_codes where postal_code = '93041' and area_slug is null
-- rehearse: select count(*) = 1 from area_postal_codes where postal_code = '91377' and area_slug is null
-- rehearse: select (select area_slug from area_postal_codes where postal_code = '93030') = 'oxnard'
-- rehearse: select (select area_slug from area_postal_codes where postal_code = '93001') = 'ventura'
-- rehearse: select count(*) = ${rows.filter((r) => !r.claim).length} from area_postal_codes where source = '${SOURCE_TAG}'
-- rehearse: select count(*) = ${rows.filter((r) => r.claim).length} from area_postal_codes where source = '${CLAIM_TAG}'
-- rehearse: select count(*) = 0 from area_postal_codes where source not in ('${SOURCE_TAG}', '${CLAIM_TAG}')
-- rehearse: select count(*) = 0 from area_postal_codes where area_slug is not null and source <> '${CLAIM_TAG}'

begin;

create table area_postal_codes (
  postal_code  text primary key check (postal_code ~ '^[0-9]{5}$'),
  area_slug    text references service_areas(slug),   -- null = known, not served
  city_name    text not null,
  source       text not null,
  retrieved_on date not null,
  created_at   timestamptz not null default now()
);
create index area_postal_codes_area_idx on area_postal_codes (area_slug) where area_slug is not null;

comment on table area_postal_codes is
  'One row per postal code the business has an answer for. area_slug null is an ANSWER - "we '
  'know that ZIP and we are not on a route there yet" - and it routes the waitlist. A ZIP with '
  'no row at all is the only honest shrug.';

insert into area_postal_codes (postal_code, area_slug, city_name, source, retrieved_on) values
${rows.map((r) => `  ('${r.zip}', ${r.slug ? `'${r.slug}'` : 'null'}, '${esc(r.name)}', '${r.claim ? CLAIM_TAG : SOURCE_TAG}', '${today}')`).join(',\n')};

commit;
`;

writeFileSync(out, sql);
const down = out.replace(/migrations\//, 'migrations/down/').replace(/\.sql$/, '.down.sql');
writeFileSync(down, `-- Revert 020: the postal map goes away entirely and the funnel falls back to the city list.
begin;
drop table if exists area_postal_codes;
delete from _migrations where name = '${out.split('/').pop()}';
commit;
`);

console.log(`  ${served.length} served ZIPs, ${known.length} known-not-served, ${rows.length} rows -> ${out}`);
for (const [slug, n] of Object.entries(byArea).sort()) console.log(`    ${String(n).padStart(3)}  ${slug}`);
console.log(`    ${String(known.length).padStart(3)}  (known, not served): ${known.map((r) => r.zip).join(' ')}`);
console.log(`    ${rows.filter((r) => r.claim).length} rows are the business's claim, ${rows.filter((r) => !r.claim).length} are Census geography`);
