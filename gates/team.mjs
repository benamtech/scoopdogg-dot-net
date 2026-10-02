/**
 * The team can be run from the admin, and nobody can lock the business out of it.
 *
 *   node gates/team.mjs
 *
 * THE FAULT THIS EXISTS FOR. `team_members` had readers on every admin request and no writer
 * outside a migration and a gate — `gates/writers-outside-gates.mjs` named it on its first run.
 * Adding a person meant AMTECH running SQL, and so did removing one; `admin-auth.ts` documented
 * revoking as "one UPDATE on team_members.status" that nothing performed. server/lib/team.ts is
 * the writer. This checks its rules, because each rule is a way for an owner to lock their own
 * business out of its own records with one tap:
 *
 *   - nobody changes their own access
 *   - the last active owner cannot be switched off
 *   - only a superadmin creates or changes a superadmin
 *   - switching somebody off ends their open sessions, not just their next login
 *
 * Every row is written through the SHIPPED functions with this gate's client passed in, inside
 * one transaction that is always rolled back. It adds nobody to the real team.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const refuses = async (fn, code) => {
  try { await fn(); return { refused: false }; }
  catch (e) { return { refused: e?.code === code, got: e?.code ?? e?.message }; }
};

// ---- A. the pieces are wired -----------------------------------------------------------------
console.log('A. a writer, a route, a screen, and the crew kept out');
const adminTs = readFileSync('api/admin.ts', 'utf8');
const page = readFileSync('src/pages_react/admin/AdminTeamPage.tsx', 'utf8');
const layout = readFileSync('src/components/admin/AdminLayout.tsx', 'utf8');
const authTs = readFileSync('server/lib/admin-auth.ts', 'utf8');
check(/path === 'team\/add'/.test(adminTs) && /path === 'team\/status'/.test(adminTs), 'the admin API adds and switches people');
check(/adminApi\.addTeamMember\(/.test(page) && /adminApi\.setTeamStatus\(/.test(page), 'and the Team screen calls both');
check(/to: '\/admin\/team'/.test(layout), 'the screen is in the menu', 'a screen nobody can reach is a writer with no caller');
const crew = /CREW_PATHS = new Set\(\[([\s\S]*?)\]\)/.exec(adminTs)?.[1] ?? '';
check(crew.length > 0 && !/'team/.test(crew), 'crew cannot reach any team path', 'CREW_PATHS is default-deny and names none of them');
check(/t\.status = 'active'/.test(authTs), 'every admin request re-checks that the person is still switched on',
  'so switching off takes effect on the next click, not when a cookie expires');

// ---- B. the rules, through the shipped functions --------------------------------------------
console.log('\nB. the rules');
const out = compileServer();
const { addTeamMember, setTeamStatus, listTeam } = await import(`${process.cwd()}/${out}/server/lib/team.js`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');

  // An owner to act as, planted as the ONLY active owner so the last-owner rule can be reached.
  await c.query(`update team_members set status = 'inactive' where status = 'active'`);
  const { rows: [owner] } = await c.query(
    `insert into team_members (name, email, role, status) values ('GATE owner', 'gate+owner@example.invalid', 'admin', 'active') returning id`);
  const asOwner = { teamId: owner.id, role: 'admin' };

  const m = await addTeamMember({ name: 'GATE crew', email: 'Gate+Crew@Example.invalid', phone: '(805) 555-0199' }, asOwner, c);
  check(m.status === 'active' && m.role === 'crew' && m.email === 'gate+crew@example.invalid',
    'an owner adds somebody, as crew by default, with the email normalised',
    `${m.role}, ${m.email}`);
  const { rows: [ev] } = await c.query(`select event_type, actor_id from events where subject_kind = 'team' and subject_id = $1`, [m.id]);
  check(ev?.event_type === 'team.added' && ev.actor_id === owner.id, 'and who added them is on the record', ev?.event_type);

  const dup = await refuses(() => addTeamMember({ name: 'Again', email: 'gate+crew@example.invalid' }, asOwner, c), 'exists');
  check(dup.refused, 'the same email twice is refused', 'a duplicate would split the visits they completed across two rows');

  const noEmail = await refuses(() => addTeamMember({ name: 'No email', email: '' }, asOwner, c), 'email_required');
  check(noEmail.refused, 'nobody is added without an email', 'sign-in is by email for every role — the row could never be used');

  const sup = await refuses(() => addTeamMember({ name: 'Up', email: 'gate+up@example.invalid', role: 'superadmin' }, asOwner, c), 'forbidden');
  check(sup.refused, 'an owner cannot create a superadmin', 'only the people who can recover the account can add more of them');

  const crewCaller = await refuses(() => addTeamMember({ name: 'X', email: 'gate+x@example.invalid' }, { teamId: m.id, role: 'crew' }, c), 'forbidden');
  check(crewCaller.refused, 'crew cannot add people', 'even if they reached the function some other way');

  // ---- switching off ----
  const tok = randomBytes(16).toString('hex');
  await c.query(
    `insert into sessions (actor_kind, team_id, token_hash, expires_at) values ('team', $1, $2, now() + interval '8 hours')`, [m.id, tok]);
  const off = await setTeamStatus(m.id, 'inactive', asOwner, c);
  const { rows: [sess] } = await c.query(`select revoked_at from sessions where token_hash = $1`, [tok]);
  check(off.status === 'inactive' && off.ended_at !== null, 'switching somebody off records the day they stopped', off.ended_at);
  check(sess?.revoked_at !== null, 'and ends the session they already had open', 'not "signed out when the cookie expires in eight hours"');
  const still = (await listTeam(c)).find((t) => t.id === m.id);
  check(!!still, 'and they are still on the list', 'nobody is deleted — visits they completed keep naming them');

  const on = await setTeamStatus(m.id, 'active', asOwner, c);
  check(on.status === 'active' && on.ended_at === null, 'switching them back on is one tap and clears the end date');

  const self = await refuses(() => setTeamStatus(owner.id, 'inactive', asOwner, c), 'self');
  check(self.refused, 'nobody can switch off their own access', 'the only person who could undo it would be signed out');

  // The last-owner rule, reached from a SECOND owner so the self rule is not what stops it.
  const second = await addTeamMember({ name: 'GATE owner 2', email: 'gate+owner2@example.invalid', role: 'admin' }, asOwner, c);
  await setTeamStatus(owner.id, 'inactive', { teamId: second.id, role: 'admin' }, c);
  const last = await refuses(() => setTeamStatus(second.id, 'inactive', { teamId: m.id, role: 'admin' }, c), 'last_owner');
  check(last.refused, 'the last owner cannot be switched off', 'a business nobody can sign in to has to phone AMTECH for its own records');

  // ---- superadmins are protected from owners ----
  const { rows: [sa] } = await c.query(
    `insert into team_members (name, email, role, status) values ('GATE super', 'gate+super@example.invalid', 'superadmin', 'active') returning id`);
  const saOff = await refuses(() => setTeamStatus(sa.id, 'inactive', { teamId: second.id, role: 'admin' }, c), 'forbidden');
  check(saOff.refused, 'an owner cannot switch off a superadmin');

  // ---- negative control: the rules are not refusing everything ----
  console.log('\nnegative controls');
  const fine = await setTeamStatus(m.id, 'inactive', { teamId: second.id, role: 'admin' }, c);
  check(fine.status === 'inactive', 'an ordinary switch-off by another owner still works', 'so the refusals above are rules, not a broken function');
  const saCan = await setTeamStatus(second.id, 'active', { teamId: sa.id, role: 'superadmin' }, c);
  check(saCan.status === 'active', 'and a superadmin can change an owner');
} catch (e) {
  no('the gate ran to the end', String(e.message ?? e));
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  cleanupCompile();
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
