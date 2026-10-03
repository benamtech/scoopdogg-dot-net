#!/usr/bin/env node
// Dump the Neon database and prove the dump restores.
//
//   node scripts/backup-db.mjs <out-dir>
//
// Writes <out-dir>/neon.dump (pg_dump custom format), <out-dir>/counts-source.json and
// <out-dir>/restore-receipt.json. The restore goes into a throwaway Postgres container that
// is removed afterwards, and the receipt compares exact row counts table by table.
//
// The connection string never reaches stdout: pg_dump runs in a container that inherits the
// PG* variables by NAME (`docker run -e PGHOST`), so no value is ever on a command line.
// The server is Postgres 18, so the client tools must be 18 too - pg_dump refuses a newer
// server than itself.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const IMAGE = 'postgres:18-alpine';
const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/backup-db.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
for (const k of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
  if (!process.env[k]) {
    console.error(`missing ${k} in the environment`);
    process.exit(2);
  }
}

async function counts(client) {
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  const result = {};
  for (const { table_name } of tables) {
    const { rows } = await client.query(`select count(*)::int n from public."${table_name}"`);
    result[table_name] = rows[0].n;
  }
  return result;
}

// 1. counts at source, taken immediately before the dump
const src = new pg.Client({
  host: process.env.PGHOST_UNPOOLED || process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: true },
});
await src.connect();
const sourceCounts = await counts(src);
const { rows: ver } = await src.query(`select current_setting('server_version') v`);
await src.end();
writeFileSync(path.join(out, 'counts-source.json'), JSON.stringify(sourceCounts, null, 2));

// 2. pg_dump, custom format, no owners or grants so it restores into any role
const dumpPath = path.join(out, 'neon.dump');
const dump = spawnSync(
  'docker',
  [
    'run', '--rm',
    '-e', 'PGHOST', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE',
    '-e', 'PGSSLMODE=require',
    IMAGE, 'pg_dump', '-Fc', '--no-owner', '--no-privileges',
  ],
  {
    env: { ...process.env, PGHOST: process.env.PGHOST_UNPOOLED || process.env.PGHOST },
    maxBuffer: 512 * 1024 * 1024,
  },
);
if (dump.status !== 0) {
  console.error('pg_dump failed:', dump.stderr.toString().slice(0, 500));
  process.exit(1);
}
writeFileSync(dumpPath, dump.stdout);
const sha = createHash('sha256').update(readFileSync(dumpPath)).digest('hex');

// 3. restore into a throwaway container and count again
const name = `sd-restore-${Date.now()}`;
const run = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });
run(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=restore', '-p', '127.0.0.1::5432', IMAGE]);
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = run(['exec', name, 'pg_isready', '-U', 'postgres']).status === 0;
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
// pg_isready answers during the init restart; give the final server a moment
await new Promise((r) => setTimeout(r, 3000));
run(['cp', dumpPath, `${name}:/tmp/neon.dump`]);
const restore = run(['exec', name, 'pg_restore', '-U', 'postgres', '-d', 'postgres', '--no-owner', '--no-privileges', '/tmp/neon.dump']);
const port = run(['port', name, '5432']).stdout.trim().split(':').pop();
const dst = new pg.Client({ host: '127.0.0.1', port: Number(port), user: 'postgres', password: 'restore', database: 'postgres' });
await dst.connect();
const restoredCounts = await counts(dst);
await dst.end();
run(['rm', '-f', name]);

const mismatches = Object.keys({ ...sourceCounts, ...restoredCounts }).filter(
  (t) => sourceCounts[t] !== restoredCounts[t],
);
const receipt = {
  what: 'pg_dump of Neon, restored into a throwaway Postgres 18, row counts compared per table',
  ran_at: new Date().toISOString(),
  server_version: ver[0].v,
  client_image: IMAGE,
  dump_bytes: statSync(dumpPath).size,
  dump_sha256: sha,
  tables: Object.keys(sourceCounts).length,
  source_counts: sourceCounts,
  restored_counts: restoredCounts,
  restore_warnings: (restore.stderr || '').split('\n').filter(Boolean).slice(0, 20),
  mismatches,
  result: mismatches.length === 0 ? 'PASS' : 'FAIL',
};
writeFileSync(path.join(out, 'restore-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ result: receipt.result, tables: receipt.tables, dump_bytes: receipt.dump_bytes, mismatches, leads: sourceCounts.leads }, null, 0));
process.exit(mismatches.length === 0 ? 0 : 1);
