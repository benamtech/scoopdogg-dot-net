/**
 * A renewal is in the books: its invoice carries the fee Stripe took, and it has a payment row.
 *
 *   node gates/renewal-books-the-fee.mjs [--static]
 *
 * THE DEFECT THIS DEFENDS AGAINST, measured 2026-09-27. The webhook wrote every renewal invoice with
 * `platform_fee_cents` as the literal 0 and wrote no `payments` row at all, so the fee report
 * (`growth.ts`, which reads `payments`) had every renewal missing — and every pay-after customer's
 * first real charge, which Stripe bills as a `subscription_cycle` invoice. Every existing gate was
 * green on it, because nothing had ever produced a renewal to look at.
 *
 * SO THIS GATE PRODUCES ONE. A Stripe test clock on the connected test account; a real Checkout
 * opened through `startSubscription()` (money.ts is the only door, and `one-money-door.mjs`
 * forbids a gate from being a second) and paid with a test card in a headless browser; the clock
 * advanced a month; the renewal Stripe then bills and pays. That invoice goes through
 * `handleInvoicePaid()` — the function the webhook calls — inside a transaction this gate rolls back.
 *
 * THE OBSERVER IS A DIFFERENT PATH. The shipped code reads the fee from the PaymentIntent. This gate
 * reads the platform's ApplicationFee object for the same charge. If they agree, the number in our
 * books is the number Stripe moved.
 *
 * `--static` skips everything that needs Stripe and a browser, and says so.
 */
import pg from 'pg';
import path from 'node:path';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = compileServer();
const p = (f) => path.resolve(out, f);
const { claimEvent, handleInvoicePaid, feeStripeTook } = await import(p('server/lib/renewals.js'));
const { growthBoard } = await import(p('server/lib/growth.js'));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query(`set lock_timeout = '5s'`);

// ─────────────────────────────────────────── A. a failed delivery is processed again
console.log('A. the webhook re-processes a delivery whose first processing failed');
try {
  await c.query('begin');
  const id = `evt_gate_${Date.now()}`;
  const ev = { id, type: 'invoice.paid', account: null, payload: { gate: true } };
  check(await claimEvent(c, ev) === 'new', 'the first delivery is new');
  await c.query(`update stripe_events set error = 'planted failure' where id = $1`, [id]);
  check(await claimEvent(c, ev) === 'retry', 'a redelivery after a failure is processed again, not dropped');
  await c.query(`update stripe_events set processed_at = now(), error = null where id = $1`, [id]);
  check(await claimEvent(c, ev) === 'duplicate', 'NEGATIVE CONTROL: a redelivery after success is a duplicate');
} finally {
  await c.query('rollback').catch(() => {});
}

