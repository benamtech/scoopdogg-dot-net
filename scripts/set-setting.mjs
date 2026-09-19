/** Set one setting in the live database. `node scripts/set-setting.mjs key '<json>'` */
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();

const [key, json] = process.argv.slice(2);
if (!key || json === undefined) { console.error('usage: set-setting.mjs <key> <json-value>'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const before = await c.query('select value from settings where key = $1', [key]);
await c.query(
  `insert into settings (key, value, updated_by) values ($1, $2::jsonb, 'amtech')
   on conflict (key) do update set value = excluded.value, updated_by = 'amtech', updated_at = now()`,
  [key, json]);
const after = await c.query('select value from settings where key = $1', [key]);
console.log(`  ${key}\n    was: ${JSON.stringify(before.rows[0]?.value ?? null)}\n    now: ${JSON.stringify(after.rows[0].value)}`);
await c.end();
