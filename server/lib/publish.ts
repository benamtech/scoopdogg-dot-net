/**
 * publish.ts — putting a saved price on the public pages, and knowing when it got there.
 *
 * A saved price reaches the checkout on the next request (catalog-db.ts reads the rows every time)
 * and the public pages only when the site is rebuilt: 48 of the built pages print a price from
 * content/catalog.json. The owner asked why changing one price needs a rebuild at all, and the
 * answer was measured on 2026-09-27 (R21 plan §5): Astro's Vercel adapter keeps the root api/
 * functions, so on-demand pages are possible — but every price-bearing page reads the catalog as
 * a build-time file, so on-demand rendering buys nothing until those pages read it at request time.
 * Until that refactor, a save is published by a deploy hook: a minute or two, not a pull request.
 *
 * `content_publishes` (migration 003) had no writer and no reader. Its own comment is the rule:
 * "the admin must never print 'published' when nothing can carry the change". So:
 *   - no hook configured: nothing is written and the screen says publishing is not set up here;
 *   - the hook answered: the row is 'building';
 *   - it is 'live' only when the LIVE SITE serves a page built from a newer catalog — read from the
 *     page's own <meta name="sd-catalog-pulled-at">, a different path from the one that fired it.
 */
import { db } from './db.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class PublishError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'publish_error') { super(message); this.status = status; this.code = code; }
}

const SITE = () => process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.net';
export const publishConfigured = () => Boolean(process.env.VERCEL_DEPLOY_HOOK_URL);

export async function requestPublish(q: Queryable = db(), p: { by: string; reason: string }) {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) {
    throw new PublishError('Publishing is not set up on this deployment yet. Saved prices are already used at checkout; the public pages update on the next deploy.', 409, 'not_configured');
  }
  const { rows: [row] } = await q.query(
    `insert into content_publishes (requested_by, reason, deploy_hook, state) values ($1, $2, 'production', 'pending') returning id, created_at`,
    [p.by, p.reason.slice(0, 300)]);
  let ok = false;
  try {
    const r = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    ok = r.ok;
  } catch { ok = false; }
  await q.query(`update content_publishes set state = $2, completed_at = case when $2 = 'failed' then now() else null end where id = $1`,
    [row.id, ok ? 'building' : 'failed']);
  return { id: Number(row.id), state: ok ? 'building' : 'failed', requested_at: row.created_at };
}

/** When the live site's pages were built, from the pages themselves. Null if it cannot say. */
export async function liveBuiltAt(): Promise<Date | null> {
  try {
    const r = await fetch(`${SITE()}/`, { signal: AbortSignal.timeout(8_000), headers: { 'cache-control': 'no-cache' } });
    const html = await r.text();
    const m = /<meta\s+name="sd-catalog-pulled-at"\s+content="([^"]+)"/i.exec(html);
    const d = m ? new Date(m[1]) : null;
    return d && Number.isFinite(d.getTime()) ? d : null;
  } catch { return null; }
}

/**
 * The recent publishes, with any 'building' one settled against the live site: live when the site
 * serves a newer catalog, failed after 20 minutes without one.
 */
export async function publishStatus(q: Queryable = db()) {
  const { rows } = await q.query(
    `select id, requested_by, reason, state, created_at, completed_at from content_publishes order by id desc limit 5`);
  const building = rows.filter((r) => r.state === 'building');
  if (building.length) {
    const built = await liveBuiltAt();
    for (const r of building) {
      const created = new Date(r.created_at);
      if (built && built > created) {
        await q.query(`update content_publishes set state = 'live', completed_at = now() where id = $1 and state = 'building'`, [r.id]);
        r.state = 'live'; r.completed_at = new Date().toISOString();
      } else if (Date.now() - created.getTime() > 20 * 60_000) {
        await q.query(`update content_publishes set state = 'failed', completed_at = now() where id = $1 and state = 'building'`, [r.id]);
        r.state = 'failed';
      }
    }
  }
  return { configured: publishConfigured(), publishes: rows };
}
