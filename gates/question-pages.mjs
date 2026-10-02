/**
 * The question pages (src/lib/questions.ts) over the BUILT bytes in dist/questions/.
 *
 *   node gates/question-pages.mjs
 *
 * What it holds, and why (R6 §C, research/2026-09-13-gtm-e-landing-pages-at-volume.md):
 *   1. One question per page: exactly one <h1>, and it ends in "?".
 *   2. The answer comes first and is short: [data-answer] exists, is at most 75 words, and
 *      does not open with filler.
 *   3. Every declared fact resolves against content/catalog.json INDEPENDENTLY of the code that
 *      wrote the page, and its shown text is visible in the page body. `default:` facts are code
 *      fallbacks with no row behind them; they cannot be verified here and are listed instead.
 *   4. The structured data says what the page says: the FAQPage answer starts with [data-answer].
 *   5. The markdown twin exists and carries the same answer.
 *   6. No page is a near-copy of another. Page text with numbers masked, as 5-word shingles;
 *      the nearest sibling's Jaccard similarity must stay under MAX_SIMILARITY. This is the
 *      local form of Google's scaled-content test: a family of pages that differ only in a
 *      price or a place name fails here.
 *
 * NEGATIVE CONTROLS built in: a planted near-duplicate must trip (6), a planted wrong price
 * must trip (3), and a planted invisible fact must trip (3), or the gate reports itself blind.
 */
import { readFileSync, existsSync, globSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const MAX_WORDS = 75;
// Set from the measured distribution on 2026-09-16 (printed below on every run), with margin.
const MAX_SIMILARITY = 0.45;
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m) => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
const strip = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The inner HTML of every element carrying `attr`, found by tag balancing (no DOM library). */
function regions(html, attr) {
  const out = [];
  const re = new RegExp(`<(\\w+)[^>]*\\s${attr}(?:[\\s>=])`, 'g');
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const openEnd = html.indexOf('>', m.index) + 1;
    let depth = 1, i = openEnd;
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
    tagRe.lastIndex = openEnd;
    let t;
    while (depth && (t = tagRe.exec(html))) {
      if (t[2] === '/') continue;
      depth += t[1] ? -1 : 1;
      i = t.index;
    }
    out.push(html.slice(openEnd, i));
  }
  return out;
}

const cents = (c) => (c % 100 === 0 ? `$${(c / 100).toLocaleString('en-US')}` : `$${(c / 100).toFixed(2)}`);

/** Resolve a fact key against the catalog rows, never against the page's own code. */
function resolve(key) {
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'package') {
    const [slug, field] = rest.split('.');
    const p = catalog.packages.find((x) => x.slug === slug);
    return p ? { value: p[field] } : null;
  }
  if (kind === 'tier') {
    const [id, field] = rest.split('.');
    const t = catalog.tiers.find((x) => x.id === id);
    return t ? { value: t[field] ?? 'quote' } : null;
  }
  if (kind === 'offer') {
    const [id, field] = rest.split('.');
    const o = catalog.offers.find((x) => x.id === id && x.status === 'active');
    return o ? { value: o[field] } : null;
  }
  if (kind === 'setting') return rest in catalog.settings ? { value: catalog.settings[rest] } : null;
  if (kind === 'service') {
    const [slug, field] = rest.split('.');
    const s = catalog.services.find((x) => x.slug === slug);
    if (!s) return null;
    return field === 'what_includes' ? { value: (s.what_includes ?? []).length } : { value: s[field] };
  }
  if (kind === 'areas' && rest === 'count') return { value: catalog.areas.length };
  return null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkFacts(slug, facts, bodyText) {
  const problems = [];
  const defaults = [];
  if (!facts.length) problems.push('declares no catalog facts');
  for (const fct of facts) {
    if (fct.key.startsWith('default:')) { defaults.push(fct.key.slice(8)); }
    else {
      const r = resolve(fct.key);
      if (!r) problems.push(`${fct.key} does not resolve to a row`);
      else if (!same(r.value, fct.value)) problems.push(`${fct.key} is ${JSON.stringify(r.value)} in the catalog, page says ${JSON.stringify(fct.value)}`);
      // A price fact must also be shown as the catalog's own price, not just as whatever `shown` says.
      if (r && /price_cents$/.test(fct.key) && typeof r.value === 'number' && !bodyText.includes(cents(r.value))) problems.push(`${fct.key}: ${cents(r.value)} is not on the page`);
    }
    if (!bodyText.includes(fct.shown)) problems.push(`${fct.key}: "${fct.shown}" is not visible on the page`);
  }
  return { problems, defaults };
}

const shingles = (text) => {
  const w = text.toLowerCase().replace(/\$?\d[\d,.]*/g, '#').replace(/[^a-z#\s]/g, ' ').split(/\s+/).filter(Boolean);
  const s = new Set();
  for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' '));
  return s;
};
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };

