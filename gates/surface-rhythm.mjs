/**
 * No page arrives all white.
 *
 *   node scripts/dev-server.mjs --port 4330 &
 *   node gates/surface-rhythm.mjs [--base http://127.0.0.1:4330]
 *
 * P15 §5, and the sentence behind it is Ben's: *"we want to avoid the basic, all white
 * background that we have in the demo styling."* Three rules, all of them measured on a phone
 * rather than counted in the markup:
 *
 *   1. no two adjacent bands share a tone
 *   2. no page is more than 60% white by RENDERED HEIGHT
 *   3. every public page carries at least two non-white surfaces
 *
 * WHY IT IS A BROWSER JOB. "60% white by rendered height" is a fact about pixels. Counting
 * `<section>` elements in the HTML would answer a different question — a page with eight tiny
 * coloured bands and one enormous white one passes the count and fails the eye. So this
 * measures `getBoundingClientRect().height` at 390px, which is the width the funnel gate
 * already uses and the width most of this site's visitors will have.
 *
 * IT RUNS ALONE-ISH. It is a browser job, so it does not run beside Lighthouse (SPEC §5: two
 * browser jobs at once fake failures). It lives in `npm run gates:browser`.
 *
 * THE ANALYSIS IS A PURE FUNCTION, fed by real measurements here and by planted ones in the
 * negative control, so the three rules are exercised against known-bad pages every run rather
 * than only against whatever the site happens to look like today.
 */
import { chromium } from 'playwright';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'http://127.0.0.1:4330');
const WHITE_LIMIT = 0.60;
const MIN_NON_WHITE = 2;

/**
 * ONE PAGE PER TEMPLATE, not the five that sell.
 *
 * Lighthouse measures the five templates that sell, because speed is about where the money
 * is. This rule is about whether the SITE has a rhythm, and a template checked nowhere is a
 * template that drifts — /resources was 84% white with one non-white surface, and nothing was
 * looking at it. Seventeen page loads is a few seconds; a page family nobody measures is
 * permanent.
 */
const PAGES = [
  '/', '/pricing', '/services', '/services/weekly-pooper-scooper-service',
  '/areas', '/areas/ventura',
  '/resources', '/resources/ventura-county-dog-poop-cleanup-challenges',
  '/questions', '/questions/can-i-pause-my-dog-poop-pickup-while-on-vacation',
  '/about', '/contact', '/gallery', '/reviews', '/how-it-works', '/commercial', '/careers',
];

