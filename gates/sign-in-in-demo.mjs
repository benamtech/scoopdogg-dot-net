/**
 * The owner can sign in to a preview, and demo mode still catches every other message.
 *
 *   node gates/sign-in-in-demo.mjs
 *
 * Every preview forces demo mode (SD_FORCE_DEMO), and demo mode sends all mail to demo.address.
 * Until 2026-10-01 that included sign-in codes, so Josue could not sign in to a preview he was sent:
 * his code went to the sandbox. Now startLogin() marks its send `toRequesterInDemo` and the code
 * goes to the person who typed the address.
 *
 * WITH NO NETWORK: RESEND_API_KEY is removed, so the send fails at the transport after the
 * addresses have been resolved and written to the outbox row. The row is read, then deleted.
 *   - startLogin() for an active team member: the row is addressed to that member;
 *   - the same purpose sent WITHOUT the flag (what gates/demo-mode-no-leak.mjs does): demo.address;
 *   - a lead notification: demo.address.
 * Mutation: drop the flag from startLogin() -> red.
 */
import pg from 'pg';
import path from 'node:path';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
process.env.SD_FORCE_DEMO = '1';
process.env.SD_DEMO_ADDRESS = 'delivered+sign-in-in-demo@resend.dev';
delete process.env.RESEND_API_KEY;
let pass = 0, fail = 0;
const check = (c, w, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${w}${d ? ` — ${d}` : ''}`); };

const out = compileServer();
const { sendEmail } = await import(path.resolve(out, 'server/lib/notify.js'));
const { startLogin } = await import(path.resolve(out, 'server/lib/admin-auth.js'));
const { db } = await import(path.resolve(out, 'server/lib/db.js'));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows: [n0] } = await c.query(`select coalesce(max(id), 0)::bigint as n from outbox`);
const since = Number(n0.n);
try {
  const { rows: [owner] } = await c.query(`select email from team_members where status = 'active' and role = 'admin' order by created_at limit 1`);
  await startLogin(owner.email).catch(() => {});                   // fails at the transport, by design
  await sendEmail({ purpose: 'admin_login', recipients: { explicit: [owner.email] }, subject: 'gate: no flag', html: '<p>gate</p>' }).catch(() => {});
  await sendEmail({ purpose: 'lead', recipients: { settingKey: 'notify.lead_recipients' }, subject: 'gate: lead', html: '<p>gate</p>' }).catch(() => {});
  const { rows } = await c.query(`select id, purpose, payload from outbox where id > $1 order by id`, [since]);
  const to = (r) => JSON.stringify(r?.payload?.to ?? []);
  const [login, unflagged, lead] = rows;
  check(login?.purpose === 'admin_login' && to(login) === JSON.stringify([owner.email.toLowerCase()]), 'a sign-in code an owner asked for goes to the owner, even in demo mode', to(login));
  check(unflagged?.purpose === 'admin_login' && to(unflagged) === JSON.stringify([process.env.SD_DEMO_ADDRESS]), 'NEGATIVE CONTROL: the same email sent any other way still goes to demo.address', to(unflagged));
  check(lead?.purpose === 'lead' && to(lead) === JSON.stringify([process.env.SD_DEMO_ADDRESS]), 'a lead notification still goes to demo.address', to(lead));
  const { rows: [codes] } = await c.query(`select count(*)::int as n from verification_codes where purpose = 'admin_login' and created_at > now() - interval '1 minute' and consumed_at is null`);
  check(codes.n >= 1, 'the code it would have sent exists and is single-use', `${codes.n}`);
} finally {
  await c.query(`delete from outbox where id > $1 and (payload->>'subject' like 'gate:%' or purpose = 'admin_login' and state = 'failed')`, [since]);
  await c.query(`delete from verification_codes where purpose = 'admin_login' and consumed_at is null and created_at > now() - interval '2 minutes'`);
  await c.end(); await db().end().catch(() => {}); cleanupCompile(out);
}
console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
