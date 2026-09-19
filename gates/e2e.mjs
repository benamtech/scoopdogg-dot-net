/**
 * Deep end-to-end check over the built site. Structure, content, accessibility,
 * weight and structured data. Run after `npm run build`.
 *
 *   node gates/e2e.mjs
 */
import { readFileSync, globSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const allPages = globSync(`${DIST}/**/index.html`).sort();
// The checks below are about pages a search engine reads. /admin/* is an application:
// noindex, robots-disallowed and out of the sitemap, so a meta description and a
// self-referencing canonical are meaningless there. gates/build-gates.mjs carries the
// admin-specific gates instead.
const pages = allPages.filter((f) => path.relative(DIST, f).split(path.sep)[0] !== 'admin');
// Same reasoning one step further: /account and /book/complete ship `robots: noindex, nofollow`.
// A meta-description length, a self-referencing canonical and a structured-data block are rules
// about a search result, and these pages do not have one. Scoring them as content is how this
// gate came to report seven failures of which five were the gate misreading its own scope.
const noindex = (f) => /<meta name="robots"[^>]*content="[^"]*noindex/i.test(readFileSync(f, 'utf8'));
const indexed = pages.filter((f) => !noindex(f));
const route = (f) => { const r = '/' + path.relative(DIST, path.dirname(f)).replace(/\\/g, '/'); return r === '/.' ? '/' : r; };
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const text = (h) => strip(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let pass = 0, fail = 0, warn = 0;
const P = (n, m='') => { console.log(`  ok    ${n}${m?' — '+m:''}`); pass++; };
const F = (n, m)   => { console.log(`  FAIL  ${n} — ${m}`); fail++; };
const W = (n, m)   => { console.log(`  warn  ${n} — ${m}`); warn++; };

console.log(`\n── STRUCTURE ─────────────────────────────────────────`);
P('pages built', String(pages.length));

// meta description present and a sane length on every page
{
  // `&` is one character to a reader and five (`&#38;`) in the attribute. Measuring the escaped
  // markup made a 214-character description read as 218 and would have hidden one at 198.
  const unescape = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const bad = [];
  for (const f of indexed) {
    const h = readFileSync(f, 'utf8');
    const m = h.match(/<meta name="description" content="([^"]*)"/);
    const n = m ? unescape(m[1]).length : 0;
    if (!m || n < 50 || n > 200) bad.push(`${route(f)} (${n} chars)`);
  }
  bad.length ? F('meta descriptions 50–200 chars', `${bad.length}: ${bad.slice(0,3)}`) : P('meta descriptions 50–200 chars', `${indexed.length} indexable pages`);
}
// canonical on every page, self-referencing
{
  const bad = indexed.filter((f) => {
    const h = readFileSync(f, 'utf8');
    const m = h.match(/<link rel="canonical" href="([^"]+)"/);
    if (!m) return true;
    return new URL(m[1]).pathname.replace(/\/$/, '') !== route(f).replace(/\/$/, '');
  });
  bad.length ? F('canonical is self-referencing', `${bad.length}: ${bad.slice(0,3).map(route)}`) : P('canonical is self-referencing');
}
// heading order: exactly one h1, and an h2 before any h3
{
  const bad = [];
  for (const f of indexed) {
    const h = readFileSync(f, 'utf8');
    const seq = [...h.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
    if (seq.filter((n) => n === 1).length !== 1) bad.push(`${route(f)} h1x${seq.filter(n=>n===1).length}`);
    else if (seq.indexOf(3) !== -1 && seq.indexOf(2) !== -1 && seq.indexOf(3) < seq.indexOf(2)) bad.push(`${route(f)} h3-before-h2`);
  }
  bad.length ? W('heading order', `${bad.length}: ${bad.slice(0,3)}`) : P('heading order');
}

console.log(`\n── ACCESSIBILITY ─────────────────────────────────────`);
// every image needs alt text
{
  // THE ATTRIBUTE MUST BE PRESENT, with or without a value. `alt=""` is the documented way to
  // mark an image decorative, and Astro emits it as a bare `alt` — so a regex requiring `alt=`
  // reported 71 of 248 images "missing alt text" when 69 of them were one correctly-hidden
  // mascot. The gate was wrong, not the site.
  const HAS_ALT = /\balt(?=[\s=>/])/;
  let imgs = 0; const missing = [];
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(/<img\b[^>]*>/gi)) {
      imgs++;
      if (!HAS_ALT.test(m[0])) missing.push(`${route(f)} ${(m[0].match(/src="([^"]*)"/) ?? [, '?'])[1]}`);
    }
  }
  const control = !HAS_ALT.test('<img src="x.png">') && HAS_ALT.test('<img src="x.png" alt>') && HAS_ALT.test('<img src="x.png" alt="a dog">');
  if (!control) F('every image has alt text', 'DETECTOR BLIND — the alt check does not distinguish present from absent');
  else missing.length ? F('every image has alt text', `${missing.length} of ${imgs} missing: ${[...new Set(missing)].slice(0,3)}`)
                      : P('every image has alt text', `${imgs} images, present-or-empty`);
}
// html lang
{
  const bad = pages.filter((f) => !/<html[^>]+lang="/.test(readFileSync(f, 'utf8')));
  bad.length ? F('html lang set', `${bad.length} pages`) : P('html lang set');
}
// brand contrast — derived from the class pairs the BUILT pages actually use, not
// from a hand-written list. A hardcoded pair keeps passing after the code stops using
// it, and keeps failing after the code is fixed; neither tells you about the site.
{
  // THE PALETTE COMES FROM tailwind.config.js, which the config's own header calls "the one place
  // a colour, a size or a radius is decided". The list that used to be here was hand-written and
  // was the PREDECESSOR's - forest/sage/amber/cream/dark - so after the 2026-09-16 rebuild it
  // matched nothing the pages emit and this check quietly measured zero pairs for days. The
  // comment above it already said not to hand-write a list; now it does not.
  const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
    const name = k === 'DEFAULT' ? prefix : (prefix ? `${prefix}-${k}` : k);
    if (typeof v === 'string') return /^#[0-9a-f]{6}$/i.test(v) ? [[name, v]] : [];
    return v && typeof v === 'object' ? flatten(v, name) : [];
  });
  const cfg = (await import('../tailwind.config.js')).default;
  const PALETTE = Object.fromEntries([
    ...flatten(cfg.theme?.extend?.colors ?? {}),
    ['white', '#FFFFFF'], ['black', '#000000'],
  ]);
  const hex = (c) => [1,3,5].map((i) => parseInt(c.slice(i, i+2), 16));
  const lum = (c) => { const [r,g,b] = hex(c).map((v) => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
  const ratio = (a,b) => { const [x,y] = [lum(a), lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05); };

  const used = new Map();   // "fg on bg" -> count
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(/class="([^"]*)"/g)) {
      const cls = m[1].split(/\s+/);
      const bg = cls.find((c) => /^bg-(?!gradient|transparent|white\/|black\/)/.test(c))?.replace(/^bg-/, '');
      const fg = cls.find((c) => /^text-(?!xs|sm|base|lg|xl|\dxl|left|center|right|balance)/.test(c))?.replace(/^text-/, '');
      if (!bg || !fg) continue;
      if (!PALETTE[bg] || !PALETTE[fg]) continue;      // skip opacity variants etc
      const k = `${fg} on ${bg}`;
      used.set(k, (used.get(k) || 0) + 1);
    }
  }
  // A palette that matches nothing is the failure this check was hiding, so it is a FAIL now.
  if (!used.size) F('contrast', `no palette class pairs found in the built HTML (palette has ${Object.keys(PALETTE).length} colours)`);
  for (const [k, count] of [...used.entries()].sort((a,b) => b[1]-a[1])) {
    const [fg, , bg] = k.split(' ');
    const r = ratio(PALETTE[fg], PALETTE[bg]);
    const label = `contrast ${k}`;
    const detail = `${r.toFixed(2)}:1, used ${count}x`;
    if (r >= 4.5) P(label, detail);
    else if (r >= 3) W(label, `${detail} — large text only`);
    else F(label, `${detail} — fails AA`);
  }
}

