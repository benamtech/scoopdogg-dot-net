/**
 * The journey hypergraph: every page, every door into a funnel, and whether they agree.
 *
 *   node scripts/journey-graph.mjs [--base http://127.0.0.1:4330] [--out <file.json>]
 *
 * WHY A HYPERGRAPH AND NOT A LINK GRAPH. A link graph says page A links to page B. A booking is
 * not a pair: it is one visitor on one PAGE TYPE, wanting one SERVICE, pressing one CONTROL, and
 * landing on one FUNNEL STATE. That is a four-way relation, and the defects that cost bookings
 * live in the relation rather than in any pair — a homepage card and a service page each had a
 * valid link for the same service, and they led to two different places. So each door is one
 * hyperedge {page, page-type, service, control, target, parameters}, and the questions are asked
 * of sets of hyperedges:
 *
 *   DOOR AGREEMENT   for one service, do all its doors lead to the same funnel?
 *   FIRST SCREEN     per page type, is there a door on the first phone screen (844px)?
 *   CONTEXT KEPT     of the doors on a page about a service, how many carry that service?
 *   REACH            how much of the site's internal link weight (PageRank over main-content
 *                    links) lands on each page type, and which pages nothing points at
 *
 * It reads the rendered pages in a real browser at 390px, because "on the first screen" is a
 * fact about pixels. It writes nothing and submits nothing. No dependencies beyond Playwright;
 * the PageRank is forty lines below.
 *
 * FIRST RUN, 2026-10-02, against the preview that existed that morning: 4 of 11 services had
 * doors that agreed (the seven one-time services opened on /book from the homepage and on
 * /contact from their own page), and 0 of 16 city pages had a door on the first screen. After
 * the same day's changes: 11 of 11 and 16 of 16. R18 §0 holds the numbers and what they changed.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : fallback; };
const base = arg('--base', 'http://127.0.0.1:4330');
const out = arg('--out', null);
const FOLD = 844;

const xml = await (await fetch(`${base}/sitemap-0.xml`)).text();
const paths = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, '') || '/'))];
const typeOf = (p) => (p === '/' ? 'home' : p.startsWith('/services/') ? 'service' : p.startsWith('/areas/') ? 'city'
  : p.startsWith('/questions/') ? 'question' : p.startsWith('/resources/') ? 'guide' : p.slice(1));
const FUNNELS = /^\/(book|custom-quote|contact)(\?|$)/;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: FOLD } });
const pages = {};
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < paths.length) {
    const path = paths[next++];
    const page = await ctx.newPage();
    try {
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(700);
      pages[path] = await page.evaluate(() => {
        const region = (el) => (el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : el.closest('[data-mobile-cta]') ? 'bar' : 'main');
        const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
        const links = [...document.querySelectorAll('a[href]')].filter(shown).map((a) => {
          const u = new URL(a.href, location.href);
          return { href: u.origin === location.origin ? (u.pathname.replace(/\/$/, '') || '/') + u.search : a.href, region: region(a), y: Math.round(a.getBoundingClientRect().top + scrollY), cta: a.dataset.cta ?? null };
        });
        const forms = [...document.querySelectorAll('form[action]')].filter(shown).filter((f) => (f.getAttribute('method') || 'get').toLowerCase() === 'get').map((f) => ({
          href: f.getAttribute('action') + '?' + [...f.querySelectorAll('input[type=hidden]')].map((i) => `${i.name}=${i.value}`).join('&'),
          region: region(f), y: Math.round(f.getBoundingClientRect().bottom + scrollY), control: f.dataset.source ?? 'form',
        }));
        const main = document.querySelector('main');
        return { links, forms, words: main ? main.innerText.split(/\s+/).length : 0, stars: main ? /\b[45]\.\d\b/.test(main.innerText.slice(0, 2500)) : false };
      });
    } catch (e) { pages[path] = { error: String(e).slice(0, 120), links: [], forms: [] }; }
    await page.close();
  }
}));
await browser.close();

// ---- hyperedges: one per door ---------------------------------------------------------------
const serviceSlugs = paths.filter((p) => p.startsWith('/services/')).map((p) => p.split('/')[2]);
const param = (href, k) => new URLSearchParams(href.split('?')[1] ?? '').get(k);
const doors = [];
for (const [path, p] of Object.entries(pages)) {
  const pageService = path.startsWith('/services/') ? path.split('/')[2] : null;
  for (const l of p.links) {
    if (l.region !== 'main' || !FUNNELS.test(l.href)) continue;
    doors.push({ page: path, type: typeOf(path), control: l.cta ?? 'link', target: l.href.split('?')[0], service: param(l.href, 'service') ?? (param(l.href, 'package') ? 'package' : null), pageService, y: l.y, kind: 'link' });
  }
  for (const f of p.forms) {
    if (f.region !== 'main' || !FUNNELS.test(f.href)) continue;
    doors.push({ page: path, type: typeOf(path), control: f.control, target: f.href.split('?')[0], service: param(f.href, 'service'), pageService, y: f.y, kind: 'form' });
  }
}

// ---- the four questions ---------------------------------------------------------------------
const byType = {};
for (const path of Object.keys(pages)) (byType[typeOf(path)] ??= []).push(path);
const firstScreen = Object.fromEntries(Object.entries(byType).map(([t, ps]) => [t, {
  pages: ps.length,
  with_door_on_first_screen: ps.filter((p) => doors.some((d) => d.page === p && d.y < FOLD)).length,
  with_proof_near_top: ps.filter((p) => pages[p].stars).length,
}]));

/**
 * A service's doors AGREE when the first door for it on every page leads to the same funnel, and
 * no door anywhere leads to a page that does not read `service`. A second door to the quote lane
 * is not a disagreement: a service page prices its largest size as "Custom quote" and links that
 * one row to /custom-quote, which reads the service. /contact reads nothing, so any door to it
 * with a service attached is a visitor who has to say again what they wanted.
 */
