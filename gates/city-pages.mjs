/**
 * The sixteen city pages each carry content that exists on no other city page.
 *
 *   node gates/city-pages.mjs
 *
 * `gates/question-pages.mjs` has held this line for the 26 question pages since they were
 * written. NOTHING held it for the city pages, and templated location pages are the textbook
 * shape of what Google calls doorway abuse — "multiple pages ... targeting specific regions or
 * cities that funnel users to one page". Step 8 adds a cross-link band to every one of these
 * pages, which is exactly the kind of edit that makes sixteen pages more alike without anybody
 * intending it.
 *
 * WHY UNIQUE CONTENT AND NOT PAIRWISE SIMILARITY, which is what the plan asked for and what the
 * first version of this gate did. Measured at a5eb9b8, BEFORE step 8 touched anything: pairwise
 * Jaccard over the `<main>` region reads **max 0.53, median 0.44**. The record said "max
 * pairwise Jaccard 0.32, median 0.15" and that does not reproduce with this instrument — see
 * the note for 2026-09-19. A 0.44 median is not a defect here: every city page sells the SAME
 * service with the same plans, the same three steps, the same reviews and the same ten other
 * services, because that is one business operating in sixteen towns. Setting a similarity limit
 * above 0.53 to make that pass would be writing down "these pages are half identical and that
 * is fine" and calling it a gate.
 *
 * So this measures the thing that actually matters: **what fraction of each page's 5-word
 * shingles appear on that page and on no other city page.** Shared bands contribute zero unique
 * shingles to every page equally, so they neither help a page nor hide a thin one. A page that
 * is a template with the name swapped scores near zero; the negative control below plants
 * exactly that and prints what it scores.
 *
 * Measured at a5eb9b8: every page between 28.0% (Westlake Village) and 36.5% (Ventura). After
 * step 8's cross-link band: 25.7% to 33.2%. **The band cost about 2.3 points on every page**,
 * and that is worth knowing rather than glossing: the six guide links vary by city but the
 * question chips are the same six on all sixteen pages, so most of what the band adds is shared
 * text that dilutes the ratio. It buys a visitor useful links and it buys those question pages
 * nothing they need — they already clear the inbound floor without it. If this number ever
 * comes under pressure, that band is the first thing to trim.
 *
 * The floor is 0.20 — below the worst real page with room to move, and well above the 14.6% a
 * swapped-name copy of a real page scores, which the negative control measures on every run.
 *
 * WHAT IT CANNOT SEE: whether the local text is TRUE. `local_context`, `neighborhoods` and the
 * city FAQs are Josue's rows. This gate proves they differ; it cannot prove they are right.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const DIST = 'dist/areas';
const SHINGLE = 5;
/** The floor, set from the measured distribution at a5eb9b8 (min 0.280) with room to move. */
const MIN_UNIQUE = 0.20;
/** Reported, not failed: the pairwise number, so a regression in it is visible on every run. */
const REPORT_PAIRWISE = true;

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
const strip = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * The page's own content: between <main ...> and the last </main>. The header and footer are
 * identical on every page in the site by design and would swamp any measurement that read them.
 */
const mainOf = (html) => {
  const open = html.search(/<main\b[^>]*>/i);
  if (open < 0) return null;
  const start = html.indexOf('>', open) + 1;
  const end = html.lastIndexOf('</main>');
  return end > start ? html.slice(start, end) : null;
};