let pass = 0, fail = 0;
const ok = (what, detail = '') => { pass++; console.log(`  PASS  ${what}${detail ? ` — ${detail}` : ''}`); };
const no = (what, detail = '') => { fail++; console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ''}`); };

/**
 * The three rules, over a list of `{ tone, height }` in document order.
 * `white` counts as white; every other tone is a surface.
 */
function analyse(bands) {
  const total = bands.reduce((n, b) => n + b.height, 0);
  const whiteHeight = bands.filter((b) => b.tone === 'white').reduce((n, b) => n + b.height, 0);
  const adjacent = [];
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].tone === bands[i - 1].tone) adjacent.push(`${bands[i - 1].tone} × ${bands[i].tone} at band ${i}`);
  }
  return {
    total,
    whiteShare: total ? whiteHeight / total : 0,
    adjacent,
    nonWhite: new Set(bands.filter((b) => b.tone !== 'white').map((b) => b.tone)).size,
    bands: bands.length,
  };
}

// ---- the negative control, FIRST, so a rule that cannot fail is reported as broken ---------
console.log('negative controls');
{
  const allWhite = analyse([{ tone: 'white', height: 900 }, { tone: 'white', height: 1200 }, { tone: 'forest', height: 100 }]);
  (allWhite.whiteShare > WHITE_LIMIT && allWhite.adjacent.length === 1 && allWhite.nonWhite < MIN_NON_WHITE)
    ? ok('a mostly-white page with two white bands in a row and one surface fails all three rules',
         `${Math.round(allWhite.whiteShare * 100)}% white, ${allWhite.adjacent.length} adjacency, ${allWhite.nonWhite} surface`)
    : no('the detector does not fire on a planted all-white page — the rules below prove nothing');

  const good = analyse([{ tone: 'photo', height: 600 }, { tone: 'forest', height: 120 }, { tone: 'cream', height: 800 }, { tone: 'white', height: 700 }]);
  (good.whiteShare <= WHITE_LIMIT && good.adjacent.length === 0 && good.nonWhite >= MIN_NON_WHITE)
    ? ok('a well-rhythmed page passes all three', `${Math.round(good.whiteShare * 100)}% white, ${good.nonWhite} surfaces`)
    : no('the detector fires on a page that should pass — it is too strict to be useful');
}

// ---- the real pages ------------------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

console.log(`\nmeasured at 390px against ${BASE}`);
for (const route of PAGES) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' }).catch(() => null);
  if (!res || !res.ok()) { no(`${route} loaded`, res ? `HTTP ${res.status()}` : 'no response'); continue; }

  /**
   * Every top-level toned band INSIDE `<main>`, in document order, with its rendered height.
   *
   * ONE query. A band declares its surface either as `data-tone` (Section.astro) or as a bare
   * `tone-*` class (the hero and the proof strip are hand-written sections). A toned element
   * inside another toned element is a card, not a surface, so it is dropped — otherwise the
   * white card on the orange band would count as white page.
   *
   * CHROME IS NOT A BAND, and scoping to `<main>` is how that is expressed. The first version
   * counted the sticky header, the fixed mobile price bar and the demo banner as surfaces, and
   * reported `forest × forest` on a homepage whose content bands do not repeat a tone
   * anywhere. The rule is about the rhythm a reader scrolls through; a 58px bar pinned to the
   * bottom of the viewport is not part of it, and neither is a header that floats above every
   * band equally. The footer is chrome too — it is the same `deep` on every page by design.
   */
  const bands = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return [];
    const isToned = (el) => el.hasAttribute('data-tone') || /\btone-[a-z-]+\b/.test(el.className || '');
    const toneOf = (el) => el.getAttribute('data-tone') ?? (/\btone-([a-z-]+)\b/.exec(el.className) ?? [])[1] ?? 'unknown';
    const all = [...main.querySelectorAll('[data-tone], [class*="tone-"]')].filter(isToned);
    return all
      .filter((el) => !all.some((other) => other !== el && other.contains(el)))
      .filter((el) => !['fixed', 'sticky'].includes(getComputedStyle(el).position))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tone: toneOf(el), height: Math.round(r.height), top: Math.round(r.top + window.scrollY) };
      })
      .filter((b) => b.height > 0)
      .sort((a, b) => a.top - b.top);
  });
  if (!bands.length) { no(`${route}: has a <main> with toned bands in it`); continue; }

  const a = analyse(bands);
  const shown = bands.map((b) => b.tone).join(' → ');
  console.log(`\n  ${route}  ${a.bands} bands, ${a.total}px:  ${shown}`);

  a.adjacent.length
    ? no(`${route}: no two adjacent bands share a tone`, a.adjacent.join('; '))
    : ok(`${route}: no two adjacent bands share a tone`);
  a.whiteShare <= WHITE_LIMIT
    ? ok(`${route}: at most ${Math.round(WHITE_LIMIT * 100)}% white`, `${Math.round(a.whiteShare * 100)}%`)
    : no(`${route}: at most ${Math.round(WHITE_LIMIT * 100)}% white`, `${Math.round(a.whiteShare * 100)}% of ${a.total}px is white`);
  a.nonWhite >= MIN_NON_WHITE
    ? ok(`${route}: at least ${MIN_NON_WHITE} non-white surfaces`, `${a.nonWhite}`)
    : no(`${route}: at least ${MIN_NON_WHITE} non-white surfaces`, `${a.nonWhite}`);
}

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
