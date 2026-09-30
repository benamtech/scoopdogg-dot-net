/**
 * Every page render starts here: read the live rows, hand them to the page, tag the HTML for the
 * CDN. This is what makes an owner's edit live in seconds with no rebuild (server/lib/site-cache.ts
 * has the purge half, server/lib/public-catalog.ts the read).
 *
 * IF THE READ FAILS, THE PAGE DOES NOT RENDER. A page rendered from an empty or stale catalog would
 * advertise a price the checkout does not charge, or no services at all. A 503 is not cached
 * (it carries no CDN cache header), so the next request tries again, and the CDN keeps serving the
 * last good copy of every page that was already cached.
 *
 * The root api/ functions never pass through here: they are Vercel functions of their own, and the
 * admin screens they serve read the database directly.
 */
import { defineMiddleware } from 'astro:middleware';
import { loadPublicSnapshot } from '../server/lib/public-catalog';
import { PAGE_CACHE_HEADERS } from '../server/lib/site-cache';
import { setCatalog } from './lib/catalog';
import { setDemo } from './lib/demo';

export const onRequest = defineMiddleware(async (context, next) => {
  // Prerendered routes (none today) are rendered at build with no request to read from.
  if (context.isPrerendered) return next();
  let snapshot;
  try {
    // One retry: a cold Neon connection measured 3.3s on 2026-09-30, and the first render after
    // the database sleeps can lose the race with the pool's connect timeout. A second attempt
    // meets a warm database.
    snapshot = await loadPublicSnapshot().catch(() => loadPublicSnapshot());
  } catch (e) {
    console.error(`[render] could not read the catalog: ${(e as Error).message}`);
    return new Response('Scoop Dogg is updating this page. Try again in a moment.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' },
    });
  }
  setCatalog(snapshot as any);
  setDemo(snapshot.demo);
  const res = await next();
  // Only a successful page is held at the CDN. A 404 for a retired slug must not outlive the
  // save that brings the slug back.
  if (res.status === 200) for (const [k, v] of Object.entries(PAGE_CACHE_HEADERS)) res.headers.set(k, v);
  else res.headers.set('cache-control', 'no-store');
  return res;
});