// translucent grounds — the blind spot the pair check above cannot see. `bg-white/10`
// is not a light background; it is a light film over whatever is behind it, which on
// this site is the dark green booking panel. Dark ink on it is unreadable, and a
// class-pair check reads `bg-white` and calls it fine. Caught by looking at a
// screenshot, not by a gate, so this is the gate.
{
  const suspect = [];
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(/class="([^"]*)"/g)) {
      const c = m[1];
      if (/\bbg-(?:white|black)\/(?:5|10|20|30)\b/.test(c) && /\btext-dark\b/.test(c)) {
        suspect.push(`${route(f)}: ${c.slice(0, 70)}`);
      }
    }
  }
  suspect.length
    ? F('no dark ink on a translucent film', `${suspect.length}: ${suspect.slice(0,2).join(' | ')}`)
    : P('no dark ink on a translucent film');
}

// KNOWN LIMIT, stated rather than implied: everything above reads class names. It cannot
// see a colour set in inline CSS, an image behind text, or a gradient. Only pixels can.
// A human still has to look at the rendered page before it ships.

console.log(`\n── STRUCTURED DATA ───────────────────────────────────`);
{
  let blocks = 0; const bad = [];
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      blocks++;
      try {
        const j = JSON.parse(m[1]);
        const arr = Array.isArray(j) ? j : [j];
        for (const o of arr) if (!o['@context'] || !o['@type']) bad.push(`${route(f)} missing @context/@type`);
      } catch { bad.push(`${route(f)} unparseable`); }
    }
  }
  bad.length ? F('JSON-LD parses and is typed', bad.slice(0,3).join('; ')) : P('JSON-LD parses and is typed', `${blocks} blocks`);
  const without = indexed.filter((f) => !readFileSync(f,'utf8').includes('application/ld+json'));
  without.length ? W('pages without structured data', `${without.length}: ${without.slice(0,4).map(route)}`) : P('every page has structured data');
}

