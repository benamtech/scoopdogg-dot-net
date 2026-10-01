/**
 * Run ONE read-only query and print the rows as JSON lines.
 *
 *   node scripts/sql-read.mjs "select slug, name from services"
 *
 * The transaction is declared READ ONLY, so a typo that would write fails in Postgres
 * rather than in a client's data. The connection string is never printed.
 */
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const sql = process.argv[2];
if (!sql) {
  console.error('usage: sql-read.mjs "<select ...>"');
  process.exit(2);
}
// PG* variables locally (Vercel's Neon integration writes them to .env.local); DATABASE_URL where
// only that is set, as in the GitHub Actions production check.
const c = new pg.Client(process.env.PGHOST
  ? { host: process.env.PGHOST, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: { rejectUnauthorized: true } }
  : { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query('begin transaction read only');
  const { rows } = await c.query(sql);
  for (const r of rows) console.log(JSON.stringify(r));
  await c.query('rollback');
} catch (e) {
  console.error('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
