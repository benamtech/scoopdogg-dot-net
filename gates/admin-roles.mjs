/**
 * A crew session cannot read money, customers or settings.
 *
 *   node gates/admin-roles.mjs
 *
 * P18 §5. Crew exists so the crew loop has somewhere to land, and the moment it does there is a
 * phone in a truck signed into the same admin the owner uses. What that phone may reach has to be
 * a property of the code rather than of which links the menu happens to render.
 *
 * IT CALLS THE REAL HANDLER, not a copy of its rules, and it asks for routes BY NAME including
 * ones a crew member has no business seeing. The handler's own guard is an allowlist - three
 * paths, everything else refused - so this gate also asks for a path that does not exist at all
 * (`money/everything`) and requires a 403 rather than a 404: a default-deny answers "no" before
 * it answers "no such thing", and that is the difference between a rule and a habit.
 *
 * It creates a crew team member and a session for it, and removes both in a `finally`.
 */
import pg from 'pg';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer } from './_compile.mjs';

loadEnv();
const build = compileServer();
const { default: admin } = await import(path.join(build, 'api/admin.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

const secret = process.env.SESSION_SECRET || process.env.DATABASE_URL;
const hmac = (v) => createHmac('sha256', secret).update(v).digest('hex');

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

/** A request/response pair the handler cannot tell from Vercel's. */
async function callAdmin(pathName, token, method = 'GET') {
  const req = {
    url: `/api/admin?path=${encodeURIComponent(pathName)}`,
    method,
    headers: { cookie: `sd_admin=${token}` },
    socket: { remoteAddress: '127.0.0.1' },
    body: {},                               // readJsonBody returns this rather than reading a stream
  };
  let status = 0, body = '';
  const res = {
    statusCode: 200,
    setHeader() {}, getHeader() { return undefined; },
    end(payload) { status = res.statusCode; body = String(payload ?? ''); },
  };
  await admin(req, res);
  let json = {};
  try { json = JSON.parse(body); } catch { /* not json */ }
  return { status, json };
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const stamp = Date.now().toString().slice(-6);
let crewId = null, crewToken = null, ownerToken = null, ownerSession = null, crewSession = null;

try {
  const { rows: crew } = await c.query(
    `insert into team_members (name, email, phone, role, status, started_at)
     values ($1, $2, null, 'crew', 'active', current_date) returning id`,
    [`DEMO—Crew ${stamp}`, `crew-gate-${stamp}@example.invalid`]);
  crewId = crew[0].id;
  ok('a crew member can exist at all', 'role crew accepted by the constraint');

  crewToken = randomBytes(32).toString('hex');
  const { rows: cs } = await c.query(
    `insert into sessions (actor_kind, team_id, token_hash, expires_at) values ('team', $1, $2, now() + interval '1 hour') returning id`,
    [crewId, hmac(crewToken)]);
  crewSession = cs[0].id;

  // An owner session, so every refusal below is shown to be about the ROLE and not about the
  // route being broken for everyone.
  const { rows: owner } = await c.query(`select id from team_members where role = 'admin' and status = 'active' limit 1`);
  ownerToken = randomBytes(32).toString('hex');
  const { rows: os } = await c.query(
    `insert into sessions (actor_kind, team_id, token_hash, expires_at) values ('admin', $1, $2, now() + interval '1 hour') returning id`,
    [owner[0].id, hmac(ownerToken)]);
  ownerSession = os[0].id;

  // ---- what crew may reach ------------------------------------------------------------------
  for (const p of ['session', 'today']) {
    const r = await callAdmin(p, crewToken);
    r.status === 200 ? ok(`crew reaches ${p}`) : no(`crew reaches ${p}`, `HTTP ${r.status}`);
  }

  // ---- what it may not --------------------------------------------------------------------
  const FORBIDDEN = ['customers', 'growth', 'unfinished', 'checklist', 'payments', 'leads', 'messages',
    'summary', 'business', 'team', 'settings', 'demo', 'money/everything'];
  const leaks = [];
  for (const p of FORBIDDEN) {
    const r = await callAdmin(p, crewToken);
    if (r.status !== 403) leaks.push(`${p} -> ${r.status}`);
  }
  leaks.length ? no('crew is refused every business route', leaks.join(', '))
               : ok('crew is refused every business route', `${FORBIDDEN.length} routes, all 403`);

  for (const [p, method] of [['payments/disconnect', 'POST'], ['customers/invite', 'POST'], ['checklist/prices/confirm', 'POST']]) {
    const r = await callAdmin(p, crewToken, method);
    r.status === 403 ? ok(`crew is refused ${method} ${p}`) : no(`crew is refused ${method} ${p}`, `HTTP ${r.status}`);
  }

  // A route nobody has written yet is refused before it is "not found". That is default deny.
  {
    const r = await callAdmin('a/route/added/next/month', crewToken);
    r.status === 403 ? ok('a route that does not exist yet is refused too, not 404')
                     : no('a route that does not exist yet is refused too', `HTTP ${r.status}`);
  }

  // ---- the same routes answer for the owner, so the refusal is the role ----------------------
  {
    const opened = [];
    for (const p of ['customers', 'growth', 'checklist', 'leads', 'payments']) {
      const r = await callAdmin(p, ownerToken);
      if (r.status === 403 || r.status === 401) opened.push(`${p} -> ${r.status}`);
    }
    opened.length ? no('the owner still reaches everything', opened.join(', '))
                  : ok('the owner still reaches everything', 'five business routes');
  }

  // Superadmin-only stays superadmin-only for the owner.
  {
    const r = await callAdmin('settings', ownerToken);
    r.status === 403 ? ok('settings remains superadmin-only, even for the owner')
                     : no('settings remains superadmin-only, even for the owner', `HTTP ${r.status}`);
  }

  // ---- negative control ---------------------------------------------------------------------
  // The detector must be able to see a leak. Ask for a forbidden route with the OWNER's cookie
  // and require a non-403 - if that came back 403 too, this gate would be measuring nothing.
  {
    const r = await callAdmin('customers', ownerToken);
    r.status !== 403 ? ok('negative control: the same route is open to the owner, so 403 means the role')
                     : no('negative control: the same route is open to the owner', 'DETECTOR BLIND');
  }
} catch (e) {
  no('the role gate ran without throwing', String(e.message).split('\n')[0]);
} finally {
  if (crewSession) await c.query(`delete from sessions where id = $1`, [crewSession]).catch(() => {});
  if (ownerSession) await c.query(`delete from sessions where id = $1`, [ownerSession]).catch(() => {});
  if (crewId) await c.query(`delete from team_members where id = $1`, [crewId]).catch(() => {});
  const { rows: left } = await c.query(`select count(*)::int n from team_members where name like 'DEMO—Crew%'`);
  left[0].n === 0 ? ok('it left no team member behind') : no('it left no team member behind', `${left[0].n}`);
  await c.end();
  await db().end();
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