console.log(`\n── WEIGHT ────────────────────────────────────────────`);
{
  const html = pages.map((f) => statSync(f).size);
  const js = globSync(`${DIST}/_astro/*.js`).map((f) => statSync(f).size);
  const img = globSync(`${DIST}/**/*.{png,jpg,jpeg,webp,gif,svg}`).map((f) => statSync(f).size);
  const kb = (n) => `${Math.round(n/1024)}KB`;
  P('html per page', `median ${kb(html.sort((a,b)=>a-b)[html.length>>1])}, largest ${kb(Math.max(...html))}`);
  P('javascript total', `${kb(js.reduce((a,b)=>a+b,0))} across ${js.length} files`);
  P('images total', `${kb(img.reduce((a,b)=>a+b,0))} across ${img.length} files`);
  const heavyHtml = pages.filter((f) => statSync(f).size > 250_000);
  heavyHtml.length ? W('html under 250KB', `${heavyHtml.length} over: ${heavyHtml.slice(0,2).map(route)}`) : P('html under 250KB');
}

console.log(`\n── CRAWLER FILES ─────────────────────────────────────`);
for (const [f, what] of [['robots.txt','robots'], ['llms.txt','llms.txt'], ['sitemap-index.xml','sitemap']]) {
  const p = path.join(DIST, f);
  try { const s = statSync(p).size; s > 20 ? P(what, `${s}B`) : F(what, `only ${s}B`); }
  catch { F(what, 'missing'); }
}
{
  const r = readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
  /Disallow:\s*\/\s*$/m.test(r) ? F('robots does not block the site', 'Disallow: / present') : P('robots does not block the site');
  /Sitemap:/i.test(r) ? P('robots points at a sitemap') : W('robots points at a sitemap', 'no Sitemap line');
}

console.log(`\n══ ${pass} passed, ${warn} warnings, ${fail} failed ══\n`);
process.exit(fail ? 1 : 0);
