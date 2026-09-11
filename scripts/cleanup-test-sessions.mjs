/** Revoke sessions opened by an automated test. Test state does not live in a client's database. */
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const r = await c.query("delete from sessions where actor_kind in ('admin','superadmin')");
const v = await c.query("delete from verification_codes where purpose = 'admin_login'");
console.log(`  revoked ${r.rowCount} session(s), cleared ${v.rowCount} unused code(s)`);
await c.end();
