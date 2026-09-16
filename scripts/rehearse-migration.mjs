#!/usr/bin/env node
// Rehearse a migration AND its revert against a restore of a real dump, before it touches
// the live database.
//
//   node scripts/rehearse-migration.mjs <dump> <migration.sql> <down.sql>
//
// Restores the dump into a throwaway Postgres 18, records a schema fingerprint and row
// counts, applies the migration, runs the checks in the migration's own `-- rehearse:`
// lines (SQL that must return a single `t`), applies the revert, and requires the schema
// fingerprint and every row count to match the original. Nothing here reaches Neon.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const [dump, up, down] = process.argv.slice(2);
if (!dump || !up || !down) {
  console.error('usage: rehearse-migration.mjs <dump> <migration.sql> <down.sql>');
  process.exit(2);
}
const IMAGE = 'postgres:18-alpine';
const name = `sd-rehearse-${Date.now()}`;
const run = (args) => spawnSync('docker', args, { encoding: 'utf8' });
run(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=r', '-p', '127.0.0.1::5432', IMAGE]);
try {
  // pg_isready answers during initdb's temporary server, which then shuts down. Wait for a
  // real query to succeed on the published port, twice, a second apart - the first version
  // of this script restored into the init server and hung on a dead container.
  const port = run(['port', name, '5432']).stdout.trim().split(':').pop();
  const cfg = { host: '127.0.0.1', port: Number(port), user: 'postgres', password: 'r', database: 'postgres', connectionTimeoutMillis: 3000, statement_timeout: 120000 };
  let good = 0;
  for (let i = 0; i < 90 && good < 2; i++) {
    const probe = new pg.Client(cfg);
    try { await probe.connect(); await probe.query('select 1'); good++; } catch { good = 0; }
    try { await probe.end(); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (good < 2) throw new Error('throwaway postgres never became ready');
  run(['cp', dump, `${name}:/tmp/db.dump`]);
  const restore = run(['exec', name, 'pg_restore', '-U', 'postgres', '-d', 'postgres', '--no-owner', '--no-privileges', '/tmp/db.dump']);
  if (restore.status !== 0) console.log('pg_restore warnings:', (restore.stderr || '').slice(0, 300));
  const c = new pg.Client(cfg);
  await c.connect();

  const fingerprint = async () => {
    const { rows } = await c.query(`
      select string_agg(x, E'\n' order by x) f from (
        select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') x
          from information_schema.columns where table_schema='public'
        union all
        select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint
         where connamespace = 'public'::regnamespace
        union all
        select 'idx '||indexname||' '||indexdef from pg_indexes where schemaname='public'
        union all
        select 'trg '||tgname||' '||tgrelid::regclass from pg_trigger where not tgisinternal
      ) s`);
    return createHash('sha256').update(rows[0].f).digest('hex').slice(0, 16);
  };
  const counts = async () => {
    const { rows } = await c.query(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`);
    const out = {};
    for (const { table_name } of rows) out[table_name] = (await c.query(`select count(*)::int n from public."${table_name}"`)).rows[0].n;
    return out;
  };
  const settingsSnapshot = async () => JSON.stringify((await c.query(`select key, value from settings order by key`)).rows);

  const before = { fp: await fingerprint(), counts: await counts(), settings: await settingsSnapshot() };
  const upSql = readFileSync(up, 'utf8');
  await c.query(upSql);
  await c.query(`insert into _migrations (name) values ($1)`, [up.split('/').pop()]);

  const checks = [...upSql.matchAll(/^-- rehearse: (.+)$/gm)].map((m) => m[1]);
  let failed = 0;
  for (const sql of checks) {
    const { rows } = await c.query(sql);
    const ok = rows.length === 1 && Object.values(rows[0])[0] === true;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${sql.slice(0, 110)}`);
  }
  const mid = { fp: await fingerprint(), counts: await counts() };

  await c.query(readFileSync(down, 'utf8'));
  const after = { fp: await fingerprint(), counts: await counts(), settings: await settingsSnapshot() };
  await c.end();

  const countDiff = Object.keys({ ...before.counts, ...after.counts }).filter((t) => before.counts[t] !== after.counts[t]);
  // updated_by and updated_at legitimately move on a revert, so settings compare key+value only.
  const norm = (s) => JSON.stringify(JSON.parse(s).map((r) => [r.key, r.value]));
  const settingsSame = norm(before.settings) === norm(after.settings);
  console.log(JSON.stringify({
    schema_before: before.fp, schema_migrated: mid.fp, schema_after_revert: after.fp,
    schema_restored: before.fp === after.fp,
    rows_restored: countDiff.length === 0, row_differences: countDiff,
    settings_restored: settingsSame,
    rehearse_checks: checks.length, rehearse_failed: failed,
    new_tables: Object.keys(mid.counts).filter((t) => !(t in before.counts)),
  }, null, 1));
  const passed = before.fp === after.fp && countDiff.length === 0 && settingsSame && failed === 0;
  // A receipt keyed on the bytes of both files, so the oracle can read the answer without
  // re-running a two-minute rehearsal, and any edit to either file invalidates it.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
  mkdirSync('output/rehearsals', { recursive: true });
  writeFileSync(`output/rehearsals/${up.split('/').pop()}.json`, JSON.stringify({
    ran_at: new Date().toISOString(), dump: dump.split('/').slice(-3).join('/'),
    up_sha256: sha(up), down_sha256: sha(down),
    schema_restored: before.fp === after.fp, rows_restored: countDiff.length === 0,
    settings_restored: settingsSame, rehearse_checks: checks.length, rehearse_failed: failed,
    result: passed ? 'PASS' : 'FAIL',
  }, null, 2));
  process.exitCode = passed ? 0 : 1;
} finally {
  run(['rm', '-f', name]);
}
