/**
 * Every parameter a page sends into a funnel has a reader there.
 *
 *   npm run build && node gates/entry-params.mjs
 *
 * THE FAULT THIS EXISTS FOR, measured on the preview on 2026-10-02. Eleven homepage cards, four
 * service-page ZIP boxes and every closing band sent `?service=<slug>` to /book, and the booking
 * island read `package`, `zip` and `address` — never `service`. A visitor who pressed "Book
 * pressure washing" got the ZIP step and then a list of eleven services with nothing chosen.
 * Seven service pages sent `?service=` to /contact, which read no parameter at all. Every ZIP box
 * wrote `from=` and `city=`; nothing read either.
 *
 * None of it was visible to a gate, because each side was correct on its own: the link was a
 * valid link and the page it reached rendered. The defect is in the PAIR, so this reads both
 * halves. The writers come from the built HTML (every `href` and every GET form that targets a
 * funnel page), the readers from the source of the thing that page mounts.
 *
 * It is a static check and it cannot prove the reader does the right thing with the value. The
 * browser half of that is `gates/funnel-events.mjs`; this one keeps a parameter from being
 * written into the void in the first place.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };

/** The funnel pages, and the source that reads their query string. */
const READERS = {
  '/book': ['src/components/booking/BookingFlow.tsx'],
  '/custom-quote': ['src/components/site/QuoteRequestForm.astro', 'src/pages/custom-quote.astro'],
  '/contact': ['src/components/site/InquiryForm.astro', 'src/pages/contact.astro'],
};
const readsOf = (files) => {
  const names = new Set();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:searchParams|\bparams|URLSearchParams\([^)]*\))\s*\.get\(\s*['"]([\w-]+)['"]\s*\)/g)) names.add(m[1]);
  }
  return names;
};

function analyse(writes, readers) {
  // writes: [{ target, param, where }]
  const orphans = new Map();
  for (const w of writes) {
    if (!(w.target in readers)) continue;
    if (!readers[w.target].has(w.param)) {
      const k = `${w.target}?${w.param}=`;
      if (!orphans.has(k)) orphans.set(k, new Set());
      orphans.get(k).add(w.where);
    }
  }
  return orphans;
}

// ---- negative control first: a planted orphan must be caught, a read one must not ----------
console.log('negative controls');
{
  const readers = { '/book': new Set(['package']) };
  const bad = analyse([{ target: '/book', param: 'service', where: 'planted.html' }], readers);
  const good = analyse([{ target: '/book', param: 'package', where: 'planted.html' }], readers);
  bad.size === 1 && good.size === 0
    ? ok('a parameter with no reader is caught, and one with a reader is not')
    : no('the detector cannot tell a read parameter from an unread one — the result below proves nothing');
}

// ---- the writers, from the built site ------------------------------------------------------
const DIST = 'dist';
const html = [];
const walk = (dir) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); statSync(f).isDirectory() ? walk(f) : f.endsWith('.html') && html.push(f); } };
walk(DIST);
html.length > 20 ? ok('the built site is there', `${html.length} pages`) : no('the built site is there', `${html.length} pages in dist/ — run the build first`);

const writes = [];
for (const f of html) {
  const src = readFileSync(f, 'utf8');
  const where = f.replace(/^dist/, '').replace(/\/index\.html$/, '') || '/';
  for (const m of src.matchAll(/href="(\/(?:book|custom-quote|contact))\?([^"#]+)"/g)) {
    for (const pair of m[2].replace(/&amp;/g, '&').split('&')) writes.push({ target: m[1], param: pair.split('=')[0], where });
  }
  for (const m of src.matchAll(/<form\b[^>]*\baction="(\/(?:book|custom-quote|contact))"[^>]*>([\s\S]*?)<\/form>/g)) {
    if (/method="post"/i.test(m[0].slice(0, m[0].indexOf('>')))) continue;
    for (const i of m[2].matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([\w-]+)"/g)) writes.push({ target: m[1], param: i[1], where });
  }
}
writes.length > 50 ? ok('pages send parameters into the funnel', `${writes.length} writes`) : no('pages send parameters into the funnel', `only ${writes.length} found — the scan is probably broken`);

const readers = Object.fromEntries(Object.entries(READERS).map(([t, files]) => [t, readsOf(files)]));
for (const [t, r] of Object.entries(readers)) console.log(`    ${t} reads: ${[...r].join(', ') || '(nothing)'}`);

const orphans = analyse(writes, readers);
if (!orphans.size) ok('every parameter sent to /book, /custom-quote and /contact has a reader');
for (const [k, pages] of orphans) no(`${k} has a reader`, `${pages.size} page${pages.size === 1 ? '' : 's'} send it, e.g. ${[...pages].slice(0, 3).join(', ')}`);

// The one that started this: the service a card names is the service the funnel opens on.
const flow = readFileSync('src/components/booking/BookingFlow.tsx', 'utf8');
/searchParams\.get\('service'\)/.test(flow) && /setEntryService\(/.test(flow)
  ? ok('the booking flow reads `service` and acts on it')
  : no('the booking flow reads `service` and acts on it');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
