/**
 * An owner's edit reaches the public pages with NO rebuild — held by structure, at HEAD.
 *
 *   node gates/no-rebuild-path.mjs
 *
 * The rule (Ben, restated 2026-09-27 after the build broke it): anything Josue edits in his admin
 * is live on the public site in seconds, with no rebuild and no publish button. gates/live-edit.mjs
 * proves it end to end on a deployed preview. This gate runs in `npm run gates` and holds the
 * pieces that make it true, so a change that quietly brings the build-time path back goes red here
 * before anyone deploys it:
 *
 *   1. Every page renders on demand. `export const prerender = true` on a page would freeze it.
 *   2. No page, component or layout imports content/catalog.json or content/demo.json. Those files
 *      are the gates' own copy of the rows now (scripts/pull-catalog.mjs); a page importing one
 *      is a page that shows the value as of the last build.
 *   3. The BUILT function tags a rendered page for the CDN (Vercel-Cache-Tag) and holds only 200s.
 *      Read off a real response from .vercel/output, not off the source.
 *   4. Every admin write that can touch a public page purges that tag. Read from api/admin.ts's
 *      own denylist, and tried against every path that writes owner data.
 *   5. The deploy-hook publish is gone: no VERCEL_DEPLOY_HOOK_URL reader, no `publish` route, no
 *      "next publish" sentence anywhere a screen can print it.
 *
 * Each check has a negative control that shows the check can see the thing it forbids.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ` — ${d}` : ''}`); };
const no = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); };
const check = (c, n, d) => (c ? ok(n, d) : no(n, d));
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const read = (f) => readFileSync(f, 'utf8');

// 1. on demand
{
  const cfg = read('astro.config.mjs');
  check(/output:\s*'server'/.test(cfg) && /adapter:\s*vercel\(/.test(cfg), 'astro renders on demand with the Vercel adapter');
  const PRERENDER = /export\s+const\s+prerender\s*=\s*true/;
  const frozen = walk('src/pages').filter((f) => PRERENDER.test(read(f)));
  check(frozen.length === 0, 'no page is prerendered', frozen.join(', ') || `${walk('src/pages').length} page files`);
  check(PRERENDER.test('---\nexport const prerender = true;\n---'), 'NEGATIVE CONTROL: the prerender pattern matches a prerendered page');
}

// 2. no build-time catalog in a page
{
  const IMPORTS_FILE = /from\s+['"][^'"]*content\/(catalog|demo)\.json['"]/;
  const readers = walk('src').filter((f) => /\.(astro|tsx?|mjs)$/.test(f) && IMPORTS_FILE.test(read(f)));
  check(readers.length === 0, 'nothing under src/ imports content/catalog.json or content/demo.json', readers.join(', ') || 'the pages read the rows per render');
  check(IMPORTS_FILE.test(`import raw from '../../content/catalog.json';`), 'NEGATIVE CONTROL: the import pattern matches the line catalog.ts used to carry');
  const mw = read('src/middleware.ts');
  check(/loadPublicSnapshot\(/.test(mw) && /setCatalog\(/.test(mw) && /setDemo\(/.test(mw), 'the middleware reads the rows and hands them to the catalog and demo modules on every render');
}

// 3. the built function tags pages for the CDN
{
  const FUNC = path.resolve('.vercel/output/functions/_render.func/dist/server/entry.mjs');
  if (!existsSync(FUNC)) no('the built function exists', 'run `npm run build` first');
  else {
    const { default: handler } = await import(pathToFileURL(FUNC).href);
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const { SITE_CACHE_TAG } = { SITE_CACHE_TAG: /SITE_CACHE_TAG = '([^']+)'/.exec(read('server/lib/site-cache.ts'))[1] };
    for (const route of ['/', '/pricing', '/services/weekly-pooper-scooper-service']) {
      const r = await fetch(base + route);
      const tag = r.headers.get('vercel-cache-tag'), cdn = r.headers.get('vercel-cdn-cache-control'), cc = r.headers.get('cache-control');
      check(r.status === 200 && tag === SITE_CACHE_TAG && /max-age=\d+/.test(cdn ?? '') && /max-age=0/.test(cc ?? ''),
        `${route} is held at the CDN under the purge tag and revalidated by browsers`, `${r.status} tag=${tag} cdn=${cdn} browser=${cc}`);
    }
    const nf = await fetch(`${base}/services/no-such-service-${Date.now()}`);
    check(nf.status === 404 && !nf.headers.get('vercel-cache-tag') && /no-store/.test(nf.headers.get('cache-control') ?? ''),
      'NEGATIVE CONTROL: a 404 is not held at the CDN, so a service brought back is not hidden behind it', `${nf.status} ${nf.headers.get('cache-control')}`);
    server.close();
  }
}

// 4. every owner-data write purges
{
  const admin = read('api/admin.ts');
  const m = /const NEVER_PUBLIC = \/(.+)\/;/.exec(admin);
  check(!!m && /await purgeSite\(\)/.test(admin), 'api/admin.ts purges the page cache after a write', m ? 'denylist found' : 'no NEVER_PUBLIC');
  if (m) {
    const NEVER = new RegExp(m[1]);
    // Every admin path that writes something a public page prints. A path missing here that a
    // public page reads is caught by live-edit.mjs on a preview; this list is the fast half.
    const OWNER_DATA = ['rate-card/tier', 'rate-card/tier-new', 'rate-card/package', 'rate-card/bands', 'settings', 'demo',
      'checklist/business', 'checklist/area', 'checklist/route-days', 'checklist/prices/confirm',
      'offers', 'offers/new', 'services', 'services/new', 'areas/days', 'areas/bookable', 'business', 'quote-facts'];
    const missed = OWNER_DATA.filter((p) => NEVER.test(p));
    check(missed.length === 0, 'every owner-data write path purges', missed.join(', ') || `${OWNER_DATA.length} paths`);
    check(NEVER.test('visits/complete') && NEVER.test('login/start'), 'NEGATIVE CONTROL: a crew visit and a sign-in do not purge the site');
  }
}

// 5. the publish path is gone
{
  const src = [...walk('src'), ...walk('server'), ...walk('api')].filter((f) => /\.(astro|tsx?|mjs)$/.test(f));
  const hook = src.filter((f) => /VERCEL_DEPLOY_HOOK_URL|deploy[_ ]hook/i.test(read(f)) && !f.endsWith('site-cache.ts'));
  check(hook.length === 0 && !existsSync('server/lib/publish.ts'), 'no deploy hook and no publish module', hook.join(', ') || 'none');
  check(!/path === 'publish'/.test(read('api/admin.ts')), 'the admin has no publish route');
  const COPY = /next publish|published again|Publish the website|effective_on_publish|public_pages_need_publish/;
  const copy = src.filter((f) => COPY.test(read(f)));
  check(copy.length === 0, 'no screen says a change waits for a publish', copy.join(', ') || 'none');
  check(COPY.test('the public pages show it at the next publish.'), 'NEGATIVE CONTROL: the copy pattern matches the sentence the rate card used to print');
}

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
