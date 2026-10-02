/**
 * Read Scoop Dogg's Google review count and rating off the live profile, and write them down.
 *
 *   node scripts/pull-review-count.mjs            # measure and print
 *   node scripts/pull-review-count.mjs --apply    # measure and update the settings rows
 *
 * THE FAULT THIS EXISTS FOR. `content/catalog.json` holds 18 reviews and the Google Business
 * Profile holds 42 (measured 2026-09-23). The 18 are a hand-curated set of quotes for the page;
 * nothing ever claimed they were all of them. But `src/lib/catalog.ts` fell back to
 * `data.reviews.length` whenever `reviews.google_count` was unset — and it was never set — so
 * `/reviews` told every visitor "18 Google reviews". Review count is the trust signal R5 scored
 * as table stakes and the site was publishing 43% of its own.
 *
 * WHY THIS IS A SCRIPT AND NOT AN EDIT. R16 §1.3 named the durable fix and it is not the number:
 * "nothing currently pulls the live count, so it will drift again the week after it is
 * corrected." A number typed into a migration is right on the day it is typed. This is the reader
 * that can be run again, and `gates/review-count.mjs` fails when nobody has.
 *
 * WHY A BROWSER. Maps is JS-rendered and `share.google` 302s to a search page: curl reads an
 * empty shell. Same method as `experiments/e13-channel-probe.mjs` — real Chromium, never a text
 * matcher (a rendered `noscript` panel reads as absent to a matcher and present to innerText,
 * which this project has been caught by before).
 *
 * AND WHAT IT READS IS THE ARIA LABEL, not the position of a number in a wall of text. The first
 * version of this script matched a parenthesised number and returned **805** — the area code in
 * "(805) 869-8070". Maps publishes `aria-label="42 reviews"` and `aria-label="5.0 stars"` on the
 * header, which are labels whose whole purpose is to say what the number MEANS. The innerText
 * pattern is kept as a second instrument and the two must agree, or nothing is written.
 *
 * IT WRITES TWO ROWS AND A DATE. The date is what makes staleness visible instead of silent.
 */
import { chromium } from 'playwright';
import pg from 'pg';
import { loadEnv } from './_env.mjs';

loadEnv();
const apply = process.argv.includes('--apply');
const NAV_MS = 45000, SETTLE_MS = 6000;

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows: [row] } = await c.query(`select value #>> '{}' as v from settings where key = 'reviews.google_profile_url'`);
const profile = row?.v;
if (!profile) { console.error('reviews.google_profile_url is not set — nothing to read'); await c.end(); process.exit(1); }
console.log(`profile: ${profile}`);

const b = await chromium.launch();
const ctx = await b.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  locale: 'en-US',
});
const p = await ctx.newPage();
let labels = [], text = '', title = '';
try {
  await p.goto(profile, { waitUntil: 'domcontentloaded', timeout: NAV_MS });
  await p.waitForTimeout(SETTLE_MS);
  labels = await p.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') || ''));
  text = await p.evaluate(() => document.body.innerText);
  title = await p.evaluate(() => document.querySelector('h1')?.innerText || '');
} catch (e) {
  console.error(`could not read the profile: ${String(e.message).split('\n')[0]}`);
}
await b.close();

// Instrument 1: the labels Maps writes for screen readers, which say what each number means.
const label = (re) => { for (const l of labels) { const m = re.exec(l); if (m) return Number(m[1]); } return NaN; };
const rating = label(/^([0-5](?:\.\d)?)\s+stars?\s*$/);
const count = label(/^(\d[\d,]*)\s+reviews?$/) || Number(String(labels.find((l) => /^\d[\d,]*\s+reviews?$/.test(l)) ?? '').replace(/[^\d]/g, ''));

// Instrument 2: the header's own "5.0 \n (42)", which is a different element and a different
// rendering path. If these disagree, something changed and a guess is worse than a refusal.
const pair = /(\d(?:\.\d)?)\s*\n\s*\((\d[\d,]*)\)/.exec(text);
const textRating = pair ? Number(pair[1]) : NaN;
const textCount = pair ? Number(pair[2].replace(/,/g, '')) : NaN;

console.log(`listing:   ${title || '(no h1)'}`);
console.log(`aria:      rating=${Number.isFinite(rating) ? rating : 'UNREADABLE'} count=${Number.isFinite(count) ? count : 'UNREADABLE'}`);
console.log(`innerText: rating=${Number.isFinite(textRating) ? textRating : 'UNREADABLE'} count=${Number.isFinite(textCount) ? textCount : 'UNREADABLE'}`);

const agree = Number.isFinite(textRating) && Number.isFinite(textCount) && textRating === rating && textCount === count;
const okRating = Number.isFinite(rating) && rating >= 1 && rating <= 5;
const okCount = Number.isFinite(count) && count >= 1 && count < 100000;
if (!okRating || !okCount || !agree) {
  console.error('\nREFUSING to write.');
  console.error(!agree && okRating && okCount
    ? '  The two instruments disagree, so Maps has changed shape and this script needs re-reading.'
    : '  A profile that did not render is not a business with no reviews, and writing a zero here');
  console.error('  would put that sentence on the client\'s own home page.');
  console.error(`  first 300 chars of what was read:\n${text.slice(0, 300)}`);
  await c.end();
  process.exit(1);
}
console.log(`\nboth instruments agree: ${rating} stars, ${count} reviews`);

const { rows: was } = await c.query(
  `select key, value #>> '{}' as v from settings where key in ('reviews.google_count','reviews.google_rating','reviews.google_checked_on')`);
const before = Object.fromEntries(was.map((r) => [r.key, r.v]));
console.log(`stored: count=${before['reviews.google_count'] ?? 'unset'} rating=${before['reviews.google_rating'] ?? 'unset'} checked=${before['reviews.google_checked_on'] ?? 'never'}`);

if (!apply) {
  console.log('\ndry run — re-run with --apply to write the rows');
  await c.end();
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
for (const [key, value] of [
  ['reviews.google_count', String(count)],
  ['reviews.google_rating', String(rating)],
  ['reviews.google_checked_on', JSON.stringify(today)],
]) {
  await c.query(
    `insert into settings (key, value, updated_by) values ($1, $2::jsonb, 'script:pull-review-count')
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, value]);
  console.log(`  ${key} = ${value}`);
}
console.log('\nA build is needed before the site shows it: scripts/pull-catalog.mjs publishes these keys.');
await c.end();
