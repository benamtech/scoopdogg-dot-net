/**
 * A card on file reaches the table, and the expiry warning finds it.
 *
 *   node gates/card-on-file.mjs              # real Stripe test-mode card if the account allows
 *   node gates/card-on-file.mjs --static     # the shape only, no Stripe call
 *
 * THE FAULT THIS EXISTS FOR. `payment_methods` has been in the schema since migration 005 and
 * held ZERO rows on 2026-09-23. The only `insert into payment_methods` in the repository was in
 * `gates/lead-comms.mjs`, which plants a card, asks `cardsExpiringSoon()` to find it, and rolls
 * back — so a green check covered a message that has never been able to send. Two things were
 * missing at once and each hid the other: no writer in shipped code, and no `payment_method.*`
 * subscription on the webhook endpoint, so even a writer would never have been called.
 *
 * SO THIS GATE CHECKS THE WRITER AND ITS TRIGGER TOGETHER, and neither half is retyped here:
 * `CARD_EVENTS` is read out of `server/lib/cards.ts` and both the endpoint's subscription list
 * and the webhook's dispatch are resolved against it. A handler with no subscription is a feature
 * that silently does not exist; a subscription with no handler is a retry queue of 200s.
 *
 * AND IT DOES NOT PLANT THE ROW IT CHECKS. Everything below goes in through
 * `handleCardEvent()` — the same function `api/stripe-webhook.ts` calls — with a PaymentMethod
 * Stripe produced. If this gate inserted the card itself it would be the exact defect it exists
 * to catch, and `gates/writers-outside-gates.mjs` would say so.
 *
 * TWO HONEST OUTCOMES, printed in the verdict rather than buried:
 *   PASS(live)    a real test-mode PaymentMethod was created on the connected account and fed in
 *   PASS(static)  Stripe was not reachable in test mode, so the object is the documented shape
 *                 and the Stripe half is reported as not exercised
 *
 * IT MOVES NO MONEY AND SENDS NO MAIL. It creates a test-mode card and deletes it, and every
 * database row it touches is inside one transaction that is always rolled back.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const staticOnly = process.argv.includes('--static');
const cardsTs = readFileSync('server/lib/cards.ts', 'utf8');
const webhook = readFileSync('api/stripe-webhook.ts', 'utf8');
const register = readFileSync('scripts/register-webhook.mjs', 'utf8');

// ---- A. the writer and its trigger are one list --------------------------------------------
console.log('A. the writer and its trigger name the same events');
const CARD_EVENTS = [...cardsTs.slice(cardsTs.indexOf('export const CARD_EVENTS'), cardsTs.indexOf('] as const'))
  .matchAll(/'(payment_method\.[a-z_]+)'/g)].map((m) => m[1]);
check(CARD_EVENTS.length >= 3, 'CARD_EVENTS was read from server/lib/cards.ts', CARD_EVENTS.join(', '));

const registered = [...register.slice(register.indexOf('const EVENTS = ['), register.indexOf('];', register.indexOf('const EVENTS = [')))
  .matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]);
const notSubscribed = CARD_EVENTS.filter((e) => !registered.includes(e));
check(notSubscribed.length === 0, 'every card event the code handles is one the endpoint subscribes to',
  notSubscribed.length ? `${notSubscribed.join(', ')} would never arrive` : `${registered.length} events on the endpoint`);

check(/CARD_EVENTS as readonly string\[\]\)\.includes\(event\.type\)/.test(webhook)
  && /await handleCardEvent\(event, mode\)/.test(webhook),
  'the webhook dispatches on that constant rather than on a second list',
  'one list, two readers');

// The other direction: an event subscribed and handled nowhere is a queue of 200s. Every literal
// event type the webhook branches on must be on the endpoint too.
const handled = [...webhook.matchAll(/event\.type === '([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]);
const unsubscribed = [...new Set(handled)].filter((e) => !registered.includes(e));
check(unsubscribed.length === 0, 'every event the webhook branches on is subscribed',
  unsubscribed.length ? unsubscribed.join(', ') : `${new Set(handled).size} literal branches`);

const unhandled = registered.filter((e) => !handled.includes(e) && !CARD_EVENTS.includes(e));
check(unhandled.length === 0, 'every event the endpoint subscribes to is handled',
  unhandled.length ? `${unhandled.join(', ')} would arrive and do nothing` : 'no dead subscriptions');

// ---- B. the shipped writer, a real card, and the sweep that reads it ------------------------
console.log('\nB. the shipped writer, and cardsExpiringSoon() reading what it wrote');
const out = compileServer();
const mod = (f) => import(`${process.cwd()}/${out}/server/lib/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const { handleCardEvent, recordCard, detachCard, markDefaultCard } = await mod('cards.js');
const { cardsExpiringSoon } = await mod('comms.js');

/**
 * A PaymentMethod, from Stripe when Stripe will give us one.
 *
 * `tok_visa` is Stripe's own test token and `pm_card_visa` its test PaymentMethod; creating from
 * the token produces a real object with a real brand, last4 and expiry that we did not choose.
 * That matters: a fixture we wrote would agree with our own reader by construction, which is the
 * shape this whole gate exists to refuse.
 */
