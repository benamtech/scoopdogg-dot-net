/**
 * /api/quote/* — the customer's side of a custom quote. No sign-in: the request token in the link
 * is the permission, the same standard as a completion photo or a magic sign-in link.
 *
 *   POST request        the job, the person, where           -> { token }
 *   POST photo          { token, data_url }                  -> the stored photo
 *   POST done           { token }                            -> Josue told, once, with the photos
 *   GET  view?token=    what the quote page shows (counts a view unless &peek=1)
 *   POST accept         { token, quote_id, name, chosen[], terms, senior } -> { checkout_url | null }
 *   POST decline        { token, reason }
 *   POST confirm        { session_id }  the page the customer returns to from Stripe
 *
 * Every refusal is a sentence from server/lib/quotes.ts with a code; nothing internal reaches the
 * customer, and a database failure on the request itself tells them to phone rather than
 * pretending it worked (the rule api/lead.ts was built around).
 */
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { db } from '../server/lib/db.js';
import { rateLimit, isOverLimit } from '../server/lib/admin-auth.js';
import { demoMode } from '../server/lib/notify.js';
import { requestFingerprint } from '../server/lib/consent.js';
import {
  QuoteError, requestQuote, addRequestPhoto, finishRequest, viewQuote, acceptQuote, declineQuote, confirmQuotePayment,
} from '../server/lib/quotes.js';

const routePath = (req: ApiRequest) =>
  (new URL(req.url || '/', 'https://local.test').searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');

const baseUrl = (req: ApiRequest) => {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
  const proto = (req.headers['x-forwarded-proto'] as string) || (host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const path = routePath(req);
  const url = new URL(req.url || '/', 'https://local.test');
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const limited = async (key: string, n: number, windowSeconds: number) => {
    try { await rateLimit(`${key}:${ip}`, n, windowSeconds); return false; }
    catch (e) { if (isOverLimit(e)) return true; throw e; }
  };
  try {
    if (req.method === 'GET' && path === 'view') {
      const token = url.searchParams.get('token') || '';
      const view = await viewQuote(db(), token, { count: url.searchParams.get('peek') !== '1' });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return sendJson(res, 200, view);
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return sendJson(res, 405, { error: 'Method not allowed.' }); }

    if (path === 'request') {
      if (await limited('quote-request', 8, 60 * 60)) return sendJson(res, 429, { error: 'Too many requests. Please call or text (805) 869-8070.' });
      const body = await readJsonBody(req);
      let demo = false;
      try { demo = (await demoMode()).mode; } catch { /* unreadable: write it as given, a lost lead is worse */ }
      try {
        const r = await requestQuote(db(), body as Record<string, unknown>, demo);
        return sendJson(res, 201, { ok: true, token: r.token });
      } catch (e) {
        if (e instanceof QuoteError) throw e;
        safeError('quote:request', e);
        return sendJson(res, 503, { error: 'We could not save your request just now. Please call or text (805) 869-8070 and Josue will sort it out.' });
      }
    }

    if (path === 'photo') {
      if (await limited('quote-photo', 40, 60 * 60)) return sendJson(res, 429, { error: 'Too many photos at once. Try again in a little while.' });
      const body = await readJsonBody(req, 2 * 1024 * 1024);
      const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url ?? ''));
      if (!m) return sendJson(res, 400, { error: 'Send a JPEG, WebP or PNG.', code: 'bad_data_url' });
      const photo = await addRequestPhoto(db(), String(body.token ?? ''), Buffer.from(m[2], 'base64'), m[1]);
      return sendJson(res, 200, { photo });
    }

    if (path === 'done') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await finishRequest(db(), String(body.token ?? ''), baseUrl(req)));
    }

    if (path === 'accept') {
      if (await limited('quote-accept', 20, 60 * 60)) return sendJson(res, 429, { error: 'Too many attempts. Please text (805) 869-8070.' });
      const body = await readJsonBody(req);
      const fp = requestFingerprint(req.headers as Record<string, string | undefined>);
      const r = await acceptQuote(db(), String(body.token ?? ''), body as Record<string, unknown>, { base: baseUrl(req), ip: fp.ip, ua: fp.userAgent });
      return sendJson(res, 200, r);
    }

    if (path === 'decline') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await declineQuote(db(), String(body.token ?? ''), String(body.reason ?? ''), baseUrl(req)));
    }

    if (path === 'confirm') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await confirmQuotePayment(db(), String(body.session_id ?? ''), { base: baseUrl(req) }));
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof QuoteError) return sendJson(res, e.status, { error: e.message, code: e.code });
    safeError(`quote:${path}`, e);
    return sendJson(res, 500, { error: 'Something went wrong on our side. Please text (805) 869-8070.' });
  }
}
