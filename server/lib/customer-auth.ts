/**
 * Customer sign-in: the admin's proven pattern (server/lib/admin-auth.ts) with a different
 * actor. Email is the identity, a six-digit code is the proof, the session is a row behind an
 * httpOnly cookie. No password, nothing in the browser that could leak.
 *
 * Checkout opens a session directly (openSessionForCustomer), so a customer who has just paid
 * lands in their account already signed in - they never meet this code flow on day one.
 */
import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { sendEmail } from './notify.js';
import type { ApiRequest, ApiResponse } from './http.js';

const COOKIE = 'sd_account';
const TTL_SECONDS = 60 * 60 * 24 * 30; // a month: a customer checks in weekly, not daily
const CODE_TTL_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;

export type CustomerSession = { id: string; customerId: string; name: string; email: string };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not configured.');
  return s;
}
const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

function cookies(req: ApiRequest): Record<string, string> {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [decodeURIComponent(p.slice(0, i)), decodeURIComponent(p.slice(i + 1))];
  }));
}

function setCookie(res: ApiResponse, token: string, maxAge = TTL_SECONDS) {
  const existing = res.getHeader('Set-Cookie');
  const value = `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  res.setHeader('Set-Cookie', existing ? [...(Array.isArray(existing) ? existing : [String(existing)]), value] : value);
}

export async function openSessionForCustomer(res: ApiResponse, customerId: string) {
  const token = randomBytes(32).toString('hex');
  await db().query(
    `insert into sessions (actor_kind, customer_id, token_hash, expires_at)
     values ('customer', $1, $2, now() + ($3 || ' seconds')::interval)`,
    [customerId, hmac(token), String(TTL_SECONDS)]);
  setCookie(res, token);
}

export async function startCustomerLogin(emailRaw: string): Promise<{ sent: boolean }> {
  const email = normalizeEmail(emailRaw);
  const { rows } = await db().query(
    `select id, name from customers where lower(email) = $1 and deleted_at is null order by created_at desc limit 1`, [email]);
  if (!rows.length) return { sent: false };
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db().query(
    `insert into verification_codes (target_hash, code_hash, purpose, expires_at)
     values ($1, $2, 'customer_login', now() + ($3 || ' minutes')::interval)`,
    [hmac(email), hmac(`${email}:${code}`), String(CODE_TTL_MINUTES)]);
  const sent = await sendEmail({
    purpose: 'customer_login',
    recipients: { explicit: [email] },
    fromName: 'Scoop Dogg',
    subject: `${code} is your Scoop Dogg sign-in code`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1A1A1A">
      <p style="font-size:16px">Here's your code to sign in to your Scoop Dogg account:</p>
      <p style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1B4332;margin:16px 0">${code}</p>
      <p style="font-size:14px;color:#5B6660">It works once and expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
  });
  if (sent.state === 'failed') throw new Error(`resend_failed_${sent.error ?? 'unknown'}`);
  return { sent: true };
}

export async function verifyCustomerLogin(res: ApiResponse, emailRaw: string, code: string): Promise<CustomerSession | null> {
  const email = normalizeEmail(emailRaw);
  const { rows: codes } = await db().query(
    `select id, code_hash, attempts from verification_codes
      where target_hash = $1 and purpose = 'customer_login' and consumed_at is null and expires_at > now()
      order by created_at desc limit 1`, [hmac(email)]);
  if (!codes.length || codes[0].attempts >= MAX_CODE_ATTEMPTS) return null;
  await db().query('update verification_codes set attempts = attempts + 1 where id = $1', [codes[0].id]);
  const expected = Buffer.from(codes[0].code_hash);
  const actual = Buffer.from(hmac(`${email}:${String(code).trim()}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  await db().query('update verification_codes set consumed_at = now() where id = $1', [codes[0].id]);
  const { rows } = await db().query(
    `select id, name, email from customers where lower(email) = $1 and deleted_at is null order by created_at desc limit 1`, [email]);
  if (!rows.length) return null;
  await openSessionForCustomer(res, rows[0].id);
  return { id: '', customerId: rows[0].id, name: rows[0].name, email: rows[0].email };
}

export async function getCustomerSession(req: ApiRequest): Promise<CustomerSession | null> {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const { rows } = await db().query(
    `select s.id, c.id as customer_id, c.name, c.email
       from sessions s join customers c on c.id = s.customer_id
      where s.token_hash = $1 and s.actor_kind = 'customer' and s.revoked_at is null and s.expires_at > now()
        and c.deleted_at is null`, [hmac(token)]);
  if (!rows.length) return null;
  return { id: rows[0].id, customerId: rows[0].customer_id, name: rows[0].name, email: rows[0].email };
}

export async function endCustomerSession(req: ApiRequest, res: ApiResponse) {
  const token = cookies(req)[COOKIE];
  if (token) await db().query('update sessions set revoked_at = now() where token_hash = $1', [hmac(token)]);
  setCookie(res, '', 0);
}
