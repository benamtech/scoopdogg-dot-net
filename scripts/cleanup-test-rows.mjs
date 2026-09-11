/** Remove rows written by an automated test. Never leave test data in a live database. */
import pg from 'pg';
const mark = process.env.E2E_MARK;
if (!mark) { console.error('set E2E_MARK'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const a = await c.query('delete from leads where name like $1', [mark + '%']);
const b = await c.query('delete from contact_messages where name like $1', [mark + '%']);
const n = await c.query('select count(*)::int n from leads');
console.log(`removed ${a.rowCount} lead(s), ${b.rowCount} message(s); ${n.rows[0].n} leads remain`);
await c.end();
