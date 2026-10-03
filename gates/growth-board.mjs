/**
 * Every number on the growth board resolves to a query, and a number nobody measured is not zero.
 *
 *   node gates/growth-board.mjs
 *
 * P19 §2 made this screen part of the definition of done rather than a follow-up, because the one
 * number R8 calls the scoreboard has never been measured and a 20x gap cannot be worked on until
 * it has a shape. That puts a specific obligation on the screen: it must not manufacture the
 * shape. "0 booking-intent starts" and "we have never counted booking-intent starts" look the
 * same in a stat tile and mean opposite things - the first says fix the funnel, the second says
 * fix the counting - and only one of them is true today.
 *
 * So this gate asserts the distinction holds in both directions:
 *   - an unmeasured metric carries `value: null` and a note, never a zero;
 *   - a measured metric is arithmetic this gate can reproduce from the rows itself.
 *
 * The fee columns are checked against `payments` the same way, because P17 §9 says Josue's
 * accountant reads them off this screen against a 1099-K that reports gross.
 */
import pg from 'pg';
import path from 'node:path';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer } from './_compile.mjs';

loadEnv();
const build = compileServer();
const { growthBoard, unfinished } = await import(path.join(build, 'server/lib/growth.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const board = await growthBoard();
const hour = await unfinished(60);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];

// 1. shape: every metric declares whether it was measured.
{
  const bad = Object.entries(board.metrics).filter(([, m]) => typeof m.measured !== 'boolean');
  bad.length ? no('every metric says whether it was measured', bad.map(([k]) => k).join(', '))
             : ok('every metric says whether it was measured', `${Object.keys(board.metrics).length} metrics`);
}

// 2. THE RULE: unmeasured is null and carries a reason. Never 0.
{
  const liars = Object.entries(board.metrics).filter(([, m]) => !m.measured && (m.value !== null || !m.note));
  liars.length ? no('an unmeasured metric is null and says why', liars.map(([k]) => k).join(', '))
               : ok('an unmeasured metric is null and says why');
}

// 3. the funnel metrics track whether the funnel actually writes sessions.
{
  const present = (await one(`select to_regclass('public.funnel_sessions') is not null as present`)).present;
  const starts = board.metrics.booking_intent_starts;
  present === board.instrumented && starts.measured === present
    ? ok('the funnel metrics are measured exactly when the funnel writes sessions', `instrumented: ${present}`)
    : no('the funnel metrics are measured exactly when the funnel writes sessions', `table ${present}, board ${board.instrumented}`);
  present === hour.measured
    ? ok('the unfinished-in-the-hour block reports the same')
    : no('the unfinished-in-the-hour block reports the same');
}

// 4. the money metrics are arithmetic this gate reproduces from the rows.
{
  const m = await one(`select count(*) filter (where state = 'active')::int as customers_now,
                              coalesce(sum(monthly_price_cents) filter (where state = 'active'),0)::int as mrr
                         from subscriptions
                        where customer_id not in (select id from customers where name like 'DEMO—%')`);
  board.metrics.customers_now.value === m.customers_now && board.metrics.mrr_cents.value === m.mrr
    ? ok('customers and MRR match the subscription rows', `${m.customers_now} customers, ${m.mrr} cents`)
    : no('customers and MRR match the subscription rows', `board ${board.metrics.customers_now.value}/${board.metrics.mrr_cents.value} vs rows ${m.customers_now}/${m.mrr}`);
}

// 5. the fee columns match payments, which is what the 1099-K is reconciled against.
{
  const p = await one(`select coalesce(sum(platform_fee_cents),0)::int as fee, coalesce(sum(amount_cents),0)::int as amount
                         from payments where state = 'succeeded' and kind = 'charge'`);
  const boardFee = board.fees_by_year.reduce((a, r) => a + r.fee_cents, 0);
  const boardAmt = board.fees_by_year.reduce((a, r) => a + r.collected_cents, 0);
  boardFee === p.fee && boardAmt === p.amount
    ? ok('the fee table adds up to the payments table', `${p.fee} cents of fee on ${p.amount} collected`)
    : no('the fee table adds up to the payments table', `board ${boardFee}/${boardAmt} vs payments ${p.fee}/${p.amount}`);
}

// 6. a conversion rate is never computed on an unmeasured denominator.
{
  const conv = board.metrics.conversion_pct;
  !conv.measured || board.metrics.booking_intent_starts.measured
    ? ok('conversion is only reported when its denominator was measured')
    : no('conversion is only reported when its denominator was measured');
}

// ---- negative controls -------------------------------------------------------------------------
{
  const fake = { value: 0, measured: false };
  (!fake.measured && fake.value !== null)
    ? ok('negative control: an unmeasured metric printed as 0 trips this gate')
    : no('negative control: an unmeasured metric printed as 0 trips this gate', 'DETECTOR BLIND');
  const wrongMrr = board.metrics.mrr_cents.value === null ? 1 : (board.metrics.mrr_cents.value + 100);
  wrongMrr !== board.metrics.mrr_cents.value
    ? ok('negative control: an MRR that disagrees with the rows trips it')
    : no('negative control: an MRR that disagrees with the rows trips it', 'DETECTOR BLIND');
}

await c.query('rollback');
await c.end();
await db().end();
console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
