/**
 * The three loops of P16 §7 each have a sender, a trigger, and a reason they cannot fire twice.
 *
 *   node gates/lead-comms.mjs
 *
 * Loop 1 is speed to lead (`unfinished()` in growth.ts, a prefilled `sms:` link on the admin).
 * Loop 2 is the lifecycle messages and loop 3 is the review request, both in `server/lib/comms.ts`.
 *
 * THE FAULT THIS GATE EXISTS FOR was found by reading the rows rather than the code. Every
 * sender in `lifecycle.ts` guards itself with `alreadySent()`, which asks
 * `payload->>'subscription_id'` — and `sendEmail()` never wrote that key. Measured across all
 * eight outbox rows in the database: ZERO carried it. So the guard returned false every time and
 * the three California renewal notices would have been re-sent on every run, while the file's
 * own header said "EVERY NOTICE IS IDEMPOTENT ON THE OUTBOX". It had never misfired only because
 * no subscription is a year old yet.
 *
 * That is two halves of one convention living in different files — the same shape as the
 * `tsconfig.json` / `_compile.mjs` split that left the funnel dead on every deployment for nine
 * hours with twenty gates green. So check B pins the PAIR: a purpose whose once-only check reads
 * a payload key must have a sender that writes it.
 *
 * WHAT IT CHECKS
 *   A. every loop has a sender, and the sender is called from a real trigger
 *   B. the once-only pair: every guarded purpose writes the key its guard reads
 *   C. the review request fires on a settings row and on completed visits, not on a literal
 *   D. the REAL eligibility query, run against planted rows in a transaction that rolls back
 *
 * IT SENDS NO EMAIL. Check D calls the exported selectors, never the senders, so this can run on
 * any box at any time. `npm run gates:SENDS-REAL-EMAIL` is the one that is allowed to mail.
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

const comms = readFileSync('server/lib/comms.ts', 'utf8');
const lifecycle = readFileSync('server/lib/lifecycle.ts', 'utf8');
const notify = readFileSync('server/lib/notify.ts', 'utf8');
const admin = readFileSync('api/admin.ts', 'utf8');
const webhook = readFileSync('api/stripe-webhook.ts', 'utf8');
const account = readFileSync('server/lib/account.ts', 'utf8');
const growth = readFileSync('server/lib/growth.ts', 'utf8');
const catalogDb = readFileSync('server/lib/catalog-db.ts', 'utf8');

// ---------------------------------------------------- A. a sender, and something that calls it
console.log('A. every loop has a sender and a trigger');
{
  check(/export async function unfinished/.test(growth) && /path === 'unfinished'/.test(admin),
    'loop 1 — speed to lead is served to the admin', 'growth.unfinished() behind /api/admin?path=unfinished');

  const LOOP2 = [
    ['visit_complete', /export async function sendVisitComplete/, () => /await sendVisitComplete\(/.test(admin), 'the admin marking a stop done'],
    ['payment_failed', /export async function sendPaymentFailed/, () => /await sendPaymentFailed\(/.test(webhook), "Stripe's invoice.payment_failed"],
    ['card_expiring', /export async function sendCardExpiring/, () => /\['card_expiring', sendCardExpiring\]/.test(comms) && /runCommsSweeps\(\)/.test(admin), 'the sweep the admin board runs on read'],
    ['cancel_confirmation', /export async function sendCancelConfirmation/, () => /await sendCancelConfirmation\(/.test(account), 'cancelPlan()'],
  ];
  for (const [name, exists, wired, by] of LOOP2) {
    check(exists.test(comms) && wired(), `loop 2 — ${name} exists and is triggered`, by);
  }
  check(/export async function sendReviewRequests/.test(comms)
    && /\['review_request', sendReviewRequests\]/.test(comms) && /runCommsSweeps\(\)/.test(admin),
    'loop 3 — the review request exists and is triggered', 'the sweep the admin board runs on read');

  // The booking receipt is loop 2's first message and predates this file. Named so that a future
  // reader does not "fix" its absence from comms.ts by writing a second one.
  check(/purpose: 'booking_welcome'/.test(readFileSync('server/lib/booking.ts', 'utf8')),
    'loop 2 — the booking receipt is in booking.ts and is not duplicated here',
    'one message, one author');

  // P4 gives the completion verb to the assigned crew, so the crew allowlist must name it.
  // `gates/admin-roles.mjs` proves crew is refused everything else by default; this proves the
  // one widening was deliberate, because a default-deny list cannot tell an intended addition
  // from an accidental one.
  check(/CREW_PATHS = new Set\(\[[^\]]*'visits\/complete'/.test(admin),
    'a crew session may mark a stop done', 'P4: the person standing in the yard');

  // There is no scheduler, so a sweep nobody calls is a sweep that never runs.
  check(!/"crons"/.test(readFileSync('vercel.json', 'utf8')),
    'there is still no cron, so the sweeps must run on read', 'if a cron is added, this line is the one to revisit');
}

// ---------------------------------------------- B. the once-only pair, in both files that use it
console.log('\nB. every guarded purpose writes the key its guard reads');
{
  check(/about\?: \{[^}]*subscription_id\?: string/.test(notify) && /\.\.\.\(args\.about \?\? \{\}\)/.test(notify),
    'sendEmail() accepts `about` and writes it onto the outbox payload',
    'this is what made alreadySent() able to match at all');

  // Every `purpose: 'x'` in a file that also guards on `x` must sit beside an `about:`.
  const guardedIn = (src) => {
    const guarded = new Set([...src.matchAll(/(?:alreadySent|sentAlready)\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
    const missing = [];
    for (const m of src.matchAll(/purpose: '([a-z_]+)',\n(\s*)([^\n]*)/g)) {
      if (guarded.has(m[1]) && !/^about:/.test(m[3].trim())) missing.push(m[1]);
    }
    return { guarded: [...guarded], missing };
  };
  for (const [file, src] of [['lifecycle.ts', lifecycle], ['comms.ts', comms]]) {
    const { guarded, missing } = guardedIn(src);
    check(guarded.length > 0 && missing.length === 0,
      `${file} — all ${guarded.length} guarded purposes pass \`about\``,
      missing.length ? `MISSING: ${missing.join(', ')}` : guarded.join(', '));
  }

  // The guard keys and the payload keys are the same words.
  const guardKeys = [...comms.matchAll(/sentAlready\('[a-z_]+', '([a-z_]+)'/g)].map((m) => m[1]);
  const allowed = new Set(['subscription_id', 'customer_id', 'visit_id']);
  check(guardKeys.length > 0 && guardKeys.every((k) => allowed.has(k)),
    'every guard key is one sendEmail() can write', guardKeys.join(', '));

  check(/state <> 'failed'/.test(comms) && /state <> 'failed'/.test(lifecycle),
    'a refused send does not count as sent', 'or a provider outage would silence the retry forever');
}

// ------------------------------------------- C. the review request reads rows, not literals
console.log('\nC. the review request is driven by the rows');
{
  check(/settings\.get\('growth\.review_request_after_visits'\)/.test(comms),
    'the threshold comes from growth.review_request_after_visits',
    'a row that existed since migration 018 with no reader until now');
  check(/key like 'growth\.%'/.test(catalogDb) && /key like 'reviews\.%'/.test(catalogDb),
    'loadCatalog() actually loads the prefixes comms.ts reads',
    'a filter is a silent allowlist — subscription.% cost a day on 2026-09-19');
  check(/v\.state = 'completed' and v\.completed_at is not null/.test(comms),
    'eligibility counts completed visits and nothing else');
  check(/reviews\.google_profile_url/.test(comms) && /there is no link to send/.test(comms),
    'no link, no send — and it says so rather than inventing a URL');
  check(!/google_profile_url'\s*\)\s*\?\?\s*'http/.test(comms),
    'the review URL has ONE home',
    'a second default here would be the same defect as billing.platform_fee_bps');
}

// ------------------------------- D. the real query, planted rows, rolled back, no mail sent
console.log('\nD. the shipped eligibility query, against planted rows');
{
  const out = compileServer();
  const { eligibleForReviewRequest, cardsExpiringSoon } = await import(`${process.cwd()}/${out}/server/lib/comms.js`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  try {
    await c.query('begin');
    const { rows: [cust] } = await c.query(
      `insert into customers (name, email, phone) values ('GATE lead-comms', 'gate+leadcomms@example.invalid', '8055550000') returning id`);
    const { rows: [prop] } = await c.query(
      `insert into properties (customer_id, address, city, postal_code) values ($1, '1 Gate Way', 'Ventura', '93001') returning id`, [cust.id]);
    const { rows: [sub] } = await c.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, monthly_price_cents, source)
       values ($1, $2, 'weekly-pooper-scooper-service', 'active', 12000, 'online') returning id`, [cust.id, prop.id]);

    // One row per day, never twice on a day: `visits_no_double_booking_idx` is a real index and
    // the first version of this gate tripped it by restarting the day offset at 1.
    let day = 0;
    const plant = async (n, state) => {
      const days = [];
      for (let i = 0; i < n; i++) {
        day += 1;
        days.push(day);
        await c.query(
          `insert into visits (subscription_id, property_id, scheduled_for, state, completed_at)
           values ($1, $2, current_date - $3::int, $4, case when $4 = 'completed' then now() else null end)`,
          [sub.id, prop.id, day, state]);
      }
      return days;
    };

    const mine = async (after) => (await eligibleForReviewRequest(after, c)).filter((r) => r.customer_id === cust.id);

    await plant(2, 'completed');
    check((await mine(3)).length === 0, 'two completed visits is not yet eligible', 'the threshold is 3');

    const [third] = await plant(1, 'completed');
    const hit = await mine(3);
    check(hit.length === 1 && Number(hit[0].done) === 3, 'the third completed visit makes them eligible',
      hit.length ? `done=${hit[0].done}` : 'not found');

    /**
     * THE TWO FIELDS, ONE AT A TIME. The eligibility query reads `state = 'completed'` AND
     * `completed_at is not null`, and a test that changes both together cannot tell which one
     * is load-bearing — the same blindness as a `CONSTANT - 1` boundary test. Mutation-tested:
     * dropping `v.state = 'completed'` from the query left the both-fields version of this
     * check passing. So each field is now falsified on its own.
     */
    await c.query(`update visits set state = 'skipped' where subscription_id = $1 and scheduled_for = current_date - $2::int`, [sub.id, third]);
    check((await mine(3)).length === 0, 'a skipped visit stops counting even with completed_at still set',
      'this is the half that a state-only filter would miss');

    await c.query(`update visits set state = 'completed', completed_at = null where subscription_id = $1 and scheduled_for = current_date - $2::int`, [sub.id, third]);
    check((await mine(3)).length === 0, "a 'completed' visit with no completed_at does not count",
      'this is the half that a completed_at-only filter would miss');

    await c.query(`update visits set completed_at = now() where subscription_id = $1 and scheduled_for = current_date - $2::int`, [sub.id, third]);
    check((await mine(3)).length === 1, 'and with both fields right, they are eligible again',
      'or the two checks above would pass by breaking the query for everybody');

    // The card sweep, same treatment: a card expiring next month is found, one expiring in a
    // year is not. `detached_at` must exclude a removed card.
    const soon = new Date(); soon.setMonth(soon.getMonth() + 1);
    const { rows: [pm] } = await c.query(
      `insert into payment_methods (customer_id, stripe_customer_id, stripe_pm_id, brand, last4, exp_month, exp_year)
       values ($1,'cus_gate','pm_gate','visa','4242',$2,$3) returning id`,
      [cust.id, soon.getMonth() + 1, soon.getFullYear()]);
    const mineCards = async () => (await cardsExpiringSoon(c)).filter((r) => r.customer_id === cust.id);
    check((await mineCards()).length === 1, 'a card expiring next month is found');
    await c.query(`update payment_methods set exp_year = exp_year + 2 where id = $1`, [pm.id]);
    check((await mineCards()).length === 0, 'a card expiring in two years is not');
    await c.query(`update payment_methods set exp_year = exp_year - 2, detached_at = now() where id = $1`, [pm.id]);
    check((await mineCards()).length === 0, 'a detached card is not', 'it is not on the plan any more');
  } finally {
    // EVERYTHING above is inside one transaction and none of it survives. This project has left
    // gate rows in a client's live database before (Summit, 10 of 15 leads); the rollback is why
    // this one cannot.
    await c.query('rollback').catch(() => {});
    await c.end().catch(() => {});
    cleanupCompile();
  }
}

