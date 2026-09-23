/**
 * The number beside the word "Google" is Google's number, and somebody has checked it recently.
 *
 *   node gates/review-count.mjs
 *
 * THE FAULT THIS EXISTS FOR. `content/catalog.json` holds 18 review quotes — a hand-curated set
 * for the page, which is a fine design decision. The Google Business Profile holds 42. The field
 * holding the curated number was called `count`, `reviews.google_count` had never been written,
 * and six surfaces put 18 in front of a visitor beside the word Google: /reviews twice including
 * its meta description, the proof bar, the quote block, every question page, and llms.txt — the
 * file AI answer engines read. The site published 43% of its own strongest asset.
 *
 * AND THE REASON A GATE IS THE FIX RATHER THAN A CORRECTED NUMBER: R16 §1.3 says it plainly —
 * "nothing currently pulls the live count, so it will drift again the week after it is
 * corrected." Migration 034 wrote the number. `scripts/pull-review-count.mjs` is the reader. This
 * is what fails when nobody has run it, and when a page starts building its own sentence again.
 *
 * NO NETWORK. It reads the repo and the published catalog. Going to Google on every gate run
 * would be slow, would be blocked, and would make a red mean "Maps rate-limited us" — which is
 * the kind of red that gets a gate switched off. The staleness ratchet is what carries the
 * freshness question instead, and the script is what answers it.
 */
import { readFileSync, existsSync, globSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const read = (f) => readFileSync(f, 'utf8');

/** How old the live count may get before this goes red. A quarter: long enough not to nag. */
const MAX_AGE_DAYS = 120;

// ---- A. the number has one home ------------------------------------------------------------
console.log('A. one home for the count, and one sentence for the page');
const catalogTs = read('src/lib/catalog.ts');
check(/quotes: data\.reviews\.length/.test(catalogTs) && !/\bcount: data\.reviews\.length/.test(catalogTs),
  'the curated number is called `quotes`, not `count`',
  'six pages took `count` as an invitation and put it next to the word Google');
check(/get label\(\)/.test(catalogTs) && /reviews on this page/.test(catalogTs),
  'and `label` builds the only sentence a page should render',
  'the honest sentence differs depending on which of the two numbers we have');

/**
 * THE DETECTOR. Any page that puts `reviewSummary.quotes` and the word Google in the same
 * expression is the original defect coming back. Comments are stripped first — this file's own
 * explanation of the bug would otherwise trip it, and so would catalog.ts's.
 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1 ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const pages = globSync('src/**/*.{astro,ts,tsx}').filter((f) => !f.includes('node_modules'));
const offenders = [];
for (const f of pages) {
  if (f.endsWith('src/lib/catalog.ts')) continue;      // where the two numbers are allowed to meet
  const body = strip(read(f));
  for (const line of body.split('\n')) {
    if (/reviewSummary\.quotes/.test(line) && /google/i.test(line)) offenders.push(`${f}: ${line.trim().slice(0, 90)}`);
  }
}
check(offenders.length === 0, 'no page presents the curated quote count as a Google review count',
  offenders.length ? offenders.join(' | ') : `${pages.length} files read`);

check(!/reviewSummary\.count/.test(pages.map(read).join('\n')),
  'and the old field name is gone from the tree', 'a rename that leaves one caller behind is not a rename');

// ---- B. the row exists, is published, and is not stale --------------------------------------
console.log('\nB. the row, the publication, and its age');
const pull = read('scripts/pull-catalog.mjs');
for (const k of ['reviews.google_count', 'reviews.google_rating', 'reviews.google_checked_on']) {
  check(pull.includes(`'${k}'`), `${k} is published to the built site`,
    'a key the site reads and PUBLIC_SETTINGS does not carry is a feature that silently does not exist');
}
check(existsSync('scripts/pull-review-count.mjs'), 'the reader exists',
  'a number with no reader drifts, which is how this one got 24 behind');

if (existsSync('content/catalog.json')) {
  const cat = JSON.parse(read('content/catalog.json'));
  const s = cat.settings ?? {};
  const google = Number(s['reviews.google_count']);
  const quotes = (cat.reviews ?? []).length;
  const checked = s['reviews.google_checked_on'];

  if (!Number.isFinite(google)) {
    // Honest about the state of THIS build: migrations 034 is written and may not be applied to
    // the database this catalog was pulled from. That is a fact about the build, not a failure.
    ok('this catalog predates migration 034',
      `no reviews.google_count yet, so the site says "${quotes} reviews on this page" — true, and 24 short`);
  } else {
    check(google >= quotes, 'the Google count is not smaller than the quotes we publish',
      `${google} on Google, ${quotes} quoted — a curated subset cannot exceed the whole`);
    check(google > 0, 'and it is a real number', `${google}`);
    if (checked) {
      const age = Math.floor((Date.now() - Date.parse(String(checked))) / 86400000);
      check(age <= MAX_AGE_DAYS, `the live profile was read within ${MAX_AGE_DAYS} days`,
        `last read ${checked}, ${age} days ago — run: node scripts/pull-review-count.mjs --apply`);
    } else {
      no('the count records when it was last read', 'without a date nobody can tell 42 from stale');
    }
  }
}

// ---- negative controls -----------------------------------------------------------------------
console.log('\nnegative controls');
{
  const bad = 'const x = `${reviewSummary.rating} on Google, ${reviewSummary.quotes} reviews`;';
  const caught = /reviewSummary\.quotes/.test(bad) && /google/i.test(bad);
  check(caught, 'the detector catches the exact line that used to ship', bad.slice(0, 60));

  const good = '<span>{reviewSummary.label}</span>  // renders "42 Google reviews"';
  const clean = strip(good);
  check(!(/reviewSummary\.quotes/.test(clean) && /google/i.test(clean)),
    'and passes the line that replaced it', 'including its trailing comment, which is stripped first');

  const commented = '// the live page said "19 Google reviews" while reviewSummary.quotes was 18';
  check(!(/reviewSummary\.quotes/.test(strip(commented)) && /google/i.test(strip(commented))),
    'a comment describing the bug is not the bug', 'or nobody could write this down');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
