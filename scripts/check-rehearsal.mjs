/**
 * Read a migration rehearsal receipt and confirm it still describes the files on disk.
 *   node scripts/check-rehearsal.mjs 011_packages_money_schedule.sql
 * PASS only when the receipt passed AND both files hash to what was rehearsed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const name = process.argv[2];
const r = `output/rehearsals/${name}.json`;
if (!existsSync(r)) { console.log('MISSING no rehearsal receipt'); process.exit(1); }
const rec = JSON.parse(readFileSync(r, 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const upNow = sha(`migrations/${name}`);
const downNow = sha(`migrations/down/${name.replace('.sql', '.down.sql')}`);
const current = upNow === rec.up_sha256 && downNow === rec.down_sha256;
console.log(`${rec.result === 'PASS' && current ? 'PASS' : 'FAIL'} schema_restored=${rec.schema_restored} rows_restored=${rec.rows_restored} current=${current} ran_at=${rec.ran_at}`);
