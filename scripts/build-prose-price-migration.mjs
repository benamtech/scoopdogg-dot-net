/**
 * Generate the migration that takes typed prices OUT of stored prose.
 *
 *   node scripts/build-prose-price-migration.mjs
 *
 * WHY. Every price a customer sees must resolve to one row (STANDARD.md §4.2). Twenty-two
 * strings in the database broke that: all sixteen `service_areas.faqs` answered "how much does
 * it cost" with "$15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, $25/week for 4 or
 * more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20", and five
 * `services` rows carried a "starting at $NN" in their meta description. Migration 013 moved the
 * ladder to $90/$110/$130/$150 and the one-time work to $179/$269, so on the day 013 landed every
 * city page advertised a price the checkout will not charge - to a reader AND to a machine, since
 * the same answers are rendered into the page's FAQPage JSON-LD.
 *
 * The numbers are not replaced with newer numbers. They come out. The city page already renders
 * <PackageCards> from rows sixty pixels above its FAQ, and the service page renders its tiers, so
 * the prose says HOW a price is worked out and the rows say WHAT it is.
 *
 * GENERATED, not hand-written, for one reason: the down migration has to restore twenty-two long
 * strings byte for byte, and a hand-transcribed revert is a revert nobody can trust.
 *
 * Reads the live rows, writes both files, prints a summary. Re-runnable.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
loadEnv();

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

// A price in prose. The same expression the gate uses, so the gate and the fix agree.
const PRICE = /\$\d/;

/** The answer every city page gives to "how much does it cost", with no figure in it. */
const AREA_ANSWER =
  'Weekly scooping is priced by how many dogs you have, and the plans and their prices are on '
  + 'this page. One-time work — a deep clean, turf deodorizing or a dog run — is priced by the '
  + 'size of the area, and you see the number before you book, not after.';

/** New copy per service, keyed by slug and column. Selling content kept, figures removed. */
const SERVICE_COPY = {
  'weekly-pooper-scooper-service': {
    meta_description:
      'Scheduled weekly dog poop cleaning in Ventura & Santa Barbara Counties. We scoop, bag and '
      + 'haul off all waste, priced by how many dogs you have. Cancel anytime.',
    intro:
      'Our most popular service. We show up on the same day every week, walk your entire yard, '
      + 'scoop every pile, bag it, and haul it off your property. You never need to be home. Skip '
      + 'a week, pause for vacation, or cancel anytime. Plans are priced by how many dogs you '
      + 'have, and you see the price before you book.',
  },
  'one-time-dog-poop-cleanup': {
    meta_description:
      'Full yard poop cleanup for overgrown or neglected yards. Perfect for moving, hosting, or '
      + 'getting back to zero. Priced by how much has built up. Ventura & Santa Barbara Counties.',
  },
  'artificial-turf-deodorizing': {
    meta_description:
      'Enzyme-based turf deodorizing that eliminates pet urine odor from artificial grass, gravel '
      + 'and concrete. Pet-safe, 100% natural, and priced by the size of the area.',
  },
  'yard-deep-clean': {
    meta_description:
      'Full turf and yard deep clean: brush, vacuum, pressure wash and heavy deodorizer. Ideal '
      + 'for seasonal resets and new homeowners. Priced by the size of the area.',
  },
  'weekly-turf-maintenance': {
    meta_description:
      'Ongoing artificial turf sweeping and deodorizing. We use the SwipeSmith turf sweeper for '
      + 'leaf, debris and pet hair removal plus enzyme treatment. Priced by the size of the area.',
  },
};

/** Dollar-quoted so no apostrophe in the copy ever needs escaping. */
const q = (s) => `$txt$${s}$txt$`;

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');

const areas = (await c.query(`select slug, faqs from service_areas order by slug`)).rows;
const services = (await c.query(`select slug, meta_description, intro from services order by slug`)).rows;

const up = [];
const down = [];
let areaCount = 0;
let serviceCount = 0;