const agreement = Object.fromEntries(serviceSlugs.map((s) => {
  const mine = doors.filter((d) => d.service === s);
  const targets = [...new Set(mine.map((d) => d.target))];
  const firstPerPage = [...new Set(mine.map((d) => d.page))].map((pg) => mine.filter((d) => d.page === pg).sort((a, b) => a.y - b.y)[0].target);
  const primary = [...new Set(firstPerPage)];
  return [s, { doors: mine.length, targets, primary, agree: primary.length === 1 && !targets.includes('/contact'), from_types: [...new Set(mine.map((d) => d.type))] }];
}));

const servicePages = byType.service ?? [];
const contextKept = {
  service_pages: servicePages.length,
  doors_on_service_pages: doors.filter((d) => d.type === 'service').length,
  carrying_the_service: doors.filter((d) => d.type === 'service' && (d.service === d.pageService || d.service === 'package')).length,
};

function pagerank(filter) {
  const nodes = Object.keys(pages); const idx = Object.fromEntries(nodes.map((n, i) => [n, i]));
  const outs = nodes.map(() => new Set());
  for (const [p, d] of Object.entries(pages)) for (const l of d.links) {
    if (!filter(l)) continue;
    const t = l.href.split('?')[0]; if (t in idx && t !== p) outs[idx[p]].add(idx[t]);
  }
  let r = nodes.map(() => 1 / nodes.length);
  for (let it = 0; it < 60; it++) {
    const nr = nodes.map(() => 0.15 / nodes.length); let dangling = 0;
    outs.forEach((o, i) => { if (!o.size) dangling += r[i]; else for (const j of o) nr[j] += (0.85 * r[i]) / o.size; });
    r = nr.map((x) => x + (0.85 * dangling) / nodes.length);
  }
  const indeg = nodes.map(() => 0); outs.forEach((o) => o.forEach((j) => indeg[j]++));
  return nodes.map((n, i) => ({ page: n, rank: r[i], inbound: indeg[i] }));
}
const pr = pagerank((l) => l.region === 'main');
const reach = Object.fromEntries(Object.entries(byType).map(([t, ps]) => [t, Number(pr.filter((x) => ps.includes(x.page)).reduce((n, x) => n + x.rank, 0).toFixed(4))]));
const weak = pr.filter((x) => x.inbound <= 1 && x.page !== '/').map((x) => `${x.page} (${x.inbound})`);

const report = {
  base, measured: new Date().toISOString(), pages: Object.keys(pages).length, doors: doors.length,
  services_whose_doors_agree: `${Object.values(agreement).filter((a) => a.agree).length} of ${serviceSlugs.length}`,
  first_screen: firstScreen, door_agreement: agreement, context_kept: contextKept,
  reach_by_page_type: reach, pages_with_one_or_no_inbound_content_link: weak,
};
if (out) fs.writeFileSync(out, JSON.stringify({ ...report, hyperedges: doors }, null, 1));

console.log(`${report.pages} pages, ${report.doors} doors into a funnel, measured at 390x${FOLD} against ${base}\n`);
console.log('FIRST SCREEN — pages with a door above the fold, and with a review score near the top');
for (const [t, v] of Object.entries(firstScreen).sort()) console.log(`  ${t.padEnd(14)} ${String(v.with_door_on_first_screen).padStart(2)}/${String(v.pages).padEnd(3)} door   ${String(v.with_proof_near_top).padStart(2)}/${v.pages} proof`);
console.log(`\nDOOR AGREEMENT — ${report.services_whose_doors_agree} services have doors that all lead to one funnel`);
for (const [s, a] of Object.entries(agreement)) console.log(`  ${a.agree ? 'ok ' : 'NO '} ${s.padEnd(32)} ${String(a.doors).padStart(2)} doors, first door on each page -> ${a.primary.join(' + ')}${a.targets.length > a.primary.length ? `   (also ${a.targets.filter((t) => !a.primary.includes(t)).join(', ')})` : ''}`);
console.log(`\nCONTEXT KEPT — ${contextKept.carrying_the_service} of ${contextKept.doors_on_service_pages} doors on service pages carry that page's service`);
console.log('\nREACH — share of internal link weight by page type');
for (const [t, v] of Object.entries(reach).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(14)} ${(v * 100).toFixed(1)}%`);
console.log(`\nONE OR NO INBOUND CONTENT LINK: ${weak.join(', ') || 'none'}`);