const soon = new Date(); soon.setMonth(soon.getMonth() + 1);
let live = false;
let pm = {
  id: 'pm_static_fixture', object: 'payment_method', type: 'card', customer: null,
  card: { brand: 'visa', last4: '4242', exp_month: soon.getMonth() + 1, exp_year: soon.getFullYear() },
};
let stripeNote = 'not attempted (--static)';
let cleanup = null;
if (!staticOnly) {
  try {
    const { stripeFor, resolve } = await mod('stripe.js');
    const { account } = await resolve('test');
    const s = stripeFor('test');
    // A Customer first: Stripe refuses to update a PaymentMethod that is not saved to one
    // ("You must save this PaymentMethod to a customer before you can update it"), and attaching
    // is the event being modelled anyway — so the object arrives the way a real one would.
    const sc = await s.customers.create(
      { name: 'GATE card-on-file', metadata: { gate: 'card-on-file' } }, { stripeAccount: account });
    const made = await s.paymentMethods.create(
      { type: 'card', card: { token: 'tok_visa' } }, { stripeAccount: account });
    const attachedPm = await s.paymentMethods.attach(made.id, { customer: sc.id }, { stripeAccount: account });
    // The expiry Stripe gives a test card is years out; the sweep looks 60 days ahead, so the
    // card is moved to expire next month. This is a card fact changed on Stripe's object, not a
    // row edited behind the reader's back.
    const dated = await s.paymentMethods.update(
      attachedPm.id, { card: { exp_month: soon.getMonth() + 1, exp_year: soon.getFullYear() } }, { stripeAccount: account });
    pm = dated; live = true;
    cleanup = { s, account, customer: sc.id, pm: dated.id };
    stripeNote = `real test-mode ${dated.card.brand} ••${dated.card.last4}, exp ${dated.card.exp_month}/${dated.card.exp_year} on ${sc.id}`;
  } catch (e) {
    stripeNote = `Stripe test mode said: ${String(e?.message ?? e).slice(0, 160)}`;
  }
}
console.log(`  card: ${stripeNote}`);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query('begin');
  const { rows: [cust] } = await c.query(
    `insert into customers (name, email, phone) values ('GATE card-on-file','gate+card@example.invalid','8055550001') returning id`);
  const { rows: [prop] } = await c.query(
    `insert into properties (customer_id, address, city, postal_code) values ($1,'1 Gate Way','Ventura','93003') returning id`, [cust.id]);
  await c.query(
    `insert into subscriptions (customer_id, property_id, service_slug, state, monthly_price_cents, source)
     values ($1,$2,'weekly-pooper-scooper-service','active',12000,'online')`, [cust.id, prop.id]);

  const SCUST = `cus_gate_${Date.now()}`;
  await c.query(
    `insert into stripe_customers (customer_id, livemode, account_id, stripe_customer_id) values ($1,false,'acct_gate',$2)`,
    [cust.id, SCUST]);

  const mine = async () => (await cardsExpiringSoon(c)).filter((r) => r.customer_id === cust.id);
  check((await mine()).length === 0, 'before the event, the sweep finds no card for this customer',
    'or the check below would pass on somebody else’s row');

  // ── the event, through the same dispatch the endpoint uses ──────────────────────────────
  const attached = { type: 'payment_method.attached', account: 'acct_gate', data: { object: { ...pm, customer: SCUST } } };
  const r1 = await handleCardEvent(attached, 'test', c);
  check(r1.recorded && r1.action === 'attached', 'payment_method.attached writes the card', JSON.stringify(r1));

  const found = await mine();
  check(found.length === 1, 'and cardsExpiringSoon() returns it — the warning can fire at last',
    found.length ? `${found[0].brand} ••${found[0].last4}, exp ${found[0].exp_month}/${found[0].exp_year}` : 'not found');
  check(found.length === 1 && String(found[0].last4) === String(pm.card.last4)
    && Number(found[0].exp_year) === Number(pm.card.exp_year),
    'the row carries the card Stripe reported, not one we chose',
    `expected ••${pm.card.last4} ${pm.card.exp_month}/${pm.card.exp_year}`);

  // ── replay, which Stripe will do ────────────────────────────────────────────────────────
  const r2 = await handleCardEvent(attached, 'test', c);
  const after = await mine();
  check(r2.recorded && r2.action === 'updated' && after.length === 1,
    'the same event twice leaves ONE card, not two', 'Stripe retries; the unique index is on stripe_pm_id');

  // ── the network reissues the card: this is what keeps the expiry honest ─────────────────
  const next = new Date(); next.setFullYear(next.getFullYear() + 3);
  await handleCardEvent({ type: 'payment_method.automatically_updated', account: 'acct_gate',
    data: { object: { ...pm, customer: SCUST, card: { ...pm.card, exp_year: next.getFullYear() } } } }, 'test', c);
  check((await mine()).length === 0, 'a reissued card with a new expiry drops out of the sweep',
    'the sweep reads our columns, so a card update that did not reach them would warn forever');

  // put it back for the remaining checks
  await handleCardEvent(attached, 'test', c);

  // ── which card the plan bills ───────────────────────────────────────────────────────────
  check(await markDefaultCard(SCUST, pm.id, c), 'the subscription’s default payment method marks the row',
    'is_default is not null default false and had no writer either');

  // ── it comes off ────────────────────────────────────────────────────────────────────────
  const r3 = await detachCard(pm.id, c);
  check(r3.recorded && r3.action === 'detached', 'payment_method.detached marks it detached', JSON.stringify(r3));
  check((await mine()).length === 0, 'and a detached card is not warned about');

  // ── negative controls: the writer must be able to say no ────────────────────────────────
  console.log('\nnegative controls');
  const unknown = await recordCard({ ...pm, id: 'pm_unknown_cust', customer: 'cus_nobody_knows' }, { mode: 'test' }, c);
  check(!unknown.recorded && /no customer of ours/.test(unknown.reason),
    'a card for a Stripe customer we do not know is refused, not guessed at', unknown.reason);

  const notACard = await recordCard({ id: 'pm_bank', type: 'us_bank_account', customer: SCUST }, { mode: 'test' }, c);
  check(!notACard.recorded, 'a payment method that is not a card is skipped and says so', notACard.reason);

  const loose = await handleCardEvent({ type: 'invoice.paid', data: { object: pm } }, 'test', c);
  check(!loose.recorded, 'the dispatcher refuses an event that is not a card event', loose.reason);

  const gone = await detachCard('pm_never_seen', c);
  check(!gone.recorded, 'detaching a card that was never on file changes nothing', gone.reason);
} finally {
  // Nothing above survives. This project has left gate rows in a client's live database before.
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  cleanupCompile();
}

// The test-mode customer and its card go too, so the account does not accumulate one per run.
// Deleting the Customer detaches the card with it; both calls are best-effort because a leftover
// test object is untidy and a gate that fails on cleanup is worse.
if (cleanup) {
  await cleanup.s.paymentMethods.detach(cleanup.pm, { stripeAccount: cleanup.account }).catch(() => {});
  await cleanup.s.customers.del(cleanup.customer, { stripeAccount: cleanup.account }).catch(() => {});
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed — Stripe half: ${live ? 'PASS(live)' : 'PASS(static)'}`);
process.exit(fail === 0 ? 0 : 1);
