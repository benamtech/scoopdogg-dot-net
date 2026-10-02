/**
 * Revoke sessions opened by an automated test. Test state does not live in a client's
 * database.
 *
 *   E2E_MARK=... node scripts/cleanup-test-sessions.mjs
 *
 * SCOPED, and it was not before. This script used to delete every session whose actor kind
 * was an admin or a superadmin, with no other condition at all -
 * which is every real admin session in the database, not the test's. Anyone signed into
 * the admin - the owner, or whoever is halfway through an acceptance walk - was signed out
 * by any e2e run that happened to finish. The team member the test signed in AS is the
 * only thing it created, so that is the only thing it may delete.
 *
 * Scope comes from E2E_MARK, matched against the team member's name or email, the same way
 * scripts/cleanup-test-rows.mjs scopes its deletes. With no mark it refuses, because a
 * cleanup that does not know what it created can only guess.
 */
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const mark = process.env.E2E_MARK;
if (!mark) {
  console.error('set E2E_MARK — this script deletes only the sessions of team members ' +
                'whose name or email carries the mark, and refuses to guess');
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();

// Count first, so the receipt says what survived as well as what went.
const before = await c.query(
  "select count(*)::int n from sessions where revoked_at is null and expires_at > now()");

const r = await c.query(
  `delete from sessions
    where team_id in (select id from team_members where name like $1 or email like $1)`,
  [mark + '%']);

// Unused sign-in codes are hashed against the address, so they cannot be matched by mark.
// They expire in ten minutes on their own and consuming one requires the code, so leaving
// them is safe; deleting every admin code is not, for the same reason as above.
const v = await c.query(
  `delete from verification_codes
    where purpose = 'admin_login' and consumed_at is null and expires_at < now()`);

const after = await c.query(
  "select count(*)::int n from sessions where revoked_at is null and expires_at > now()");

console.log(`  revoked ${r.rowCount} session(s) for '${mark}', cleared ${v.rowCount} expired code(s)`);
console.log(`  ${after.rows[0].n} live session(s) remain (was ${before.rows[0].n}) — real sign-ins untouched`);
await c.end();
