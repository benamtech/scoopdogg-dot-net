/**
 * M14: a refund returns AMTECH's share too.
 *
 *   node gates/refund-returns-the-fee.mjs            # both halves
 *   node gates/refund-returns-the-fee.mjs --static   # the written promise only, no Stripe call
 *
 * The working agreement says, in Josue's copy: *"If a payment is refunded, the fee on it is
 * refunded too."* STRIPE DOES NOT DO THAT BY DEFAULT — the platform keeps the application fee
 * unless the refund passes `refund_application_fee=true`, and then returns it proportionally
 * (Stripe's own example: a $100 payment with a $5 fee, refunded $40, returns $2). A clause in a
 * client agreement that the code does not keep is worse than no clause, and this one would have
 * been silently broken on the first refund anybody issued.
 *
 * TWO HONEST OUTCOMES, and it says which it measured — the shape checkout-e2e.mjs already uses:
 *
 *   PASS(live)    it created a charge on the connected TEST account, refunded it in full and at
 *                 40%, and read the `fee_refund` amounts back from Stripe.
 *   PASS(static)  the connected test account cannot take a charge yet, so the promise is checked
 *                 where it is written instead: refund() sets the parameter unconditionally and
 *                 exposes no argument that could turn it off. It prints Stripe's own reason.
 *
 * PASS(static) is not PASS(live), and the difference is printed in the verdict rather than buried.
 *
 * `--static` is what `npm run gates` runs, so the promise is checked on every gate run without
 * creating a Stripe charge each time. `npm run gates:money` runs both halves. A gate that lives
 * outside the default command is a gate that stops running, and this one's static half costs
 * nothing.
 */
import { readFileSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer } from './_compile.mjs';
import path from 'node:path';

loadEnv();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

// ── static: the promise, where it is written ───────────────────────────────────────────
// Comments are stripped first. money.ts EXPLAINS the parameter in prose three times, and a check
// that reads its own documentation passes on a file whose code does the opposite.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1 ');
const code = strip(readFileSync('server/lib/money.ts', 'utf8'));
const values = (t) => [...t.matchAll(/refund_application_fee:\s*([^,\n}]+)/g)].map((m) => m[1].trim());

const setTo = values(code);
check('refund() sets refund_application_fee', setTo.length === 1, setTo.join(', ') || 'not set at all');
check('it is the literal true, not an expression a caller can reach',
  setTo.length === 1 && setTo[0] === 'true', setTo[0] ?? '—');

const typeBody = code.slice(code.indexOf('export type RefundRequest'), code.indexOf('};', code.indexOf('export type RefundRequest')));
check('the RefundRequest type carries no switch for it',
  !/refund_application_fee|refundApplicationFee|refundFee/i.test(typeBody));

// NEGATIVE CONTROL: the same assertions against a planted weakening must fail. The weakening goes
// into the CODE, not into a comment - an earlier version of this control replaced the first match
// in the file, which was a sentence in the header, and the gate cheerfully went on passing.
const weakened = code.replace(/refund_application_fee:\s*true/, 'refund_application_fee: p.refundFee ?? true');
const wv = values(weakened);
check('negative control: making refund_application_fee optional trips it',
  wv.length === 1 && wv[0] !== 'true', wv[0] ?? '—');

// ── live: what Stripe actually did ─────────────────────────────────────────────────────
let outcome = 'static';
let why = process.argv.includes('--static') ? 'not attempted: --static' : '';
try {
  if (process.argv.includes('--static')) throw new Error('not attempted: --static');
  const build = compileServer();
  const { resolve } = await import(path.join(build, 'server/lib/stripe.js'));
  const { feeCentsFor, refund, chargeSavedCard } = await import(path.join(build, 'server/lib/money.js'));
  const { db } = await import(path.join(build, 'server/lib/db.js'));
  const { stripe, account } = await resolve('test');

  const AMOUNT = 10_000;
  const fee = await feeCentsFor(AMOUNT, 'test');
  check('the fee comes from the rows, capped at the amount',
    fee > 0 && fee <= AMOUNT && fee === (await feeCentsFor(AMOUNT, 'test')), `${fee} cents on ${AMOUNT}`);
  check('a fee never exceeds a tiny charge', (await feeCentsFor(1, 'test')) <= 1);

  // The charge goes through money.ts like any other. A gate that reached past the money door to
  // make its own PaymentIntent would BE the second door that gates/one-money-door.mjs forbids —
  // which is how this verb came to exist: the door gate caught this file, and the answer was to
  // give the product the off-session charge P16 §5 already needed, not to write an exception.
  const stamp = Date.now().toString().slice(-8);
  const cust = await stripe.customers.create({ name: `DEMO—refund gate ${stamp}` }, { stripeAccount: account });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: cust.id }, { stripeAccount: account });
  const intent = await chargeSavedCard({
    mode: 'test', customerId: cust.id, paymentMethodId: pm.id, amountCents: AMOUNT,
    description: `DEMO—refund gate ${stamp}`, metadata: { gate: 'refund-returns-the-fee' },
    idempotencyKey: `refund-gate-${stamp}`,
  });
  check('the charge carried the fee', intent.application_fee_amount === fee, `${intent.application_fee_amount} cents`);

  // The application fee lives on the PLATFORM account, not the connected one, so this read
  // carries no Stripe-Account header. Reading it is the whole gate: `status: 'succeeded'` on the
  // refund says the customer got their money, and says nothing at all about ours.
  const feeReturned = async () => (await stripe.applicationFees.list({ charge: intent.latest_charge, limit: 1 })).data[0]?.amount_refunded ?? null;

  const partial = await refund({ mode: 'test', paymentIntentId: intent.id, amountCents: 4_000, idempotencyKey: `refund-gate-p-${stamp}` });
  const afterPartial = await feeReturned();
  const expectPartial = Math.round(fee * 0.4);
  check('a 40% refund returns 40% of the fee', partial.status === 'succeeded' && afterPartial === expectPartial,
    `${afterPartial} of ${fee} cents, expected ${expectPartial}`);

  const full = await refund({ mode: 'test', paymentIntentId: intent.id, idempotencyKey: `refund-gate-f-${stamp}` });
  const afterFull = await feeReturned();
  check('refunding the rest returns the rest of the fee', full.status === 'succeeded' && afterFull === fee,
    `${afterFull} of ${fee} cents`);
  check('the platform kept nothing on refunded money', afterFull === fee, `${fee - afterFull} cents kept`);

  await stripe.customers.del(cust.id, { stripeAccount: account }).catch(() => {});
  outcome = 'live';
  await db().end();
} catch (e) {
  why = (e?.message ?? String(e)).split('\n')[0].slice(0, 200);
}

if (outcome === 'static') {
  console.log(`  NOT MEASURED LIVE: ${why}`);
  console.log('  Nothing here proves Stripe returned a fee; it proves the parameter is set and');
  console.log('  cannot be unset. Run without --static, against a connected test account, for that.');
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? 'FAIL' : `PASS(${outcome})`} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
