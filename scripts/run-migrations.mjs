/**
 * Apply migrations/*.sql in order, once each, tracked in a _migrations table.
 *
 *   node scripts/run-migrations.mjs           # apply pending
 *   node scripts/run-migrations.mjs --status  # show, change nothing
 *
 * Reads DATABASE_URL from its own environment and NEVER prints it. Only the host is
 * ever shown, and only so a human can tell which database they just changed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run from the repository root; scripts/_env.mjs reads .env.local');
  process.exit(1);
}
const host = (() => { try { return new URL(url).host.split('.').slice(-3).join('.'); } catch { return 'unknown'; } })();

const dir = new URL('../migrations/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const statusOnly = process.argv.includes('--status');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await client.connect();
console.log(`connected to …${host}`);

await client.query(`
  create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
const { rows } = await client.query('select name from _migrations');
const done = new Set(rows.map((r) => r.name));

let applied = 0;
for (const f of files) {
  if (done.has(f)) { console.log(`  skip    ${f}`); continue; }
  if (statusOnly) { console.log(`  PENDING ${f}`); continue; }
  const sql = readFileSync(path.join(dir, f), 'utf8');
  try {
    // Each file carries its own begin/commit. Anything that fails leaves nothing behind.
    await client.query(sql);
    await client.query('insert into _migrations (name) values ($1)', [f]);
    console.log(`  applied ${f}`);
    applied++;
  } catch (e) {
    console.error(`  FAILED  ${f}\n          ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
if (!statusOnly) console.log(`\n${applied} migration(s) applied, ${done.size} already present.`);
await client.end();
