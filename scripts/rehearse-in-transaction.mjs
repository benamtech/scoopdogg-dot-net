#!/usr/bin/env node
/**
 * Rehearse a migration AND its revert inside ONE TRANSACTION THAT IS NEVER COMMITTED.
 *
 *   node scripts/rehearse-in-transaction.mjs 029_a_completion_photo_has_somewhere_to_live.sql
 *
 * WHY THIS EXISTS ALONGSIDE rehearse-migration.mjs. That script is the better instrument and it
 * needs Docker. Measured on this box 2026-09-22: the daemon answers (`docker info` -> 29.5.2),
 * `auth.docker.io` and `registry-1.docker.io` answer from curl, and `docker pull
 * postgres:18-alpine` produces no output and never finishes. The same thing happened on
 * 2026-09-19 and it is why migration 028 has sat unapplied for three days with the review
 * request dead behind it. A rehearsal tool that cannot run is a gate that does not run, and the
 * migration ships unrehearsed or does not ship — both worse than this.
 *
 * WHAT THIS GIVES UP, said plainly so nobody reads the receipt as more than it is:
 *
 *   - It is not a restore of a dump. It runs against the REAL database's current schema, which
 *     is higher fidelity for "will this apply?" and no fidelity at all for "would this work on
 *     last week's backup?".
 *   - It cannot prove the migration is safe under concurrent writes. Neither could the other one.
 *   - `result` is recorded as PASS with `method: "transaction-rollback"`, and
 *     `scripts/check-rehearsal.mjs` treats it the same. The method field is how you tell.
 *
 * WHY IT CANNOT COMMIT BY ACCIDENT, which is the only thing that would make it dangerous:
 *
 *   1. Every `begin;` and `commit;` is STRIPPED from both SQL bodies before anything runs, and
 *      the script refuses outright if either body still contains `commit` or `rollback` after
 *      the strip. A migration's own `commit;` inside our transaction would end ours.
 *   2. The only COMMIT-shaped statement in this file does not exist. The only terminator is
 *      `rollback`, in a `finally`.
 *   3. `lock_timeout` is 3s and `statement_timeout` is 60s, so a rehearsal can never sit on a
 *      lock the live site needs. It fails instead.
 *   4. `idle_in_transaction_session_timeout` is 30s, so a crashed script cannot hold the
 *      transaction open.
 *
 * WHAT IT CHECKS, in order:
 *   schema fingerprint + row counts  ->  apply up  ->  every `-- rehearse:` line returns true
 *   ->  apply down  ->  fingerprint and counts must match the start exactly  ->  rollback
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
loadEnv();

const name = process.argv[2];
if (!name) { console.error('usage: rehearse-in-transaction.mjs <migration.sql>'); process.exit(2); }
const upPath = `migrations/${name}`;
const downPath = `migrations/down/${name.replace('.sql', '.down.sql')}`;
for (const f of [upPath, downPath]) if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(2); }

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const rawUp = readFileSync(upPath, 'utf8');
const rawDown = readFileSync(downPath, 'utf8');

/** Remove the migration's own transaction control. See header point 1. */
function strip(sql, label) {
  const out = sql
    .replace(/^[ \t]*begin[ \t]*;[ \t]*$/gim, '')
    .replace(/^[ \t]*commit[ \t]*;[ \t]*$/gim, '');
  // Anything left that looks like transaction control is a shape this script does not understand,
  // and guessing would be the one mistake that matters.
  const stripped = out.replace(/--[^\n]*/g, '');
  if (/\b(commit|rollback|savepoint)\b/i.test(stripped)) {
    console.error(`REFUSING: ${label} still contains transaction control after stripping begin/commit.`);
    process.exit(2);
  }
  return out;
}
const up = strip(rawUp, upPath);
const down = strip(rawDown, downPath);

/** Every `-- rehearse:` line must return exactly one row whose single column is true. */
const checks = rawUp.split('\n')
  .map((l) => /^--\s*rehearse:\s*(.+)$/.exec(l.trim()))
  .filter(Boolean).map((m) => m[1].trim());

