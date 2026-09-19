/**
 * Get a TEST connected account to `charges_enabled`, so the money path can be proven end to end.
 *
 *   node scripts/stripe-chargeable-test-account.mjs probe     # what does Stripe actually refuse?
 *   node scripts/stripe-chargeable-test-account.mjs create    # make one and fill it
 *   node scripts/stripe-chargeable-test-account.mjs connect   # point stripe_connection at it
 *
 * TEST MODE ONLY. It refuses to run against a live key, and it says so rather than assuming.
 *
 * WHY THIS EXISTS. The record says: "a scripted Stripe test fixture cannot reach a chargeable
 * account ... corrected, it moves card_payments from restricted to pending and then wants an
 * uploaded ID document and a bank account. Two attempts was the budget." That has stood as a
 * blocker needing "one human pass through hosted onboarding" since 2026-09-19, and
 * `checkout-e2e` has reported PASS(request) rather than PASS(paid) ever since.
 *
 * MEASURED BEFORE WRITING THIS. `stripe-admin.mjs requirements --mode test` lists what Stripe
 * currently wants on the test account, in Stripe's own words:
 *
 *     external_account
 *     identity.attestations.terms_of_service.account.date / .ip
 *     identity.entity_type
 *     representative.date_of_birth.{day,month,year}
 *     representative.email / .given_name / .surname
 *
 * A name, a date of birth, an email, a terms attestation and a bank token. **There is no
 * document in that list.** Stripe's own testing guide fills every one of these with published
 * test values — `external_account=btok_us`, `ssn_last_4=0000`, `tax_id=000000000` — and says
 * the result is `charges_enabled=true`. The recorded blocker describes what one particular
 * controller configuration refused, not what the API refuses.
 *
 * THE OPEN QUESTION THIS ANSWERS FIRST. The record also says Accounts v1 creation is "refused
 * for this platform", which would rule out the documented v1 recipe. `probe` tests that claim
 * directly instead of planning around it: it attempts a v1 create and prints Stripe's verbatim
 * answer. Thirty seconds, and it either opens the documented path or closes it with evidence.
 *
 * NOTHING HERE TOUCHES THE LIVE ACCOUNT, and nothing here is Josue's. A test connected account
 * cannot move real money and cannot be used in live mode.
 */
import { loadEnv } from './_env.mjs';
import { compileServer, cleanupCompile } from '../gates/_compile.mjs';
import path from 'node:path';

const cmd = process.argv[2];
if (!['probe', 'create', 'connect'].includes(cmd)) {
  console.error('usage: stripe-chargeable-test-account.mjs probe|create|connect');
  process.exit(2);
}
loadEnv();

const build = compileServer();
const s = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));
const stripe = s.stripeFor('test');

// A guard, not a comment: a live key here would be creating a real connected account.
const keyMode = (process.env.STRIPE_SECRET_KEY_TEST ?? '').startsWith('sk_test_') ? 'test' : 'unknown';
if (keyMode !== 'test') {
  console.error('refusing: STRIPE_SECRET_KEY_TEST is not an sk_test_ key. This script is test-mode only.');
  process.exit(3);
}

const show = (label, e) => {
  const raw = e?.raw ?? e;
  console.log(`  ${label}: ${raw?.type ?? e?.name ?? 'error'} / ${raw?.code ?? '-'} — ${raw?.message ?? e?.message}`);
};

try {
  if (cmd === 'probe') {
    console.log('Testing the recorded claim that Accounts v1 creation is refused for this platform.\n');
    try {
      const acct = await stripe.accounts.create({
        country: 'US',
        controller: {
          losses: { payments: 'application' },
          fees: { payer: 'application' },
          stripe_dashboard: { type: 'none' },
          requirement_collection: 'application',
        },
        business_type: 'individual',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      console.log(`  V1 CREATE SUCCEEDED: ${acct.id}`);
      console.log('  The recorded blocker is wrong: the documented v1 recipe is available.');
      console.log(`  charges_enabled=${acct.charges_enabled}  currently_due=${acct.requirements?.currently_due?.length ?? '?'}`);
      console.log(`\n  (created a throwaway test account: ${acct.id} — it holds nothing and costs nothing)`);
    } catch (e) {
      show('V1 CREATE REFUSED', e);
      console.log('  So the documented v1 recipe is genuinely unavailable and the v2 path is the only one.');
    }
    process.exit(0);
  }

  if (cmd === 'create') {
    // The documented v1 recipe, end to end, with Stripe's own published test values.
    const acct = await stripe.accounts.create({
      country: 'US',
      controller: {
        losses: { payments: 'application' },
        fees: { payer: 'application' },
        stripe_dashboard: { type: 'none' },
        requirement_collection: 'application',
      },
      business_type: 'individual',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      external_account: 'btok_us',                       // Stripe's tokenised test bank account
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '8.8.8.8' },
      business_profile: { mcc: '7349', url: 'https://scoopdogg.net', product_description: 'Weekly dog waste removal' },
      individual: {
        first_name: 'Test', last_name: 'Scooper',
        email: 'scoopdogg-test-fixture@example.com',
        phone: '8888675309',
        dob: { day: 1, month: 1, year: 1901 },           // Stripe's published passing DOB
        id_number: '000000000',                           // Stripe's published passing SSN
        ssn_last_4: '0000',
        address: { line1: 'address_full_match', city: 'Ventura', state: 'CA', postal_code: '93001', country: 'US' },
      },
    });
    console.log(`  created ${acct.id}`);
    const fresh = await stripe.accounts.retrieve(acct.id);
    console.log(`  charges_enabled=${fresh.charges_enabled}  card_payments=${fresh.capabilities?.card_payments}`);
    console.log(`  currently_due: ${JSON.stringify(fresh.requirements?.currently_due ?? [])}`);
    console.log(`\n  to use it:  node scripts/stripe-chargeable-test-account.mjs connect ${acct.id}`);
    process.exit(fresh.charges_enabled ? 0 : 1);
  }

  if (cmd === 'connect') {
    const id = process.argv[3];
    if (!id?.startsWith('acct_')) { console.error('usage: connect <acct_...>'); process.exit(2); }
    const acct = await stripe.accounts.retrieve(id);
    if (!acct.charges_enabled) { console.error(`refusing: ${id} is not charges_enabled`); process.exit(1); }
    const { rows: before } = await db().query(`select account_id from stripe_connection where livemode = false`);
    await db().query(
      `update stripe_connection set account_id = $1, connected_at = now(), connected_by = 'amtech-test-fixture',
              display_name = 'Scoop Dogg (chargeable test account)', updated_at = now()
        where livemode = false`, [id]);
    console.log(`  test connection: ${before[0]?.account_id ?? 'none'} -> ${id}`);
    console.log(`  ${JSON.stringify(await s.probeV1Account('test'))}`);
  }
} finally {
  cleanupCompile();
}