// ─────────────────────────────────────────── B. a real renewal
console.log('\nB. a real renewal, from a Stripe test clock');
let outcome = 'static';
let why = process.argv.includes('--static') ? '--static' : '';
let cleanup = async () => {};
if (!why) {
  try {
    const { resolve } = await import(p('server/lib/stripe.js'));
    const { startSubscription, feePercentFor } = await import(p('server/lib/money.js'));
    const { stripe, account } = await resolve('test');
    const stamp = Date.now().toString().slice(-8);
    const now = Math.floor(Date.now() / 1000);

    const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `renewal gate ${stamp}` }, { stripeAccount: account });
    cleanup = async () => { await stripe.testHelpers.testClocks.del(clock.id, { stripeAccount: account }).catch(() => {}); };
    const cust = await stripe.customers.create(
      { name: `DEMO—renewal gate ${stamp}`, email: `gate+renewal-${stamp}@example.invalid`, test_clock: clock.id },
      { stripeAccount: account });

    const AMOUNT = 2300;
    const session = await startSubscription({
      mode: 'test',
      consentId: `gate-renewal-${stamp}`,
      customerId: cust.id,
      lineItems: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: AMOUNT, recurring: { interval: 'month' }, product_data: { name: 'DEMO—renewal gate' } } }],
      description: 'DEMO—renewal gate',
      metadata: { gate: 'renewal-books-the-fee' },
      submitMessage: 'Automated gate. Not a real customer.',
      successUrl: 'https://example.com/?renewal-gate={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://example.com/?renewal-gate-cancelled',
      idempotencyKey: `renewal-gate-${stamp}`,
    });

    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(session.url, { waitUntil: 'domcontentloaded' });
      // Checkout renders its method chooser late on a cold load; the first run of this gate timed
      // out at 20s on a page that loaded fine the second time. Wait for either shape, then choose Card.
      await page.locator('#cardNumber').or(page.getByTestId('card-accordion-item')).first().waitFor({ timeout: 45000 }).catch(() => {});
      const cardTab = page.getByTestId('card-accordion-item').or(page.getByText(/^Card$/).first());
      if (await cardTab.count().catch(() => 0)) await cardTab.first().click({ timeout: 10000 }).catch(() => {});
      await page.locator('#cardNumber').waitFor({ timeout: 30000 }).catch(async (e) => {
        await page.screenshot({ path: '/tmp/renewal-gate-checkout.png', fullPage: true }).catch(() => {});
        throw e;
      });
      await page.locator('#cardNumber').fill('4242424242424242');
      await page.locator('#cardExpiry').fill('12 / 34');
      await page.locator('#cardCvc').fill('123');
      await page.locator('#billingName').fill('Renewal Gate');
      const zip = page.locator('#billingPostalCode');
      if (await zip.count()) await zip.fill('93001');
      const saveInfo = page.locator('#enableStripePass');
      if (await saveInfo.count().catch(() => 0)) await saveInfo.uncheck({ timeout: 5000 }).catch(() => {});
      await page.locator('button[type=submit]').click();
      await page.waitForURL(/example\.com/, { timeout: 60000 });
    } finally {
      await browser.close();
    }

    let s = null;
    for (let i = 0; i < 20; i++) {
      s = await stripe.checkout.sessions.retrieve(session.id, { expand: ['subscription'] }, { stripeAccount: account });
      if (s.status === 'complete' && s.subscription) break;
      await sleep(1500);
    }
    const sub = s?.subscription;
    check(!!sub && typeof sub === 'object', 'the Checkout became a subscription on the test clock', sub?.id ?? 'none');

    // A month and a day, then as long as Stripe needs to finalise and pay the draft.
    const advanceTo = async (t) => {
      await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: t }, { stripeAccount: account });
      for (let i = 0; i < 90; i++) {
        const k = await stripe.testHelpers.testClocks.retrieve(clock.id, {}, { stripeAccount: account });
        if (k.status === 'ready') return;
        await sleep(2000);
      }
      throw new Error('test clock did not become ready in 180s');
    };
    const renewalInvoice = async () => (await stripe.invoices.list({ subscription: sub.id, limit: 10 }, { stripeAccount: account }))
      .data.find((i) => i.billing_reason === 'subscription_cycle');
    let t = now + 32 * 86400;
    await advanceTo(t);
    let inv = await renewalInvoice();
    for (let i = 0; i < 3 && inv?.status !== 'paid'; i++) {
      t += 3 * 3600;
      await advanceTo(t);
      inv = await renewalInvoice();
    }
    check(inv?.status === 'paid', 'Stripe billed and paid a renewal', inv ? `${inv.id} ${inv.status} $${(inv.amount_paid / 100).toFixed(2)}` : 'no subscription_cycle invoice');
    const first = (await stripe.invoices.list({ subscription: sub.id, limit: 10 }, { stripeAccount: account }))
      .data.find((i) => i.billing_reason === 'subscription_create');

    // The independent observer: the platform's ApplicationFee for the renewal's charge.
    const reading = await feeStripeTook(stripe, account, inv.id);
    const af = reading.chargeId ? (await stripe.applicationFees.list({ charge: reading.chargeId, limit: 1 })).data[0] : null;
    const pct = await feePercentFor('test');
    const expected = Math.round(inv.amount_paid * pct / 100);
    check(!!af && af.amount === reading.feeCents, 'the fee we read equals the ApplicationFee Stripe recorded',
      `ours ${reading.feeCents}¢, Stripe's ${af?.amount ?? 'none'}¢`);
    check(reading.feeCents > 0 && Math.abs(reading.feeCents - expected) <= 1, 'NEGATIVE CONTROL: the fee is the configured percentage, not zero',
      `${reading.feeCents}¢ on ${inv.amount_paid}¢ at ${pct}% (expected ${expected}¢)`);

    // ─── the books, through the function the webhook calls, in a transaction rolled back
    try {
      await c.query('begin');
      const { rows: [cu] } = await c.query(
        `insert into customers (name, phone, email) values ($1,$2,$3) returning id`,
        [`DEMO—renewal gate ${stamp}`, `+1555${stamp}`, `gate+renewal-${stamp}@example.invalid`]);
      const { rows: [pr] } = await c.query(
        `insert into properties (customer_id, address, city) values ($1,'1 Gate St','Ventura') returning id`, [cu.id]);
      const { rows: [su] } = await c.query(
        `insert into subscriptions (customer_id, property_id, service_slug, state, frequency, stripe_subscription_id, livemode, account_id)
         values ($1,$2,'weekly-pooper-scooper-service','active','weekly',$3,false,$4) returning id`, [cu.id, pr.id, sub.id, account]);
      const before = await growthBoard(c);
      const feeBefore = before.money?.platform_fee_this_month_cents?.value ?? before.fees_by_month?.[0]?.fee_cents ?? 0;

      const r1 = await handleInvoicePaid(c, stripe, { mode: 'test', account, invoice: inv });
      check(r1.recorded, 'the webhook branch records the renewal', r1.reason ?? `fee ${r1.feeCents}¢`);
      const { rows: invRows } = await c.query(`select platform_fee_cents, total_cents from invoices where stripe_invoice_id = $1`, [inv.id]);
      check(invRows.length === 1 && invRows[0].platform_fee_cents === af?.amount,
        'the invoice row carries the fee Stripe took', `${invRows[0]?.platform_fee_cents}¢`);
      const { rows: payRows } = await c.query(
        `select kind, amount_cents, platform_fee_cents, state from payments where stripe_payment_id = $1`, [inv.id]);
      check(payRows.length === 1 && payRows[0].kind === 'charge' && payRows[0].state === 'succeeded'
        && payRows[0].amount_cents === inv.amount_paid && payRows[0].platform_fee_cents === af?.amount,
        'the renewal has a payment row, with the amount and the fee', JSON.stringify(payRows[0] ?? null));

      const after = await growthBoard(c);
      const month = new Date().toISOString().slice(0, 7);
      const row = (after.fees_by_month ?? []).find((m) => m.period === month);
      const rowBefore = (before.fees_by_month ?? []).find((m) => m.period === month);
      check(row && (row.fee_cents - (rowBefore?.fee_cents ?? 0)) === af?.amount,
        "the accountant's fee report now includes it", `this month's fee moved by ${(row?.fee_cents ?? 0) - (rowBefore?.fee_cents ?? 0)}¢`);
      void feeBefore;

      const r2 = await handleInvoicePaid(c, stripe, { mode: 'test', account, invoice: inv });
      const { rows: [{ n: nInv }] } = await c.query(`select count(*)::int as n from invoices where stripe_invoice_id = $1`, [inv.id]);
      const { rows: [{ n: nPay }] } = await c.query(`select count(*)::int as n from payments where stripe_payment_id = $1`, [inv.id]);
      check(r2.recorded && nInv === 1 && nPay === 1, 'a second delivery adds nothing', `${nInv} invoice, ${nPay} payment`);

      if (first) {
        const r0 = await handleInvoicePaid(c, stripe, { mode: 'test', account, invoice: first });
        check(!r0.recorded, 'NEGATIVE CONTROL: the first invoice is left to completeBooking, not booked twice', r0.reason);
      }
    } finally {
      await c.query('rollback').catch(() => {});
    }
    outcome = 'live';
  } catch (e) {
    why = (e?.message ?? String(e)).split('\n')[0].slice(0, 240);
    no('the live renewal ran to the end', why);
  } finally {
    await cleanup();
  }
}

await c.end();
cleanupCompile();
if (outcome === 'static') console.log(`\n  NOT MEASURED LIVE: ${why}`);
console.log(`\n${fail ? 'FAIL' : `PASS(${outcome})`} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
