/**
 * Clear AMTECH's platform fee from every live subscription on the connected account.
 *
 *   node scripts/remove-platform-fee.mjs --mode test           # list, change nothing
 *   node scripts/remove-platform-fee.mjs --mode test --apply   # clear it
 *
 * THIS IS THE TERMINATION CLAUSE, AS CODE. Stripe, verbatim: *"If the subscription was created
 * with an `application_fee_percent`, the application fee continues to be collected by the platform
 * after disconnect. Remove the `application_fee_percent` from the Subscription before a connected
 * account disconnects from your platform."*
 *
 * So a client who leaves keeps paying us unless something runs, and nothing would have. Taking 9%
 * from a business that has left is the single worst thing this integration could do by accident,
 * and it would do it quietly, monthly, until somebody read a statement.
 *
 * THE LOOP ITSELF LIVES IN server/lib/stripe.ts (`clearPlatformFee`), which is also what the
 * admin's Disconnect button calls. It used to live here, and then the button would have been a
 * second implementation of the one thing in this system that must not be got wrong twice - the
 * same argument money.ts makes about doors. This file is the human's dry run and receipt.
 *
 * It is a dry run unless `--apply` is typed. It prints counts and subscription ids, never a key.
 */
import path from 'node:path';
import { loadEnv } from './_env.mjs';
import { compileServer } from '../gates/_compile.mjs';

loadEnv();
const mode = process.argv[process.argv.indexOf('--mode') + 1];
const apply = process.argv.includes('--apply');
if (!['test', 'live'].includes(mode)) {
  console.error('usage: remove-platform-fee.mjs --mode test|live [--apply]');
  process.exit(2);
}

const build = compileServer();
const { clearPlatformFee } = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

const r = await clearPlatformFee(mode, { apply });
console.log(`  account ${r.account} (${mode})${apply ? '' : ' — DRY RUN, nothing will change'}`);
for (const id of r.ids) console.log(`  ${apply ? 'cleared ' : 'would clear'}  ${id}`);
for (const f of r.failures) console.log(`  FAILED   ${f}`);
console.log(`\n  ${r.scanned} subscription(s) on the account, ${r.live} of them still chargeable, ` +
  `${r.carrying} carrying a fee, ${r.cleared} cleared${r.failures.length ? `, ${r.failures.length} FAILED` : ''}`);
if (!apply && r.carrying) console.log('  Re-run with --apply to clear them. Do this BEFORE any disconnect.');
await db().end();
process.exit(r.failures.length ? 1 : 0);
