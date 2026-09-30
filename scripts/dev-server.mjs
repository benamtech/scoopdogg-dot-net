/**
 * Serve the built site AND the api/ functions locally, the way Vercel routes them, so booking,
 * checkout and the account can be exercised end to end before anything is deployed.
 *
 *   npm run build && node scripts/dev-server.mjs [--port 4330]
 *
 * SAFE BY CONSTRUCTION: it forces demo mode for its own process (SD_FORCE_DEMO=1), so mail goes
 * to Resend's test address and Stripe runs in test mode, whatever the live settings say.
 */
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from './_env.mjs';
import { compileServer } from '../gates/_compile.mjs';

process.env.SD_FORCE_DEMO = '1';
process.env.SD_DEMO_ADDRESS = process.env.SD_DEMO_ADDRESS || 'delivered@resend.dev';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4330;
process.env.PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || `http://127.0.0.1:${port}`;
const env = loadEnv();
console.log(`  env: ${JSON.stringify({ db: env.database_url, stripe_test: env.stripe_test, resend: env.resend_key })}  demo forced -> ${process.env.SD_DEMO_ADDRESS}`);
// Its OWN directory: a gate's `cleanupCompile()` must not be able to delete the routes this
// server is serving. See the note in gates/_compile.mjs.
const build = compileServer({ dir: '.dev-build' });
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const DIST = path.resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

function matchRewrite(pathname) {
  for (const r of vercel.rewrites ?? []) {
    const names = [];
    const re = new RegExp('^' + r.source.replace(/:(\w+)\*/g, (_, n) => { names.push(n); return '(.*)'; }).replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const m = re.exec(pathname);
    if (m) return { destination: r.destination, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}

let renderPage = null;
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let pathname = url.pathname.replace(/\/$/, '') || '/';
  const rw = matchRewrite(pathname);
  if (rw) { pathname = rw.destination; for (const [k, v] of Object.entries(rw.params)) url.searchParams.set(k, v); }
  if (pathname.startsWith('/api/')) {
    const file = path.join(build, `${pathname}.js`);
    if (!existsSync(file)) { res.statusCode = 404; return res.end('no function'); }
    req.url = `${pathname}?${url.searchParams}`;
    req.headers['x-forwarded-host'] = `127.0.0.1:${port}`;
    req.headers['x-forwarded-proto'] = 'http';
    try { const mod = await import(file); return await mod.default(req, res); }
    catch (e) { console.error('function error', e); res.statusCode = 500; return res.end('function error'); }
  }
  // Since 2026-09-29 pages render on demand. A static file (public/ and the bundled _astro/) is served
  // from dist/client as the CDN would; an image-CDN URL serves its SOURCE file unoptimised (there is
  // no image CDN locally — measure image weight against a preview); every other path is rendered by
  // the built function Vercel runs (.vercel/output), so /quote/<token> and /admin/leads/<id> answer
  // here exactly as they do in production.
  if (pathname === '/_vercel/image') {
    const src = String(url.searchParams.get('url') ?? '').replace(/^\/?/, '/');
    const file = path.join(DIST, 'client', src);
    if (!src.includes('..') && existsSync(file) && statSync(file).isFile()) {
      res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
      return res.end(readFileSync(file));
    }
    res.statusCode = 404; return res.end('no image');
  }
  const staticHit = [path.join(DIST, 'client', pathname)].find((c) => pathname !== '/' && existsSync(c) && statSync(c).isFile());
  if (!staticHit) {
    if (!renderPage) {
      const FUNC = path.resolve('.vercel/output/functions/_render.func/dist/server/entry.mjs');
      if (!existsSync(FUNC)) { res.statusCode = 500; return res.end('no built function: run the build first'); }
      renderPage = (await import(pathToFileURL(FUNC).href)).default;
    }
    req.url = `${url.pathname}${url.search}`;
    try { return await renderPage(req, res); }
    catch (e) { console.error('render error', e); res.statusCode = 500; return res.end('render error'); }
  }
  const hit = staticHit;
  const type = types[path.extname(hit)] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  // Compress and cache like Vercel does, so a local Lighthouse run measures the site, not the harness.
  if (hit.includes('/_astro/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const body = readFileSync(hit);
  if (/text|javascript|json|xml|svg|manifest/.test(type) && String(req.headers['accept-encoding'] || '').includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(gzipSync(body));
  }
  res.end(body);
}).listen(port, '127.0.0.1', () => console.log(`  serving the built function, dist/client and api on http://127.0.0.1:${port}`));
