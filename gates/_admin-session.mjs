/**
 * Sign in to a deployment's admin the way gates/admin-browser.mjs does: mint a one-time code with
 * the server's own HMAC, complete the real /login/verify flow over HTTP, keep the session cookie.
 * Secrets are read from the environment and used, never printed. `end()` logs the session out.
 */
import { createHmac, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

function fromBrainEnv(name) {
  try {
    for (const line of readFileSync(new URL('../../../.env', import.meta.url).pathname, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k.trim() === name) return rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}

export async function adminSession(base, { email = 'ben@amtechai.com' } = {}) {
  let secret = process.env.SESSION_SECRET;
  if (!secret || secret.includes('SENSITIVE')) secret = fromBrainEnv('SCOOPDOGG_SESSION_SECRET');
  if (!secret) throw new Error('no SESSION_SECRET available');
  const hmac = (v) => createHmac('sha256', secret).update(v).digest('hex');
  const protect = process.env.VERCEL_OIDC_TOKEN ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN } : {};

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await c.query(
      `insert into verification_codes (target_hash, code_hash, purpose, expires_at)
       values ($1, $2, 'admin_login', now() + interval '10 minutes')`,
      [hmac(email.toLowerCase()), hmac(`${email.toLowerCase()}:${code}`)]);
  } finally { await c.end(); }

  const r = await fetch(`${base}/api/admin/login/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...protect }, body: JSON.stringify({ email, code }),
  });
  const cookie = (r.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).find((x) => x.startsWith('sd_admin='));
  if (r.status !== 200 || !cookie) throw new Error(`sign-in failed: ${r.status}`);
  const role = (await r.json().catch(() => ({}))).user?.role ?? null;
  const headers = { Cookie: cookie, ...protect };
  const api = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${base}/api/admin/${path}`, {
      method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || `${method} ${path} -> ${res.status}`), { status: res.status, body: json });
    return json;
  };
  return {
    role, headers, protect, api, cookie,
    end: () => fetch(`${base}/api/admin/logout`, { method: 'POST', headers }).catch(() => {}),
  };
}