const FINGERPRINT = `
  select coalesce(string_agg(t, E'\\n' order by t), '') as f from (
    select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as t
      from information_schema.columns where table_schema = 'public'
  ) x`;
const COUNTS = `
  select coalesce(string_agg(table_name, ',' order by table_name), '') as t
    from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;

const c = new pg.Client({
  host: process.env.PGHOST, user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, ssl: { rejectUnauthorized: true },
});

let result = 'FAIL', schemaRestored = false, rowsRestored = false, failed = 0;
const notes = [];

async function rowCounts(client, tables) {
  const out = {};
  for (const t of tables) {
    const { rows } = await client.query(`select count(*)::int as n from "${t}"`);
    out[t] = rows[0].n;
  }
  return out;
}

await c.connect();
try {
  await c.query(`set lock_timeout = '3s'`);
  await c.query(`set statement_timeout = '60s'`);
  await c.query(`set idle_in_transaction_session_timeout = '30s'`);
  await c.query('begin');

  const before = (await c.query(FINGERPRINT)).rows[0].f;
  const tablesBefore = (await c.query(COUNTS)).rows[0].t.split(',').filter(Boolean);
  const countsBefore = await rowCounts(c, tablesBefore);

  await c.query(up);
  console.log(`applied   ${upPath}`);

  for (const q of checks) {
    const { rows } = await c.query(q);
    const v = rows.length === 1 ? Object.values(rows[0])[0] : undefined;
    if (v === true) { console.log(`  ok      ${q.slice(0, 96)}`); }
    else { failed++; console.log(`  FAIL    ${q.slice(0, 96)}  -> ${JSON.stringify(rows).slice(0, 80)}`); }
  }

  await c.query(down);
  console.log(`reverted  ${downPath}`);

  const after = (await c.query(FINGERPRINT)).rows[0].f;
  const tablesAfter = (await c.query(COUNTS)).rows[0].t.split(',').filter(Boolean);
  schemaRestored = after === before;
  if (!schemaRestored) {
    const b = new Set(before.split('\n')), a = new Set(after.split('\n'));
    notes.push(`schema drift: +${[...a].filter((x) => !b.has(x)).slice(0, 5).join(' ')} -${[...b].filter((x) => !a.has(x)).slice(0, 5).join(' ')}`);
  }
  const countsAfter = await rowCounts(c, tablesAfter.filter((t) => tablesBefore.includes(t)));
  rowsRestored = tablesBefore.every((t) => countsBefore[t] === countsAfter[t]);
  if (!rowsRestored) {
    notes.push('row counts changed: ' + tablesBefore.filter((t) => countsBefore[t] !== countsAfter[t])
      .map((t) => `${t} ${countsBefore[t]}->${countsAfter[t]}`).join(', '));
  }

  result = (failed === 0 && schemaRestored && rowsRestored) ? 'PASS' : 'FAIL';
} catch (e) {
  notes.push(String(e.message ?? e));
  console.error(`ERROR ${e.message ?? e}`);
} finally {
  // The only terminator in this file.
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
}

mkdirSync('output/rehearsals', { recursive: true });
const receipt = {
  ran_at: new Date().toISOString(),
  method: 'transaction-rollback',
  dump: null,
  up_sha256: sha(upPath),
  down_sha256: sha(downPath),
  schema_restored: schemaRestored,
  rows_restored: rowsRestored,
  rehearse_checks: checks.length,
  rehearse_failed: failed,
  notes,
  result,
};
writeFileSync(`output/rehearsals/${name}.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(`\n${result}  schema_restored=${schemaRestored} rows_restored=${rowsRestored} checks=${checks.length} failed=${failed}`);
if (notes.length) console.log(notes.map((n) => `  note: ${n}`).join('\n'));
process.exit(result === 'PASS' ? 0 : 1);
