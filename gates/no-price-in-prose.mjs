/**
 * A price is a row, never a sentence.
 *
 *   node gates/no-price-in-prose.mjs
 *
 * WHY THIS EXISTS, in one measurement. On the day migration 013 moved the ladder to
 * $90/$110/$130/$150, twenty-two strings in the database still read "$15/week for 1 dog,
 * $20/week for 2 dogs... A Turf Deep Clean is a flat $99". Sixteen of them were the FAQ answer on
 * a city page, which Astro also renders into that page's FAQPage JSON-LD - so every city page
 * advertised a price the checkout would refuse, to a reader AND to a machine, and no gate in the
 * repository could see it. `price-four-places.mjs` compares the package price across four
 * surfaces; it cannot notice a number that was typed rather than resolved.
 *
 * Three detectors, because the defect has three homes:
 *
 *   ROWS    content/catalog.json - services and service_areas prose. Where all twenty-two lived.
 *   SOURCE  the .astro/.tsx/.ts that renders a page. A hardcoded "$15/week" in a component is the
 *           same defect one layer up. Comments are stripped first: naming the old price in a
 *           comment that explains why the code stopped hardcoding it is not the defect.
 *   SCHEMA  every <script type="application/ld+json"> in dist/. Structured data is a claim made
 *           to a machine, and a machine will not notice that the sentence disagrees with the
 *           offer beside it. Here the rule is not "no figure" but "every figure is a CURRENT
 *           catalog figure": the twenty-six question pages legitimately print prices resolved
 *           from rows into their answers, and gates/question-pages.mjs already proves each one
 *           matches its row and is visible. What must never appear is a number that resolves to
 *           nothing - which is exactly what the sixteen city pages were serving.
 *
 * SCOPE IS src/, AND THAT IS THE POINT. The three legacy modules that held Josue's pre-rebuild
 * prices - services.ts, cities.ts, reviews.ts - were the INPUT to scripts/build-catalog-seed.mjs,
 * which generated migration 004. They now live in migrations/seed-source/, because a frozen seed
 * input is history and history is allowed to contain the old numbers. What they are not allowed
 * to be is live code: cities.ts was still imported by the admin's city dropdown, so 139 stale
 * prices shipped in the admin bundle to render a list of names the catalog rows already hold.
 * There is no exclusion list here. A gate with a hole in it is where the next one hides.
 *
 * NEGATIVE CONTROL: each detector is run against a planted violation and must fire. A regex that
 * matches nothing passes every scan in a repository that is already clean.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PRICE = /\$\d/;
const PRICE_G = /\$\d[\d,.]*/g;

// --- scope -----------------------------------------------------------------------------
const walk = (d) => (existsSync(d)
  ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; })
  : []);
const SOURCE = ['src/pages', 'src/layouts', 'src/components', 'src/shared']
  .flatMap(walk)
  .concat(walk('src/lib'))
  .filter((f) => /\.(astro|tsx|ts)$/.test(f));

// Prose columns. A column whose value a page prints as words, as opposed to a number it formats.
const SERVICE_PROSE = ['meta_title', 'meta_description', 'h1', 'intro', 'pricing_note', 'who_its_for', 'what_includes', 'faqs'];
const AREA_PROSE = ['meta_title', 'meta_description', 'intro', 'local_context', 'faqs', 'neighborhoods'];

/** Comments are not prose a reader sees. Strip them before looking for a price. */
const uncomment = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1 ');

const findings = [];
const note = (where, what) => findings.push(`${where}: ${what}`);

// --- 1. the rows -----------------------------------------------------------------------
const CATALOG = 'content/catalog.json';
let rowsScanned = 0;
if (!existsSync(CATALOG)) {
  note(CATALOG, 'missing — run node scripts/pull-catalog.mjs');
} else {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const scanRow = (kind, row, cols) => {
    for (const col of cols) {
      if (row[col] == null) continue;
      rowsScanned++;
      for (const m of JSON.stringify(row[col]).matchAll(PRICE_G)) note(`${kind}/${row.slug}.${col}`, m[0]);
    }
  };
  for (const s of cat.services ?? []) scanRow('service', s, SERVICE_PROSE);
  for (const a of cat.areas ?? []) scanRow('area', a, AREA_PROSE);
}

// --- 2. the source ---------------------------------------------------------------------
for (const f of SOURCE) {
  for (const m of uncomment(readFileSync(f, 'utf8')).matchAll(PRICE_G)) note(f, m[0]);
}

// --- 3. the structured data ------------------------------------------------------------
// Every figure a machine is shown must be a figure the catalog currently holds: a tier price, a
// package price, its half-off first month, or its per-visit equivalent. Anything else resolves
// to nothing.
const cents = (c) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
const allowed = new Set();
if (existsSync(CATALOG)) {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8'));
  for (const t of cat.tiers ?? []) if (t.price_cents) allowed.add(cents(t.price_cents));
  for (const p of cat.packages ?? []) {
    const m = p.monthly_price_cents;
    allowed.add(cents(m));                        // the monthly price
    allowed.add(cents(Math.floor(m / 2)));        // first month half off
    allowed.add(cents(Math.round((m * 12) / 52)));  // the per-visit equivalent, both roundings
    allowed.add(cents(Math.round(m / (52 / 12))));
  }
}
const DIST = 'dist';
let ldBlocks = 0;
const htmlFiles = existsSync(DIST) ? walk(DIST).filter((f) => f.endsWith('index.html')) : [];
for (const f of htmlFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    ldBlocks++;
    for (const p of m[1].matchAll(PRICE_G)) {
      const figure = p[0].replace(/\.$/, '');
      if (!allowed.has(figure)) note(`${f} (ld+json)`, `${p[0]} resolves to no catalog row`);
    }
  }
}

// --- negative controls -----------------------------------------------------------------
const controls = {
  rows: PRICE.test(JSON.stringify({ a: 'from $15/week' })),
  source: PRICE.test(uncomment('<p>Only $20 a visit</p>')),
  comment_is_not_a_violation: !PRICE.test(uncomment('// the old price was $15/week\nconst x = 1;')),
  schema: !allowed.has('$1') && allowed.size > 0,
};
const blind = Object.entries(controls).filter(([, ok]) => !ok).map(([k]) => k);

// --- report ----------------------------------------------------------------------------
console.log(`  negative controls: ${blind.length ? `BLIND on ${blind.join(', ')}` : 'all four fire'}`);
console.log(`  catalog figures a page may print: ${allowed.size}`);
console.log(`  scanned: ${rowsScanned} row fields, ${SOURCE.length} source files, ${ldBlocks} ld+json blocks in ${htmlFiles.length} pages`);
if (!htmlFiles.length) console.log('  NOTE: dist/ is absent, so the structured-data scan measured nothing. Run npm run build first.');
for (const v of findings.slice(0, 20)) console.log(`    ${v}`);
if (findings.length > 20) console.log(`    ... and ${findings.length - 20} more`);

const pass = !blind.length && findings.length === 0 && htmlFiles.length > 0;
console.log(pass ? `PASS 0 typed prices` : `FAIL ${findings.length} typed price(s)`);
process.exit(pass ? 0 : 1);
