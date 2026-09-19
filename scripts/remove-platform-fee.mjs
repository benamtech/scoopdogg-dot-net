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
 * and it would do it quietly, monthly, until somebody read a statement. P18 §1.4 puts this FIRST
 * in the disconnect sequence, before the deauthorize call, because after the deauthorize we no
 * longer have the access to fix it.
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
const { resolve } = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));
const { stripe, account } = await resolve(mode);

console.log(`  account ${account} (${mode})${apply ? '' : ' — DRY RUN, nothing will change'}`);

let scanned = 0;
let live = 0;
let carrying = 0;
let cleared = 0;
const failures = [];

for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100 }, { stripeAccount: account })) {
  scanned++;
  // A subscription that is already gone cannot be charged a fee, so it is not our problem; one
  // that is paused or past_due very much can be.
  if (['canceled', 'incomplete_expired'].includes(sub.status)) continue;
  live++;
  const pct = sub.application_fee_percent;
  if (pct == null || Number(pct) === 0) continue;
  carrying++;
  console.log(`  ${apply ? 'clearing' : 'would clear'}  ${sub.id}  ${sub.status}  ${pct}%`);
  if (!apply) continue;
  try {
    // Stripe unsets an optional number by being sent an empty string.
    await stripe.subscriptions.update(sub.id, { application_fee_percent: '' }, { stripeAccount: account });
    cleared++;
  } catch (e) {
    failures.push(`${sub.id}: ${(e?.message ?? String(e)).split('\n')[0]}`);
  }
}

for (const f of failures) console.log(`  FAILED   ${f}`);
console.log(`\n  ${scanned} subscription(s) on the account, ${live} of them still chargeable, ${carrying} carrying a fee, ${cleared} cleared${failures.length ? `, ${failures.length} FAILED` : ''}`);
if (!apply && carrying) console.log('  Re-run with --apply to clear them. Do this BEFORE any deauthorize.');
await db().end();
process.exit(failures.length ? 1 : 0);
