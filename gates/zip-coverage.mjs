/**
 * The ZIP map is complete, unambiguous, and lives in exactly one place.
 *
 *   node gates/zip-coverage.mjs
 *
 * P16 §2 and §10. The constant this replaced (`ZIP_CITY`, 30 pairs at BookingFlow.tsx:49) failed
 * in three different ways at once: it was client-side only so the server could not answer the
 * same question, it had no provenance so nobody could tell where a pair came from, and it had
 * holes that each sent a real household to "somewhere else". The three checks here are one per
 * failure, plus the count, printed every run so a silent shrink is visible.
 *
 * THE THIRD CHECK IS THE ONE THAT KEEPS IT TRUE. A generated map is only one writer for as long
 * as nobody types a second one; a ZIP-to-city pair written into source anywhere outside the
 * generated migration fails this gate, whatever it is called.
 */
import pg from 'pg';
import { readFileSync, globSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');

const { rows: counts } = await c.query(
  `select count(*)::int as total, count(area_slug)::int as served,
          count(*) filter (where area_slug is null)::int as known_unserved from area_postal_codes`);
console.log(`  ${counts[0].served} served postal codes, ${counts[0].known_unserved} known and not served, ${counts[0].total} rows`);

// 1. every bookable city has at least one ZIP, or a household there cannot reach a price.
{
  const { rows } = await c.query(
    `select s.slug from service_areas s
      where s.bookable and s.status = 'active'
        and not exists (select 1 from area_postal_codes z where z.area_slug = s.slug)`);
  rows.length ? no('every bookable city has a postal code', rows.map((r) => r.slug).join(', '))
              : ok('every bookable city has a postal code');
}

// 2. a ZIP answers once. The primary key makes this structural; the check is here so that
//    removing the key would be caught rather than discovered by a customer.
{
  const { rows } = await c.query(
    `select postal_code from area_postal_codes group by postal_code having count(*) > 1`);
  rows.length ? no('a postal code maps to at most one area', rows.map((r) => r.postal_code).join(', '))
              : ok('a postal code maps to at most one area');
  const { rows: pk } = await c.query(
    `select count(*)::int n from pg_constraint where conrelid = 'area_postal_codes'::regclass and contype = 'p'`);
  pk[0].n === 1 ? ok('the postal code is the primary key') : no('the postal code is the primary key');
}

// 3. every row says where it came from.
{
  const { rows } = await c.query(
    `select count(*)::int n from area_postal_codes where source is null or source = '' or retrieved_on is null`);
  rows[0].n === 0 ? ok('every row carries a source and a date') : no('every row carries a source and a date', `${rows[0].n} without`);
  const { rows: srcs } = await c.query(`select source, count(*)::int n from area_postal_codes group by 1 order by 2 desc`);
  for (const s of srcs) console.log(`    ${String(s.n).padStart(3)}  ${s.source}`);
}

// 4. NO SECOND MAP. A pair like '93030': 'oxnard' anywhere in the shipped source is a second
//    writer, and two writers is how the browser and the server come to disagree.
{
  const files = [...globSync('src/**/*.{ts,tsx,astro}'), ...globSync('server/**/*.ts'), ...globSync('api/**/*.ts')];
  const PAIR = /['"]\d{5}['"]\s*:\s*['"][a-z][a-z-]{2,}['"]/;
  const hits = files.filter((f) => PAIR.test(readFileSync(f, 'utf8')));
  hits.length ? no('no hand-written ZIP-to-city map in the shipped source', hits.join(', '))
              : ok('no hand-written ZIP-to-city map in the shipped source', `${files.length} files`);
  // The detector must be able to see one.
  PAIR.test("const ZIP_CITY = { '93030': 'oxnard' };")
    ? ok('negative control: a planted ZIP map trips it')
    : no('negative control: a planted ZIP map trips it', 'DETECTOR BLIND');
}

// 5. the generated browser map matches the rows it was generated from.
{
  const built = JSON.parse(readFileSync('content/catalog.json', 'utf8')).postal_codes ?? {};
  const { rows } = await c.query(
    `select z.postal_code, z.area_slug from area_postal_codes z join service_areas a on a.slug = z.area_slug
      where a.bookable and a.status = 'active'`);
  const fromDb = Object.fromEntries(rows.map((r) => [r.postal_code, r.area_slug]));
  const drift = [...new Set([...Object.keys(built), ...Object.keys(fromDb)])].filter((z) => built[z] !== fromDb[z]);
  drift.length ? no('the built map and the rows agree', `${drift.length}: ${drift.slice(0, 5)}`)
               : ok('the built map and the rows agree', `${Object.keys(built).length} codes`);
}

// 6. the holes P16 named are answered, and answered as NOT SERVED rather than absent.
{
  const HOLES = { '93041': 'Port Hueneme', '91377': 'Oak Park', '93066': 'Somis', '93040': 'Piru', '93067': 'Summerland' };
  const { rows } = await c.query(
    `select postal_code, area_slug from area_postal_codes where postal_code = any($1::text[])`, [Object.keys(HOLES)]);
  const missing = Object.keys(HOLES).filter((z) => !rows.find((r) => r.postal_code === z));
  const claimed = rows.filter((r) => r.area_slug);
  missing.length ? no('the named holes have rows', missing.map((z) => `${z} ${HOLES[z]}`).join(', '))
    : claimed.length ? no('the named holes are not claimed as served', claimed.map((r) => `${r.postal_code}->${r.area_slug}`).join(', '))
    : ok('the named holes are known and honestly not served', Object.values(HOLES).join(', '));
}

await c.query('rollback');
await c.end();
console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
