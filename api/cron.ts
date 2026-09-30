/**
 * /api/cron — the daily run (server/lib/daily.ts), called by Vercel Cron (vercel.json `crons`).
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when the project has a CRON_SECRET. Without the
 * secret configured this route REFUSES rather than running for anyone who finds the URL: the steps
 * send email and change quote states, and "anyone can trigger it" is not a schedule. The owner can
 * still run it from the admin (api/admin.ts `daily`), signed in.
 *
 * The secret is compared in constant time and never logged or returned.
 */
import { timingSafeEqual } from 'node:crypto';
import { runDaily } from '../server/lib/daily.js';
import { sendJson, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return sendJson(res, 503, { error: 'The daily run is not configured on this deployment (no CRON_SECRET).' });
  const auth = String(req.headers.authorization ?? '');
  if (!same(auth, `Bearer ${secret}`)) return sendJson(res, 401, { error: 'Not authorised.' });
  try {
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
    const run = await runDaily({ base: `https://${host}`, by: 'cron' });
    return sendJson(res, 200, run);
  } catch (e) {
    safeError('cron:daily', e);
    return sendJson(res, 500, { error: 'The daily run failed. See the logs.' });
  }
}
