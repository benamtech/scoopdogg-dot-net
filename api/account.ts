/**
 * /api/account/* — the customer portal. Everything except login/* needs a customer session.
 */
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { rateLimit, isOverLimit } from '../server/lib/admin-auth.js';
import { startCustomerLogin, verifyCustomerLogin, getCustomerSession, endCustomerSession } from '../server/lib/customer-auth.js';
import { AccountError, overview, skipVisit, unskipVisit, pausePlan, resumePlan, cancelPlan, keepPlan, billingPortalUrl } from '../server/lib/account.js';
import { InviteError, readInvite, acceptInvite } from '../server/lib/invites.js';
import { requestFingerprint } from '../server/lib/consent.js';

const routePath = (req: ApiRequest) =>
  (new URL(req.url || '/', 'https://local.test').searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const path = routePath(req);
  try {
    if (path === 'login/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = String(body.email ?? '').trim();
      if (!email) return sendJson(res, 400, { error: 'Enter your email address.' });
      try { await rateLimit(`account_login:${email.toLowerCase()}`, 5, 15 * 60); }
      catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
        safeError('account:login/start:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not reach the sign-in service. Try again in a moment.' });
      }
      try { await startCustomerLogin(email); } catch (e) { safeError('account:login/start', e); return sendJson(res, 503, { error: 'We could not send the code just now. Try again shortly.' }); }
      return sendJson(res, 200, { ok: true });
    }
    if (path === 'login/verify' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try { await rateLimit(`account_verify:${String(body.email ?? '').toLowerCase()}`, 10, 15 * 60); }
      catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts.' });
        safeError('account:login/verify:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not reach the sign-in service. Try again in a moment.' });
      }
      const s = await verifyCustomerLogin(res, String(body.email ?? ''), String(body.code ?? ''));
      if (!s) return sendJson(res, 401, { error: 'That code is not right, or it has expired.' });
      return sendJson(res, 200, { ok: true });
    }
    // ---- the invite link (P18 §3) ----------------------------------------
    // No session: the token IS the credential, the same way the six-digit code is. It is 32
    // random bytes, stored as an HMAC, single-purpose and expiring - and rate-limited here
    // anyway, because a token nobody can guess is still a token somebody will try to guess.
    if (path.startsWith('invite/') && req.method === 'POST') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      try { await rateLimit(`invite:${ip}`, 20, 60 * 60); }
      catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts. Please call (805) 869-8070.' });
        safeError('account:invite:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not take that just now. Please try again in a moment.' });
      }
      const body = await readJsonBody(req);
      const token = String(body.token ?? '');
      if (path === 'invite/read') return sendJson(res, 200, await readInvite(token));
      if (path === 'invite/accept') {
        const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
        const proto = (req.headers['x-forwarded-proto'] as string) || (host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https');
        return sendJson(res, 200, await acceptInvite(token, `${proto}://${host}`, {
          text: body.consent_text == null ? null : String(body.consent_text).slice(0, 1000),
          ...requestFingerprint(req.headers as Record<string, string | undefined>),
        }));
      }
    }

    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, 401, { error: 'Not signed in.' });
    if (path === 'logout') { await endCustomerSession(req, res); return sendJson(res, 200, { ok: true }); }
    if (path === 'overview') return sendJson(res, 200, await overview(session.customerId));
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    const body = await readJsonBody(req);
    const sub = String(body.subscription_id ?? '');
    if (path === 'visit/skip') return sendJson(res, 200, await skipVisit(session.customerId, String(body.visit_id ?? '')));
    if (path === 'visit/unskip') return sendJson(res, 200, await unskipVisit(session.customerId, String(body.visit_id ?? '')));
    if (path === 'plan/pause') return sendJson(res, 200, await pausePlan(session.customerId, sub, Number(body.weeks ?? 2)));
    if (path === 'plan/resume') return sendJson(res, 200, await resumePlan(session.customerId, sub));
    if (path === 'plan/cancel') return sendJson(res, 200, await cancelPlan(session.customerId, sub, String(body.reason ?? '')));
    if (path === 'plan/keep') return sendJson(res, 200, await keepPlan(session.customerId, sub));
    if (path === 'billing') {
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
      return sendJson(res, 200, { url: await billingPortalUrl(session.customerId, `https://${host}/account`) });
    }
    return sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof AccountError) return sendJson(res, e.status, { error: e.userMessage });
    if (e instanceof InviteError) return sendJson(res, e.status, { error: e.userMessage, code: e.code });
    safeError(`account:${path}`, e);
    return sendJson(res, 503, { error: 'Something went wrong on our side. Please try again.' });
  }
}
