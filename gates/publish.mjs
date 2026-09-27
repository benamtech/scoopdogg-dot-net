/**
 * "Published" is only ever said when the live site carries the change.
 *
 *   node gates/publish.mjs
 *
 * server/lib/publish.ts fires a Vercel deploy hook and then judges the result from the LIVE SITE:
 * a publish is live when the site's pages carry a newer <meta name="sd-catalog-pulled-at"> than the
 * request. This gate runs every branch of that against two local HTTP servers — one standing in for
 * the hook, one for the site — with the shipped functions and this gate's own client inside a
 * transaction that is rolled back. Then it checks the one thing a local server cannot: that the
 * pages this build produced really carry the meta the verifier reads, with the catalog's own time.
 */
import pg from 'pg';
import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const out = compileServer();
const { requestPublish, publishStatus } = await import(path.resolve(out, 'server/lib/publish.js'));

// Two servers: the hook (answers `hookStatus`, counts calls) and the site (serves `builtAt`).
let hookStatus = 200, hookCalls = 0, builtAt = null;
const serve = (fn) => new Promise((res) => { const s = http.createServer(fn).listen(0, '127.0.0.1', () => res(s)); });
const hook = await serve((req, r) => { hookCalls++; r.writeHead(hookStatus, { 'content-type': 'application/json' }); r.end('{"job":{"id":"gate"}}'); });
const site = await serve((req, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<html><head>${builtAt ? `<meta name="sd-catalog-pulled-at" content="${builtAt}">` : ''}</head><body>site</body></html>`); });
const hookUrl = `http://127.0.0.1:${hook.address().port}/hook`;
process.env.PUBLIC_SITE_URL = `http://127.0.0.1:${site.address().port}`;

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query('begin');
  const n = async () => (await c.query(`select count(*)::int as n from content_publishes`)).rows[0].n;

  console.log('A. nothing configured, nothing claimed');
  delete process.env.VERCEL_DEPLOY_HOOK_URL;
  const n0 = await n();
  let refused = null;
  try { await requestPublish(c, { by: 'gate', reason: 'gate' }); } catch (e) { refused = e.code; }
  check(refused === 'not_configured' && (await n()) === n0, 'with no hook, publish refuses in a sentence and writes no row', `code ${refused}`);
  check((await publishStatus(c)).configured === false, 'the screen is told publishing is not set up here');

  console.log('\nB. the hook answers');
  process.env.VERCEL_DEPLOY_HOOK_URL = hookUrl;
  const r1 = await requestPublish(c, { by: 'gate', reason: 'gate: B' });
  check(r1.state === 'building' && hookCalls === 1, 'a publish fires the hook once and is building, not live', `${r1.state}, ${hookCalls} call`);

  console.log('\nC. the site has not caught up, then it has');
  builtAt = new Date(Date.now() - 3600_000).toISOString();
  let st = await publishStatus(c);
  check(st.publishes.find((p) => Number(p.id) === r1.id)?.state === 'building', 'NEGATIVE CONTROL: a site built BEFORE the request does not make it live');
  builtAt = null;
  st = await publishStatus(c);
  check(st.publishes.find((p) => Number(p.id) === r1.id)?.state === 'building', 'a site that says nothing about its build does not make it live either');
  builtAt = new Date(Date.now() + 60_000).toISOString();
  st = await publishStatus(c);
  check(st.publishes.find((p) => Number(p.id) === r1.id)?.state === 'live', 'it is live once the site serves pages built from a newer catalog');

  console.log('\nD. the hook refuses');
  hookStatus = 500;
  const r2 = await requestPublish(c, { by: 'gate', reason: 'gate: D' });
  check(r2.state === 'failed', 'a refused hook is recorded as failed, never as building', r2.state);
} catch (e) {
  no('the gate ran to the end', String(e?.message ?? e).split('\n')[0]);
} finally {
  await c.query('rollback').catch(() => {});
  await c.end();
  hook.close(); site.close();
  cleanupCompile();
}

console.log('\nE. the built pages carry what the verifier reads');
if (!existsSync('dist/index.html')) no('dist/index.html exists', 'build first');
else {
  const html = readFileSync('dist/index.html', 'utf8');
  const meta = /<meta\s+name="sd-catalog-pulled-at"\s+content="([^"]+)"/i.exec(html)?.[1] ?? null;
  const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8')).pulled_at;
  check(meta && meta === catalog, 'the home page carries the catalog time it was built from', meta ?? 'no meta');
}

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
