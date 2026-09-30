/**
 * The admin runs the business: a custom job moves through every stage, a cash or Venmo payment is
 * written down and settles what it pays, and none of it touches AMTECH's fee report.
 *
 *   node gates/business.mjs
 *
 * Through server/lib/business.ts with this gate's own client inside a transaction that is always
 * rolled back. It makes one customer, one lead and one approved quote of its own, so it never
 * depends on — or disturbs — a real job.
 *
 *   deposit_due -> (deposit paid) to_schedule -> (a day booked) scheduled -> (done) balance_owed
 *   -> (cash covering the balance) done, with balance_paid_at written
 *
 * The stage is derived from dates, so each step is checked by reading the list back, not by
 * trusting the writer's return value. Every rule has a negative control.
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
const refuses = async (fn, code) => {
  try { await fn(); return { refused: false, code: null }; }
  catch (e) { return { refused: e?.code === code, code: e?.code ?? e?.message }; }
};

const out = compileServer();
const B = await import(path.resolve(out, 'server/lib/business.js'));
const { db } = await import(path.resolve(out, 'server/lib/db.js'));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const BY = 'gate+business@example.invalid';
const STAMP = Date.now().toString().slice(-7);

const stageOf = async (id) => (await B.listJobs(c)).jobs.find((j) => j.id === id);
const feeReport = async () => (await c.query(
  `select coalesce(sum(amount_cents), 0)::int as collected, coalesce(sum(platform_fee_cents), 0)::int as fee
     from payments where state = 'succeeded' and kind in ('charge', 'deposit', 'refund')`)).rows[0];  // growth.ts's own filter

try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');
  const { rows: [cu] } = await c.query(`insert into customers (name, phone, email) values ($1, $2, 'gate-business@example.invalid') returning id`, [`DEMO—Gate business ${STAMP}`, `80555${STAMP.slice(-5)}`]);
  const { rows: [ld] } = await c.query(`insert into leads (id, name, phone, email, city, customer_id, kind, created_at) values (gen_random_uuid(), $1, $2, 'gate-business@example.invalid', 'Ventura', $3, 'custom', now()) returning id`, [`DEMO—Gate business ${STAMP}`, `80555${STAMP.slice(-5)}`, cu.id]);
  const { rows: [qt] } = await c.query(
    `insert into quotes (lead_id, customer_id, state, title, total_cents, deposit_mode, deposit_percent, deposit_cents, accepted_at, created_by)
     values ($1, $2, 'accepted', 'Gate turf job', 60000, 'percent', 25, 15000, now(), $3) returning id, number`, [ld.id, cu.id, BY]);

  console.log('A. a job, stage by stage');
  check((await stageOf(qt.id))?.stage === 'deposit_due', 'approved with a deposit asked for and unpaid: waiting on the deposit');
  check((await refuses(() => B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 100, method: 'cash', quote_id: '00000000-0000-0000-0000-000000000000' }, BY), 'wrong_job')).refused,
    'NEGATIVE CONTROL: a payment against a job that is not this customer\'s is refused');
  await c.query(`update quotes set deposit_paid_at = now() where id = $1`, [qt.id]);
  check((await stageOf(qt.id))?.stage === 'to_schedule', 'deposit paid and no day: to schedule');
  check((await refuses(() => B.scheduleJob(c, qt.id, 'next tuesday', BY), 'bad_date')).refused, 'a day that is not a date is refused');
  const booked = await B.scheduleJob(c, qt.id, '2026-10-06', BY);
  check(booked.stage === 'scheduled' && booked.scheduled_for === '2026-10-06', 'a day booked: on the calendar', booked.scheduled_for);
  const wk = await B.week(c, '2026-10-05');
  check(wk.days.length === 7 && wk.days.find((d) => d.day === '2026-10-06')?.jobs.some((j) => j.id === qt.id), 'the booked job is on that day of the week view');
  await c.query(`update quotes set completed_at = now() where id = $1`, [qt.id]);
  const owed = await stageOf(qt.id);
  check(owed.stage === 'balance_owed' && owed.owed_cents === 45000, 'done with money still owed: balance owed, and the amount is total less deposit', `$${owed.owed_cents / 100}`);
  check((await refuses(() => B.scheduleJob(c, qt.id, '2026-10-07', BY), 'done')).refused, 'a finished job cannot be moved to another day');

  console.log('\nB. cash and Venmo');
  const before = await feeReport();
  check((await refuses(() => B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 0, method: 'cash' }, BY), 'bad_amount')).refused, 'a payment of nothing is refused');
  check((await refuses(() => B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 1000, method: 'bitcoin' }, BY), 'bad_method')).refused, 'a method that is not cash, Venmo, Zelle, check or other is refused');
  const part = await B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 20000, method: 'venmo', note: '@gate', quote_id: qt.id }, BY);
  check(part.kind === 'manual' && part.platform_fee_cents === 0 && part.method === 'venmo' && part.recorded_by === BY && part.quote_id === qt.id,
    'a Venmo payment is written as manual, no fee, with how, who, and which job');
  const partial = await stageOf(qt.id);
  check(partial.stage === 'balance_owed' && partial.owed_cents === 25000, 'part of the balance: still owed, less what was paid', `$${partial.owed_cents / 100}`);
  await B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 25000, method: 'cash', quote_id: qt.id, paid_on: '2026-10-06' }, BY);
  const done = await stageOf(qt.id);
  const { rows: [q2] } = await c.query(`select balance_paid_at from quotes where id = $1`, [qt.id]);
  check(done.stage === 'done' && done.owed_cents === 0 && !!q2.balance_paid_at, 'the rest in cash: done and paid, and the quote records the balance as paid');
  const after = await feeReport();
  check(after.collected === before.collected && after.fee === before.fee, 'the fee report did not move: cash and Venmo carry no AMTECH fee', `collected ${before.collected}->${after.collected}, fee ${before.fee}->${after.fee}`);

  const { rows: [inv] } = await c.query(
    `insert into invoices (customer_id, subtotal_cents, total_cents, state, issued_at, collection_method) values ($1, 3000, 3000, 'open', now(), 'send_invoice') returning id`, [cu.id]);
  await B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 1000, method: 'check', invoice_id: inv.id }, BY);
  check((await c.query(`select state from invoices where id = $1`, [inv.id])).rows[0].state === 'open', 'NEGATIVE CONTROL: a check for part of an invoice leaves it open');
  await B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 2000, method: 'check', invoice_id: inv.id }, BY);
  const { rows: [inv2] } = await c.query(`select state, collection_method from invoices where id = $1`, [inv.id]);
  check(inv2.state === 'paid' && inv2.collection_method === 'offline', 'the rest settles it: paid, and marked as paid by hand');
  check((await refuses(() => B.recordManualPayment(c, { customer_id: cu.id, amount_cents: 100, method: 'cash', invoice_id: inv.id }, BY), 'invoice_not_open')).refused, 'a paid invoice takes no more payments');
  const byState = await B.invoicesByState(c);
  check(typeof byState.counts.open === 'number' && byState.invoices.every((i) => !i.name.startsWith('DEMO—')), 'invoices by state leave out the DEMO customers', `${byState.invoices.length} invoices`);

  console.log('\nC. one customer, everything');
  const detail = await B.customerDetail(c, cu.id);
  check(detail.customer.id === cu.id && detail.jobs.length === 1 && detail.payments.length === 4 && detail.invoices.length === 1,
    'the customer page holds their job, every payment and their invoice', `${detail.jobs.length} job, ${detail.payments.length} payments, ${detail.invoices.length} invoice`);
  // 480 = the four payment rows this gate wrote. The deposit was marked paid by date only (no Stripe row
  // in a rolled-back transaction), so it is not a payment and must not be counted as one.
  check(detail.totals.paid_cents === 48000, 'and what they have paid in all, from the payment rows', `$${detail.totals.paid_cents / 100}`);
  check((await refuses(() => B.customerDetail(c, 'not-a-uuid'), 'not_found')).refused, 'NEGATIVE CONTROL: a made-up id is "no such customer", not a database error');
  const { rows: [real] } = await c.query(`select id from customers where deleted_at is null and name not like 'DEMO—%' order by created_at limit 1`);
  if (real) {
    const d = await B.customerDetail(c, real.id);
    check(Array.isArray(d.subscriptions) && Array.isArray(d.photos) && d.photos.every((p) => p.url.startsWith('/api/photo/')), 'a real customer\'s page reads without error, photos served by the photo route');
  }
  const { rows: [v] } = await c.query(`select id from visits order by scheduled_for desc limit 1`);
  if (v) check((await B.visitDetail(c, v.id)).visit.id === v.id, 'a visit opens with its customer and property');
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  await db().end().catch(() => {});
  cleanupCompile(out);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
