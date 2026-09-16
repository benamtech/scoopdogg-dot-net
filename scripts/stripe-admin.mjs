/**
 * Stripe setup for Scoop Dogg, through the SAME server code the admin button runs.
 *
 *   node scripts/stripe-admin.mjs status  --mode test
 *   node scripts/stripe-admin.mjs create  --mode test          # creates the V2 connected account (once)
 *   node scripts/stripe-admin.mjs link    --mode test          # prints a hosted onboarding URL
 *   node scripts/stripe-admin.mjs publish --mode test          # packages -> versioned Prices
 *
 * Keys are loaded by gates/_env.mjs and never printed. Nothing here runs in live mode
 * without `--mode live` typed out.
 */
import { loadEnv } from '../gates/_env.mjs';
import { compileServer } from '../gates/_compile.mjs';
import path from 'node:path';

const [cmd] = process.argv.slice(2);
const mode = process.argv[process.argv.indexOf('--mode') + 1];
if (!['status', 'create', 'link', 'publish', 'fixture', 'requirements', 'sandbox'].includes(cmd) || !['test', 'live'].includes(mode)) {
  console.error('usage: stripe-admin.mjs status|create|link|publish --mode test|live');
  process.exit(2);
}
const env = loadEnv();
console.log(`  env: stripe_test=${env.stripe_test} stripe_live=${env.stripe_live} db=${env.database_url}`);
const build = compileServer();
const s = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));
try {
  if (cmd === 'create') console.log(await s.createConnectedAccount(mode, { displayName: 'Scoop Dogg', email: 'josue@scoopdogg.net', by: 'amtech-script' }));
  if (cmd === 'link') console.log(await s.onboardingLink(mode, 'https://scoopdogg.vercel.app'));
  if (cmd === 'fixture') {
    if (mode !== 'test') throw new Error('the fixture account exists only in test mode');
    console.log(await s.createTestFixtureAccount('amtech-script'));
    await new Promise((r) => setTimeout(r, 5000));
    console.log(await s.requirementsOf('test'));
    console.log(await s.probeAccount('test'));
  }
  if (cmd === 'sandbox') {
    // Test mode only: a fresh V2 full-dashboard account whose contact email cannot receive mail,
    // so scripted hosted onboarding never writes to a real inbox.
    if (mode !== 'test') throw new Error('sandbox accounts exist only in test mode');
    await db().query(`update stripe_connection set account_id = null where livemode = false`);
    console.log(await s.createConnectedAccount('test', { displayName: 'Scoop Dogg', email: 'scoopdogg-sandbox@example.com', by: 'amtech-script' }));
    const url = await s.onboardingLink('test', 'https://scoopdogg.vercel.app');
    (await import('node:fs')).writeFileSync('/tmp/sd-onboard-url.txt', url);
    console.log('onboarding link written to /tmp/sd-onboard-url.txt');
  }
  if (cmd === 'requirements') console.log(await s.requirementsOf(mode));
  if (cmd === 'publish') console.table(await s.publishAllPrices(mode));
  if (cmd !== 'fixture') console.log(await s.probeAccount(mode).catch(async () => s.probeV1Account(mode)));
} finally {
  await db().end();
}