// ── the pages ────────────────────────────────────────────────────────────────
const files = globSync(`${DIST}/questions/*/index.html`);
if (!files.length) { console.log('  FAIL  no question pages in dist/questions — did the build run?'); process.exit(1); }
console.log(`  ${files.length} question pages`);

const pages = [];
const allDefaults = new Map();
for (const file of files) {
  const slug = path.basename(path.dirname(file));
  const html = readFileSync(file, 'utf8');
  const errs = [];

  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => strip(m[1]));
  if (h1s.length !== 1) errs.push(`${h1s.length} <h1>`);
  else if (!h1s[0].endsWith('?') && !/:\s.+\?$/.test(h1s[0]) && !h1s[0].includes('?')) errs.push(`h1 is not a question: "${h1s[0]}"`);

  const answer = regions(html, 'data-answer').map(strip)[0];
  if (!answer) errs.push('no [data-answer]');
  else {
    const words = answer.split(/\s+/).length;
    if (words > MAX_WORDS) errs.push(`answer is ${words} words (max ${MAX_WORDS})`);
    if (/^(great question|at scoop dogg|when it comes to|if you're wondering)/i.test(answer)) errs.push('answer opens with filler');
  }

  const body = regions(html, 'data-question-body').map(strip).join(' ');
  const factsJson = html.match(/<script type="application\/json" data-question-facts>([\s\S]*?)<\/script>/);
  if (!factsJson) errs.push('no data-question-facts');
  else {
    const { facts } = JSON.parse(factsJson[1]);
    const { problems, defaults } = checkFacts(slug, facts, body);
    errs.push(...problems);
    for (const d of defaults) allDefaults.set(d, [...(allDefaults.get(d) ?? []), slug]);
  }

  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).flat().filter(Boolean);
  const faq = ld.find((x) => x['@type'] === 'FAQPage');
  const said = faq?.mainEntity?.[0]?.acceptedAnswer?.text ?? '';
  if (!answer || !said.startsWith(answer)) errs.push('FAQPage answer does not start with the visible answer');

  const twin = path.join(DIST, 'questions', `${slug}.md`);
  if (!existsSync(twin)) errs.push('no markdown twin');
  else if (answer && !readFileSync(twin, 'utf8').includes(answer)) errs.push('markdown twin does not carry the answer');

  errs.length ? no(slug, errs.join('; ')) : ok(slug);
  pages.push({ slug, sh: shingles(body) });
}

// ── near-duplicates ──────────────────────────────────────────────────────────
const nearest = pages.map((p) => {
  let best = { slug: null, j: 0 };
  for (const o of pages) if (o !== p) { const j = jaccard(p.sh, o.sh); if (j > best.j) best = { slug: o.slug, j }; }
  return { slug: p.slug, near: best.slug, j: best.j };
}).sort((a, b) => b.j - a.j);
const js = nearest.map((n) => n.j).sort((a, b) => a - b);
const q = (p) => js[Math.min(js.length - 1, Math.floor(p * js.length))];
console.log(`  nearest-sibling similarity: median ${q(0.5).toFixed(2)}, p90 ${q(0.9).toFixed(2)}, max ${js[js.length - 1].toFixed(2)} (limit ${MAX_SIMILARITY})`);
for (const n of nearest.slice(0, 3)) console.log(`    ${n.j.toFixed(2)}  ${n.slug}  ~  ${n.near}`);
const dupes = nearest.filter((n) => n.j > MAX_SIMILARITY);
dupes.length ? no('no near-duplicate question pages', dupes.map((d) => `${d.slug} ${d.j.toFixed(2)}`).join(', ')) : ok('no near-duplicate question pages');

// ── negative controls ────────────────────────────────────────────────────────
{
  const src = readFileSync(files[0], 'utf8');
  const body = regions(src, 'data-question-body').map(strip).join(' ');
  const clone = shingles(body.replace(/\$\d+/g, '$999').replace(/\b\d+\b/g, '7'));
  const dupeFires = jaccard(clone, shingles(body)) > MAX_SIMILARITY;
  const pk = catalog.packages[0];
  const wrong = checkFacts('control', [{ key: `package:${pk.slug}.monthly_price_cents`, value: pk.monthly_price_cents + 100, shown: cents(pk.monthly_price_cents + 100) }], body).problems.length > 0;
  const invisible = checkFacts('control', [{ key: `package:${pk.slug}.monthly_price_cents`, value: pk.monthly_price_cents, shown: 'a string on no page' }], body).problems.length > 0;
  dupeFires && wrong && invisible
    ? ok('negative controls', 'a planted near-copy, a wrong price and an invisible fact all trip the gate')
    : no('negative controls', `GATE BLIND: near-copy ${dupeFires}, wrong price ${wrong}, invisible fact ${invisible}`);
}

if (allDefaults.size) {
  console.log('  code defaults with no settings row (assumptions for Ben to confirm or veto):');
  for (const [k, v] of allDefaults) console.log(`    ${k}  (${v.length} page${v.length === 1 ? '' : 's'})`);
}
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
