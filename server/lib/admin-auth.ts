/**
 * Admin auth. Ported in spirit from CLIENT-SITES/mcgrathspub/website/server/routes/_private.ts,
 * which is the AMTECH pattern that already works in production.
 *
 * Email is the identity, a six-digit code is the proof, and the session is a row in this
 * database behind an httpOnly cookie. The browser never holds a token it could leak and
 * there is no password to lose.
 *
 * Three properties worth stating because each one is a defect if it goes missing:
 *  - An unknown address gets the SAME answer as a known one and no code, so the login
 *    screen cannot be used to enumerate who has access.
 *  - The code is stored as an HMAC, never in plain text, and dies after one use.
 *  - Revoking access is one UPDATE on team_members.status. No key to rotate.
 */
import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { sendEmail } from './notify.js';
import type { ApiRequest, ApiResponse } from './http.js';

const COOKIE = 'sd_admin';
const TTL_SECONDS = 60 * 60 * 8;         // eight hours, like McGrath's admin
const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

/**
 * Three roles, and the third one is the reason `crew` exists at all (P18 §4): the person in the
 * truck needs today's stops and must never see money, customers or settings. The refusal is
 * STRUCTURAL - api/admin.ts allows a crew session onto a named list of paths and refuses
 * everything else - rather than a check remembered on each new route, because the route somebody
 * adds next month is the one that would forget. gates/admin-roles.mjs is what keeps it true.
 */
export type AdminRole = 'superadmin' | 'admin' | 'crew';
export type AdminSession = { id: string; teamId: string; name: string; email: string; role: AdminRole };

function secret() {
  const s = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!s) throw new Error('SESSION_SECRET is not configured.');
  return s;
}
const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

function cookies(req: ApiRequest): Record<string, string> {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return [decodeURIComponent(p.slice(0, i)), decodeURIComponent(p.slice(i + 1))];
    }),
  );
}

export function setSessionCookie(res: ApiResponse, token: string) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`);
}
export function clearSessionCookie(res: ApiResponse) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/** Rate limit by key. Cheap, in the database, so it survives a cold start. */
/** True only when rateLimit refused because the caller is over the limit, not because the
 *  database was unreachable. A connection failure that reads as "too many attempts" sends the
 *  user away to wait for a limit that was never hit (Ben, locked out of admin 2026-09-18). */
export const isOverLimit = (e: unknown) => (e as Error)?.message === 'rate_limited';

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const { rows } = await db().query(
    `insert into rate_limits (key, count, reset_at)
     values ($1, 1, now() + ($2 || ' seconds')::interval)
     on conflict (key) do update set
       count    = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + ($2 || ' seconds')::interval else rate_limits.reset_at end
     returning count`,
    [key, String(windowSeconds)]);
  if (rows[0].count > limit) throw new Error('rate_limited');
}

/**
 * Issue a code to an address that is allowed in. Returns whether one was sent, but the
 * CALLER must answer identically either way - see api/admin.ts.
 */
export async function startLogin(emailRaw: string): Promise<{ sent: boolean; name?: string }> {
  const email = normalizeEmail(emailRaw);
  const { rows } = await db().query(
    `select id, name, role from team_members
      where lower(email) = $1 and status = 'active' and role in ('superadmin','admin','crew')`,
    [email]);
  if (!rows.length) return { sent: false };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db().query(
    `insert into verification_codes (target_hash, code_hash, purpose, expires_at)
     values ($1, $2, 'admin_login', now() + ($3 || ' minutes')::interval)`,
    [hmac(email), hmac(`${email}:${code}`), String(CODE_TTL_MINUTES)]);

  // Through the one send function, so the sign-in code honours demo mode like every other
  // message. In demo mode the code for any address arrives at demo.address, which is what
  // lets the acceptance walk sign in AS the owner without sending him anything.
  const sent = await sendEmail({
    purpose: 'admin_login',
    recipients: { explicit: [email] },
    subject: `Your Scoop Dogg admin code: ${code}`,
    html: `<div style="font-family:system-ui,sans-serif">
      <p style="font-size:15px;color:#444">Your sign-in code for the Scoop Dogg admin:</p>
      <p style="font-size:34px;font-weight:700;letter-spacing:6px;color:#1B4332">${code}</p>
      <p style="font-size:13px;color:#888">It expires in ${CODE_TTL_MINUTES} minutes and works once.
      If you did not ask for it, you can ignore this email.</p></div>`,
  });
  // A code nobody can receive must not read as "wrong email" on the login screen -
  // api/admin.ts turns this into a 503.
  if (sent.state === 'failed') throw new Error(`resend_failed_${sent.error ?? 'unknown'}`);
  return { sent: true, name: rows[0].name };
}

/** Verify a code and open a session. Returns null on any failure, without saying which. */
export async function verifyLogin(res: ApiResponse, emailRaw: string, code: string): Promise<AdminSession | null> {
  const email = normalizeEmail(emailRaw);
  const { rows: codes } = await db().query(
    `select id, code_hash, attempts from verification_codes
      where target_hash = $1 and purpose = 'admin_login'
        and consumed_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [hmac(email)]);
  if (!codes.length) return null;
  const row = codes[0];
  if (row.attempts >= MAX_CODE_ATTEMPTS) return null;

  await db().query('update verification_codes set attempts = attempts + 1 where id = $1', [row.id]);

  const expected = Buffer.from(row.code_hash);
  const actual = Buffer.from(hmac(`${email}:${String(code).trim()}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  await db().query('update verification_codes set consumed_at = now() where id = $1', [row.id]);

  const { rows: people } = await db().query(
    `select id, name, email, role from team_members
      where lower(email) = $1 and status = 'active' and role in ('superadmin','admin','crew')`,
    [email]);
  if (!people.length) return null;
  const person = people[0];

  const token = randomBytes(32).toString('hex');
  const { rows: sessions } = await db().query(
    `insert into sessions (actor_kind, team_id, token_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' seconds')::interval) returning id`,
    // sessions.actor_kind has admitted 'team' since 001 and nothing wrote it; a crew session is
    // that row. The role on team_members stays the single answer to what anyone may do.
    [person.role === 'superadmin' ? 'superadmin' : person.role === 'crew' ? 'team' : 'admin',
     person.id, hmac(token), String(TTL_SECONDS)]);
  await db().query('update team_members set last_login_at = now() where id = $1', [person.id]);
  setSessionCookie(res, token);
  return { id: sessions[0].id, teamId: person.id, name: person.name, email: person.email, role: person.role };
}

export async function getSession(req: ApiRequest): Promise<AdminSession | null> {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const { rows } = await db().query(
    `select s.id, t.id as team_id, t.name, t.email, t.role
       from sessions s join team_members t on t.id = s.team_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
        and t.status = 'active' and t.role in ('superadmin','admin','crew')`,
    [hmac(token)]);
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, teamId: r.team_id, name: r.name, email: r.email, role: r.role };
}

export async function endSession(req: ApiRequest, res: ApiResponse) {
  const token = cookies(req)[COOKIE];
  if (token) await db().query('update sessions set revoked_at = now() where token_hash = $1', [hmac(token)]);
  clearSessionCookie(res);
}
