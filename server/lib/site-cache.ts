/**
 * site-cache.ts — the one switch between "Josue saved it" and "the public page shows it".
 *
 * Every public page renders on demand from the rows (server/lib/public-catalog.ts) and is held at
 * Vercel's CDN under one tag. A save purges the tag; the next request renders from the new rows.
 * No deployment, no publish button, no deploy hook. That replaced server/lib/publish.ts, which
 * fired a deploy hook and waited for a rebuild (removed 2026-09-29).
 *
 * ONE TAG, AND EVERY ADMIN WRITE PURGES IT (api/admin.ts). Purging per screen would need every
 * new writer to remember to purge, and the one that forgets ships a page that disagrees with the
 * checkout. A small site re-rendering after a save costs a few database reads; a stale price
 * costs a customer's trust.
 *
 * `dangerouslyDeleteByTag`, not `invalidateByTag`: invalidate serves the stale page once more and
 * re-renders in the background, so Josue would open his page straight after saving and see the old
 * price. Delete makes the next request render in the foreground. The stampede the name warns about
 * is a concern for sites with thousands of pages and heavy traffic, not ~90 pages.
 *
 * @vercel/functions resolves SILENTLY when the purge API is absent (local runs, and any runtime
 * that does not provide it). So `purgeSite()` reports whether a purge actually happened, and
 * gates/live-edit.mjs checks the page itself rather than trusting the return value.
 */
import { dangerouslyDeleteByTag } from '@vercel/functions';

/** The same lookup @vercel/functions makes (get-context.js), which the package does not export. */
const requestContext = (): { purge?: unknown } =>
  (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.() ?? {};

export const SITE_CACHE_TAG = 'sd-public-pages';

/**
 * Headers for a rendered public page. The CDN holds it until a purge; browsers always revalidate,
 * so a visitor who reloads after an edit is not served their own stale copy.
 * `Vercel-CDN-Cache-Control` is read by Vercel's CDN only and never forwarded downstream.
 */
export const PAGE_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Vercel-CDN-Cache-Control': 'max-age=31536000',
  'Vercel-Cache-Tag': SITE_CACHE_TAG,
};

export type PurgeResult = { purged: boolean; reason?: string };

export async function purgeSite(): Promise<PurgeResult> {
  let api: unknown;
  try { api = requestContext().purge; } catch { api = undefined; }
  if (!api) return { purged: false, reason: 'no CDN purge API in this runtime (not on Vercel)' };
  try {
    await dangerouslyDeleteByTag(SITE_CACHE_TAG);
    return { purged: true };
  } catch (e) {
    return { purged: false, reason: `purge failed: ${(e as Error).message}` };
  }
}