for (const a of areas) {
  const faqs = a.faqs ?? [];
  const hits = faqs.map((f, i) => [i, f]).filter(([, f]) => PRICE.test(f.a ?? ''));
  if (!hits.length) continue;
  for (const [i, f] of hits) {
    up.push(`update service_areas set faqs = jsonb_set(faqs, '{${i},a}', to_jsonb(${q(AREA_ANSWER)}::text)), updated_at = now()\n where slug = '${a.slug}';`);
    down.push(`update service_areas set faqs = jsonb_set(faqs, '{${i},a}', to_jsonb(${q(f.a)}::text)), updated_at = now()\n where slug = '${a.slug}';`);
    areaCount++;
  }
}

for (const s of services) {
  const copy = SERVICE_COPY[s.slug];
  if (!copy) {
    for (const col of ['meta_description', 'intro']) {
      if (PRICE.test(s[col] ?? '')) throw new Error(`${s.slug}.${col} has a price and no replacement copy`);
    }
    continue;
  }
  for (const [col, text] of Object.entries(copy)) {
    if (!PRICE.test(s[col] ?? '')) throw new Error(`${s.slug}.${col} has no price to remove — the copy here is stale`);
    if (PRICE.test(text)) throw new Error(`replacement copy for ${s.slug}.${col} still contains a price`);
    up.push(`update services set ${col} = ${q(text)}, updated_at = now() where slug = '${s.slug}';`);
    down.push(`update services set ${col} = ${q(s[col])}, updated_at = now() where slug = '${s.slug}';`);
    serviceCount++;
  }
}

await c.query('rollback');
await c.end();

const HEADER = `-- Scoop Dogg — take the prices out of the prose.
--
-- GENERATED by scripts/build-prose-price-migration.mjs from the live rows. Do not hand-edit;
-- regenerate. The down migration restores every original string byte for byte, which is the
-- whole reason this file is generated rather than typed.
--
-- Migration 013 moved the ladder to $90/$110/$130/$150 and the one-time work to $179/$269. These
-- ${areaCount + serviceCount} strings still carried the old numbers, and ${areaCount} of them are rendered into each city
-- page's FAQPage JSON-LD as well as its visible text - so a machine and a reader were both being
-- told a price the checkout would refuse.
--
-- The numbers are not updated. They are removed: the prose says how a price is worked out, the
-- rows say what it is, and gates/no-price-in-prose.mjs keeps them apart from here on.
`;

const CHECKS = `
-- rehearse: select count(*) = 0 from services where meta_description ~ '\\$[0-9]' or intro ~ '\\$[0-9]'
-- rehearse: select count(*) = 0 from (select jsonb_array_elements(faqs) e from service_areas) t where t.e->>'a' ~ '\\$[0-9]'
-- rehearse: select count(*) = 0 from (select jsonb_array_elements(faqs) e from service_areas) t where t.e->>'q' ~ '\\$[0-9]'
-- rehearse: select count(*) = ${areas.length} from service_areas
-- rehearse: select count(*) = 0 from (select jsonb_array_elements(faqs) e from service_areas) t where length(t.e->>'a') < 20
`;

writeFileSync('migrations/014_prices_out_of_prose.sql', `${HEADER}${CHECKS}\nbegin;\n\n${up.join('\n')}\n\ncommit;\n`);
writeFileSync('migrations/down/014_prices_out_of_prose.down.sql',
  `-- Revert 014: put every original string back, exactly as it was read from the database on\n`
  + `-- ${new Date().toISOString().slice(0, 10)}. Generated with the up migration by\n`
  + `-- scripts/build-prose-price-migration.mjs.\n\nbegin;\n\n${down.join('\n')}\n\ndelete from _migrations where name = '014_prices_out_of_prose.sql';\n\ncommit;\n`);

console.log(`  ${areaCount} area FAQ answers, ${serviceCount} service columns -> migrations/014_prices_out_of_prose.sql (+ down)`);
