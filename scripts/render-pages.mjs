/**
 * Render every page through the BUILT server and write the HTML into dist/, for the gates.
 *
 *   node scripts/render-pages.mjs          (npm run build runs it after `astro build`)
 *
 * WHY. Since 2026-09-29 no page is prerendered: each renders on demand from the live rows
 * (src/middleware.ts), so an owner's edit is live with no rebuild. That left the gates that read
 * built HTML (build-gates, question-pages, orphan-pages, city-pages, no-price-in-prose, ...) with
 * nothing to read. This serves the function Vercel will run — .vercel/output/functions/_render.func,
 * the same bundle, the same middleware, the same database read — on a local port, asks it for every
 * page, and writes each response where the static build used to put it:
 *
 *   /             -> dist/index.html          /questions/x.md -> dist/questions/x.md
 *   /about        -> dist/about/index.html    /llms.txt       -> dist/llms.txt
 *   (the 404 page) -> dist/404.html           /sitemap-*.xml  -> dist/sitemap-*.xml
 *
 * So a gate reads what a visitor would receive, not a second rendering path. The list of pages is
 * every page file in src/pages plus every URL the live sitemap names, so a service or question the
 * rows add is rendered and gated without anyone listing it.
 *
 * A PAGE THAT DOES NOT ANSWER 200 STOPS THE BUILD. A gate reading a half-rendered dist/ would pass
 * on the pages that exist and never see the one that failed.
 */
import http from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from './_env.mjs';

loadEnv();
const FUNC = path.resolve('.vercel/output/functions/_render.func/dist/server/entry.mjs');
if (!existsSync(FUNC)) { console.error('[render] no built function — run `astro build` first'); process.exit(1); }
const OUT = path.resolve('dist');

const { default: handler } = await import(pathToFileURL(FUNC).href);
const server = http.createServer((req, res) => handler(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Page files, as routes. Dynamic ones ([slug]) come from the sitemap instead.
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const fileRoutes = walk('src/pages')
  .filter((f) => f.endsWith('.astro') && !f.includes('['))
  .map((f) => '/' + path.relative('src/pages', f).replace(/\\/g, '/').replace(/\.astro$/, '').replace(/(^|\/)index$/, ''))
  .map((r) => (r === '/' ? '/' : r.replace(/\/$/, '')))
  .filter((r) => r !== '/404');

let failed = 0;
const get = async (route) => {
  const r = await fetch(base + route, { redirect: 'manual' });
  return { status: r.status, body: await r.text() };
};
const write = (file, body) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, body); };

// Clear what an earlier render left, so a page the rows no longer have cannot linger on disk.
for (const f of existsSync(OUT) ? readdirSync(OUT) : []) {
  if (f !== 'client' && f !== 'server') rmSync(path.join(OUT, f), { recursive: true, force: true });
}

const sitemap = await get('/sitemap-0.xml');
if (sitemap.status !== 200) { console.error(`[render] /sitemap-0.xml answered ${sitemap.status}`); process.exit(1); }
const sitemapRoutes = [...sitemap.body.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1] || '/');
const questionRoutes = sitemapRoutes.filter((r) => /^\/questions\/[^/]+$/.test(r));

const pages = [...new Set([...fileRoutes, ...sitemapRoutes])].sort();
const endpoints = ['/llms.txt', '/sitemap-index.xml', '/sitemap-0.xml', ...questionRoutes.map((r) => `${r}.md`)];

const queue = [...pages.map((p) => ['page', p]), ...endpoints.map((p) => ['file', p])];
const results = [];
// A few at a time: each render reads the database, and the pool is three connections.
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const [kind, route] = job;
    const r = await get(route);
    if (r.status !== 200) { failed++; console.error(`  FAIL  ${route} answered ${r.status}`); continue; }
    const file = kind === 'file' ? path.join(OUT, route) : route === '/' ? path.join(OUT, 'index.html') : path.join(OUT, route, 'index.html');
    write(file, r.body);
    results.push(route);
  }
}));
// The 404 page, from a URL that cannot exist, and it must SAY 404.
const nf = await get(`/this-page-does-not-exist-${Date.now()}`);
if (nf.status !== 404) { failed++; console.error(`  FAIL  an unknown URL answered ${nf.status}, not 404`); }
else write(path.join(OUT, '404.html'), nf.body);

server.close();
console.log(`[render] ${results.length} routes rendered by the built function into dist/ (${pages.length} pages, ${endpoints.length} files)${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
