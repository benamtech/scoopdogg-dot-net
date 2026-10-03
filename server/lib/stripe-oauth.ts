/**
 * Connecting the Stripe account Josue ALREADY HAS (Ben, 2026-10-03: "josue already has a stripe
 * account ... make sure it is the normal stripe connect onboarding process where they can
 * optionally use an existing stripe account").
 *
 * WHY OAUTH, AFTER IT WAS RULED OUT. On 2026-09-19 this integration chose Accounts v2 and hosted
 * onboarding, and gates/stripe-connect.mjs forbade OAuth, for two stated reasons: v2 accounts
 * cannot use OAuth, and "v1 account creation is refused for this platform". The second was a
 * sandbox measurement. And it was the wrong question: OAuth does not CREATE an account, it connects
 * one that exists. Hosted onboarding (`v2.core.accountLinks`) only ever onboards an account WE just
 * created, so it can never attach the account an owner already runs his business through. Stripe's
 * OAuth page asks the owner to sign in to his existing account or make a new one, and hands back
 * the account id. That is the "Connect with Stripe" flow every platform shows.
 *
 * Stripe calls OAuth "not recommended for new Connect platforms" and still documents and serves it
 * (docs.stripe.com/connect/oauth-standard-accounts, read 2026-10-03). It needs two dashboard
 * settings on the platform, under Settings > Connect > Onboarding options > OAuth: OAuth switched
 * on, and REDIRECT_PATH on scoopdogg.net listed as a redirect URI. `scripts/probe-oauth.mjs` reads
 * both from Stripe's own authorize page without connecting anything.
 *
 * THE STATE TOKEN is P18 §5's original requirement, restored: bound to the admin session that asked,
 * to the mode, and to a 15-minute window, and signed, so a callback cannot be replayed into another
 * session or flipped from test to live. Stripe's authorization code is single-use on top of that.
 *
 * Only node:crypto here, so the tests load it without a database.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type ConnectMode = 'test' | 'live';

/**
 * The platform's Connect client ids. Public identifiers, not secrets: Stripe prints them in every
 * authorize URL a browser sees. Read 2026-10-03 as the `application` on each mode's Connect webhook
 * endpoint for scoopdogg.net (live acct_1U32DNArurqL9aP3; test is AMTECH's sandbox).
 */
export const CLIENT_IDS: Record<ConnectMode, string> = {
  live: 'ca_VF0fUKqsLckFLcjgS1B2VQmRx6Ekz9a6',
  test: 'ca_VF0fI2BGfPnFbi7Sjt78ULHm1fyxuaT9',
};

export const REDIRECT_PATH = '/api/admin/payments/oauth-callback';
export const STATE_TTL_MS = 15 * 60 * 1000;

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(`stripe-connect:${body}`).digest('base64url');

export function connectState(sessionId: string, mode: ConnectMode, secret: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ s: sessionId, m: mode, e: now + STATE_TTL_MS, n: randomBytes(9).toString('base64url') }));
  return `${body}.${sign(body, secret)}`;
}

/** The mode the state was minted for, or null if it was altered, expired, or minted for another session. */
export function verifyConnectState(state: string, sessionId: string, secret: string, now = Date.now()): ConnectMode | null {
  const [body, mac, extra] = String(state ?? '').split('.');
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p: { s?: unknown; m?: unknown; e?: unknown };
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p.s !== sessionId) return null;
  if (typeof p.e !== 'number' || now > p.e) return null;
  return p.m === 'live' || p.m === 'test' ? p.m : null;
}

/**
 * Stripe's OAuth page. `stripe_landing=login` opens on "sign in" because the owner already has an
 * account; the same page offers "create an account" for one who does not. The prefill only seeds
 * a NEW account's form; it changes nothing on an existing one.
 */
export function authorizeUrl(mode: ConnectMode, opts: { state: string; base: string; email?: string; businessName?: string }): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_IDS[mode],
    scope: 'read_write',
    state: opts.state,
    redirect_uri: `${opts.base}${REDIRECT_PATH}`,
    stripe_landing: 'login',
    'stripe_user[country]': 'US',
    'stripe_user[url]': opts.base,
  });
  if (opts.email) q.set('stripe_user[email]', opts.email);
  if (opts.businessName) q.set('stripe_user[business_name]', opts.businessName);
  return `https://connect.stripe.com/oauth/authorize?${q}`;
}

/**
 * Will Stripe's OAuth page open for this mode right now? Read-only: it loads the same public page a
 * browser would, and Stripe answers a JSON error instead of a page when the platform's OAuth switch
 * is off. Measured 2026-10-03: "Standard OAuth is disabled for this Stripe Connect integration",
 * with the switch greyed out in Ben's dashboard. The button asks this on every press, so it uses
 * OAuth the day Stripe allows it and hosted onboarding until then, with no deploy in between.
 */
export async function oauthAvailable(mode: ConnectMode, base: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const res = await fetcher(authorizeUrl(mode, { state: 'availability-check', base }), {
      redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScoopDogg-Site/1.0)' }, signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let reason: string | null = null;
    try { reason = JSON.parse(text)?.error?.message ?? null; } catch { /* a page, which is the good answer */ }
    if (!reason && res.status >= 400) reason = `HTTP ${res.status}`;
    return { ok: !reason, reason };
  } catch (e) {
    return { ok: false, reason: `unreachable: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Where the callback sends the owner back to, with one word saying how it went. */
export const paymentsReturn = (result: 'connected' | 'cancelled' | 'failed' | 'expired' | 'mismatch' | 'occupied') =>
  `/admin/payments?connect=${result}`;