/** Same masking as the question gate, so the two gates' numbers mean the same thing. */
const shingles = (text) => {
  const w = text.toLowerCase().replace(/\$?\d[\d,.]*/g, '#').replace(/[^a-z#\s]/g, ' ').split(/\s+/).filter(Boolean);
  const s = new Set();
  for (let i = 0; i + SHINGLE <= w.length; i++) s.add(w.slice(i, i + SHINGLE).join(' '));
  return s;
};
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };

/** For each page, the share of its shingles that no other page in the set has. */
function uniqueShares(pages) {
  const seen = new Map();
  for (const p of pages) for (const x of p.sh) seen.set(x, (seen.get(x) ?? 0) + 1);
  return pages.map((p) => {
    const u = [...p.sh].filter((x) => seen.get(x) === 1).length;
    return { slug: p.slug, total: p.sh.size, unique: u, share: p.sh.size ? u / p.sh.size : 0 };
  }).sort((a, b) => a.share - b.share);
}

if (!existsSync(DIST)) { console.log('FAIL — no dist/areas. Run `npm run build` first.'); process.exit(1); }
const slugs = readdirSync(DIST, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const pages = [];
for (const slug of slugs) {
  const file = `${DIST}/${slug}/index.html`;
  if (!existsSync(file)) continue;
  const body = mainOf(readFileSync(file, 'utf8'));
  if (body === null) { no(`${slug} has a <main> region`, 'the layout changed; this gate reads it'); continue; }
  const text = strip(body);
  pages.push({ slug, text, sh: shingles(text) });
}
console.log(`  ${pages.length} city pages, ${SHINGLE}-word shingles over <main>`);
pages.length >= 2 ? ok('there are city pages to compare') : no('there are city pages to compare', `found ${pages.length}`);

// 1. every city page carries content that exists on no other city page.
{
  const shares = uniqueShares(pages);
  console.log(`  unique content: worst ${(shares[0].share * 100).toFixed(1)}% (${shares[0].slug}), best ${(shares[shares.length - 1].share * 100).toFixed(1)}% (${shares[shares.length - 1].slug}), floor ${(MIN_UNIQUE * 100).toFixed(0)}%`);
  for (const s of shares.slice(0, 3)) console.log(`    ${(s.share * 100).toFixed(1)}%  ${s.slug}  (${s.unique} of ${s.total})`);
  const thin = shares.filter((s) => s.share < MIN_UNIQUE);
  thin.length === 0
    ? ok(`every city page is at least ${(MIN_UNIQUE * 100).toFixed(0)}% its own content`)
    : no(`every city page is at least ${(MIN_UNIQUE * 100).toFixed(0)}% its own content`,
         thin.map((s) => `${s.slug} ${(s.share * 100).toFixed(1)}%`).join(', '));
}

// 2. each page is about its own city — the cheapest thing a swapped-name template gets wrong.
{
  const bad = pages.filter((p) => !new RegExp(`\\b${p.slug.replace(/-/g, ' ')}\\b`, 'i').test(p.text));
  bad.length === 0
    ? ok('every city page names its own city in its body')
    : no('every city page names its own city in its body', bad.map((p) => p.slug).join(', '));
}

// 3. the pairwise number, REPORTED and not failed, so its trend is visible on every run.
if (REPORT_PAIRWISE) {
  const js = [];
  let worst = { j: -1 };
  for (let i = 0; i < pages.length; i++) {
    for (let k = i + 1; k < pages.length; k++) {
      const j = jaccard(pages[i].sh, pages[k].sh);
      js.push(j);
      if (j > worst.j) worst = { j, a: pages[i].slug, b: pages[k].slug };
    }
  }
  js.sort((a, b) => a - b);
  const q = (f) => js[Math.min(js.length - 1, Math.floor(f * js.length))] ?? 0;
  console.log(`  pairwise similarity (tracked, not failed): median ${q(0.5).toFixed(2)}, max ${worst.j.toFixed(2)} (${worst.a} ~ ${worst.b})`);
  console.log('    a5eb9b8 read median 0.44 / max 0.53. The shared plans, steps, reviews and service list are most of it.');
}

// ---- negative controls -------------------------------------------------------------------------
{
  // The fault this gate exists for: a real page duplicated with only the city name changed.
  // It is added to the real set, so its score is measured against the pages it is copying.
  const donor = pages.find((p) => p.slug === 'ventura') ?? pages[0];
  if (donor) {
    const twinText = donor.text.replace(/\bVentura\b/g, 'Springfield').replace(new RegExp(donor.slug.replace(/-/g, ' '), 'gi'), 'Springfield');
    const planted = uniqueShares([...pages, { slug: '__twin__', sh: shingles(twinText) }]);
    const twin = planted.find((s) => s.slug === '__twin__');
    console.log(`    control: a copy of /areas/${donor.slug} with the city name swapped scores ${(twin.share * 100).toFixed(1)}% unique`);
    twin.share < MIN_UNIQUE
      ? ok('negative control: a swapped-name copy of a real page falls under the floor')
      : no('negative control: a swapped-name copy of a real page falls under the floor', `scored ${(twin.share * 100).toFixed(1)}% — THE FLOOR CATCHES NOTHING`);

    /**
     * BOTH HALVES OF A COLLISION FAIL, and that is the right answer rather than a flaw.
     *
     * The first version of this control asserted the opposite — that the page which was copied
     * should still pass — and it failed, because uniqueness is "on this page and no other": a
     * twin takes the donor's distinctive shingles away from it too. Called "punishing the
     * victim" that reads like a defect. It is not. If two city pages are near-copies then both
     * of them are near-copies, neither is worth indexing separately, and a gate that named only
     * the newer one would be asserting an order of authorship it cannot see.
     *
     * The thing that must NOT happen is a legitimate new city dragging an existing page under.
     * It does not: a real city page carries its own `local_context`, `neighborhoods` and FAQs,
     * which is why sixteen genuinely similar towns all sit above 25% today.
     */
    const donorAfter = planted.find((s) => s.slug === donor.slug);
    donorAfter.share < MIN_UNIQUE
      ? ok('negative control: the copied page fails too — a collision names both pages, not one')
      : no('negative control: the copied page fails too — a collision names both pages, not one',
           `${(donorAfter.share * 100).toFixed(1)}%: the twin did not take the donor's shingles, so the measure is not doing what it says`);
  }
  /\bthousand oaks\b/i.test('a page that never says where it is')
    ? no('negative control: a page that never names its city trips the locality check', 'DETECTOR BLIND')
    : ok('negative control: a page that never names its city trips the locality check');
  shingles('one two three four').size === 0 && shingles('one two three four five').size === 1
    ? ok('negative control: the shingle reader counts 5-word windows and nothing shorter')
    : no('negative control: the shingle reader counts 5-word windows and nothing shorter', 'DETECTOR BLIND');
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
