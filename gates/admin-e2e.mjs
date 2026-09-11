/**
 * Prove the admin sign-in path end to end against the DEPLOYED site.
 *
 *   node --env-file=.env.local gates/admin-e2e.mjs <deployment-url>
 *
 * The code normally arrives by email, which a test cannot read. So this mints one
 * directly using the same HMAC the server uses, then completes the real flow over HTTP:
 * verify, receive a session cookie, read data with it, hit a superadmin-only route as
 * both roles, and log out. Everything after the mint is the production code path.
 *
 * Needs SESSION_SECRET, which is the same value the deployed function holds.
 */
import pg from 'pg';
import { createHmac, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) { console.error('usage: admin-e2e.mjs <deployment-url>'); process.exit(1); }

function fromBrainEnv(name) {
  try {
    for (const line of readFileSync(new URL('../../../.env', import.meta.url).pathname, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k.trim() === name) return rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}
let secret = process.env.SESSION_SECRET;
if (!secret || secret.includes('SENSITIVE')) secret = fromBrainEnv('SCOOPDOGG_SESSION_SECRET');
if (!secret) { console.error('no SESSION_SECRET available'); process.exit(1); }
const hmac = (v) => createHmac('sha256', secret).update(v).digest('hex');

let pass = 0, fail = 0;
const ok = (n, m='') => { console.log(`  ok    ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m)   => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

// vercel curl is needed because the deployment sits behind Vercel Authentication; on a
// custom domain this same code works with plain fetch.
import { execFileSync } from 'node:child_process';
function req(path, { method = 'GET', body, cookie } = {}) {
  const args = ['curl', `${base}${path}`, '--scope', 'benamtechs-projects', '-s', '-i', '-X', method];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  if (cookie) args.push('-H', `Cookie: ${cookie}`);
  const out = execFileSync('vercel', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = Number((out.match(/^HTTP\/[\d.]+ (\d{3})/m) || [, '0'])[1]);
  const setCookie = (out.match(/^set-cookie:\s*([^;\r\n]+)/im) || [])[1] || null;
  const jsonMatch = out.match(/\{[\s\S]*\}\s*$/);
  let json = {};
  try { json = jsonMatch ? JSON.parse(jsonMatch[0]) : {}; } catch {}
  return { status, json, setCookie };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await client.connect();

async function signIn(email) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await client.query(
    `insert into verification_codes (target_hash, code_hash, purpose, expires_at)
     values ($1, $2, 'admin_login', now() + interval '10 minutes')`,
    [hmac(email.toLowerCase()), hmac(`${email.toLowerCase()}:${code}`)]);
  const r = req('/api/admin/login/verify', { method: 'POST', body: { email, code } });
  return { r, cookie: r.setCookie };
}

console.log('\n── SUPERADMIN (ben@amtechai.com) ──────────────────────');
const su = await signIn('ben@amtechai.com');
su.r.status === 200 && su.r.json.user?.role === 'superadmin'
  ? ok('sign in', `role=${su.r.json.user.role}`)
  : no('sign in', `status=${su.r.status} ${JSON.stringify(su.r.json).slice(0,90)}`);
su.cookie ? ok('session cookie issued') : no('session cookie issued', 'no Set-Cookie');

for (const [p, label] of [['session','session'],['summary','summary'],['leads','leads'],['messages','messages'],['team','team (superadmin only)'],['settings','settings (superadmin only)']]) {
  const r = req(`/api/admin/${p}`, { cookie: su.cookie });
  r.status === 200 ? ok(`read ${label}`) : no(`read ${label}`, `status=${r.status}`);
}
{
  // The invariant is that a superadmin sees EVERY lead, not a filtered subset. It used
  // to be pinned to the 24 rows migration 002 brought over, which made a 25th real lead
  // look like a failure. Counted from the table instead, so it still fails the day the
  // endpoint starts filtering.
  const { rows } = await client.query('select count(*)::int n from leads');
  const expected = rows[0].n;
  const r = req('/api/admin/leads', { cookie: su.cookie });
  const n = r.json.leads?.length ?? -1;
  n === expected ? ok('sees every lead in the table', `${n}`)
                 : no('sees every lead in the table', `the table has ${expected}, the endpoint returned ${n}`);
}

console.log('\n── ADMIN (scoopdogg129@gmail.com) ─────────────────────');
const ad = await signIn('scoopdogg129@gmail.com');
ad.r.status === 200 && ad.r.json.user?.role === 'admin'
  ? ok('sign in', `role=${ad.r.json.user.role}`)
  : no('sign in', `status=${ad.r.status}`);
for (const [p, label] of [['summary','summary'],['leads','leads'],['messages','messages']]) {
  const r = req(`/api/admin/${p}`, { cookie: ad.cookie });
  r.status === 200 ? ok(`read ${label}`) : no(`read ${label}`, `status=${r.status}`);
}
for (const p of ['team','settings']) {
  const r = req(`/api/admin/${p}`, { cookie: ad.cookie });
  r.status === 403 ? ok(`refused ${p}`, '403 superadmin only') : no(`refused ${p}`, `expected 403, got ${r.status}`);
}

console.log('\n── WRITES AND LOGOUT ─────────────────────────────────');
{
  const leads = req('/api/admin/leads', { cookie: ad.cookie }).json.leads;
  if (!leads?.length) { no('update a lead status', 'no session, so nothing to write'); }
  else {
  const target = leads[0];
  const before = target.status;
  const r = req(`/api/admin/lead/${target.id}`, { method: 'PATCH', body: { status: 'contacted' }, cookie: ad.cookie });
  r.status === 200 && r.json.lead.status === 'contacted' ? ok('update a lead status') : no('update a lead status', `status=${r.status}`);
  const bad = req(`/api/admin/lead/${target.id}`, { method: 'PATCH', body: { status: 'banana' }, cookie: ad.cookie });
  bad.status === 400 ? ok('refuse an unknown status', '400') : no('refuse an unknown status', `got ${bad.status}`);
  req(`/api/admin/lead/${target.id}`, { method: 'PATCH', body: { status: before }, cookie: ad.cookie });
  const restored = req(`/api/admin/lead/${target.id}`, { cookie: ad.cookie });
  restored.json.lead?.status === before ? ok('restored the original status', before) : no('restore', 'left modified');
  }
}
{
  const out = req('/api/admin/logout', { method: 'POST', cookie: ad.cookie });
  out.status === 200 ? ok('logout') : no('logout', `status=${out.status}`);
  const after = req('/api/admin/leads', { cookie: ad.cookie });
  after.status === 401 ? ok('session dead after logout', '401') : no('session dead after logout', `got ${after.status}`);
}

await client.query("delete from verification_codes where purpose = 'admin_login'");
await client.end();
console.log(`\n══ ${pass} passed, ${fail} failed ══\n`);
process.exit(fail ? 1 : 0);