// ---- negative controls ------------------------------------------------------------------------
console.log('\nnegative controls');
{
  // The check-B detector, over a sender that forgot `about`.
  const bad = "if (await alreadySent('x_notice', s.id, 30)) return;\n  await sendEmail({\n    purpose: 'x_notice',\n    recipients: { explicit: [s.email] },";
  const guarded = new Set([...bad.matchAll(/(?:alreadySent|sentAlready)\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const missing = [...bad.matchAll(/purpose: '([a-z_]+)',\n(\s*)([^\n]*)/g)]
    .filter((m) => guarded.has(m[1]) && !/^about:/.test(m[3].trim())).map((m) => m[1]);
  check(missing.length === 1 && missing[0] === 'x_notice',
    'negative control: a guarded sender with no `about` is caught', 'this is the bug that was live this morning');

  const good = "if (await alreadySent('x_notice', s.id, 30)) return;\n  await sendEmail({\n    purpose: 'x_notice',\n    about: { subscription_id: s.id },";
  const g2 = new Set([...good.matchAll(/(?:alreadySent|sentAlready)\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const m2 = [...good.matchAll(/purpose: '([a-z_]+)',\n(\s*)([^\n]*)/g)]
    .filter((m) => g2.has(m[1]) && !/^about:/.test(m[3].trim()));
  check(m2.length === 0, 'negative control: the same sender WITH `about` passes',
    'or the check would fail everything and mean nothing');
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
