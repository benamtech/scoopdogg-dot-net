/**
 * Remove exactly what scripts/demo-seed.mjs wrote, and prove that is all it removed.
 *
 *   node scripts/demo-clear.mjs            # remove the demo rows
 *   node scripts/demo-clear.mjs --dry-run  # say what would go
 *
 * EVERY DELETE IS SCOPED BY THE MARK. A demo customer's name begins with DEMO—, and
 * everything else the seed wrote hangs off one of those customers or off a marked lead.
 * Nothing here reasons about dates, ids, "looks like test data", or anything else that
 * could be true of a real person. There are 24 real leads and real customers in this
 * database.
 *
 * IT PRINTS WHAT REMAINS, not just what went. A cleanup that reports only its own
 * deletions cannot tell you it took something it should not have - which is the whole
 * question a clear against a live database has to answer.
 *
 * IT DELETES NO `events` ROWS, because `events` refuses DELETE at the database and the
 * seed deliberately writes none. If that ever changes, this script does not start
 * disabling a tamper-evidence trigger to tidy up; the seed stops writing history instead.
 */
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const MARK = 'DEMO—';
const like = MARK + '%';
const dry = process.argv.includes('--dry-run');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run with: node scripts/demo-clear.mjs');
  process.exit(1);
}
const host = (() => { try { return new URL(url).host.split('.').slice(-3).join('.'); } catch { return 'unknown'; } })();

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
console.log(`connected to …${host}${dry ? '  (dry run — nothing is deleted)' : ''}`);

const n = async (sql, p = []) => Number((await c.query(sql, p)).rows[0].n);

async function census() {
  return {
    real_leads:     await n(`select count(*)::int n from leads where name not like $1`, [like]),
    real_customers: await n(`select count(*)::int n from customers where name not like $1`, [like]),
    real_messages:  await n(`select count(*)::int n from contact_messages where name not like $1`, [like]),
    demo_leads:     await n(`select count(*)::int n from leads where name like $1`, [like]),
    demo_customers: await n(`select count(*)::int n from customers where name like $1`, [like]),
  };
}

/**
 * The foreign-key graph, checked against the plan below.
 *
 * Any table with a foreign key onto `customers` or `subscriptions` will block their deletes, so
 * every one of them has to be handled here. Rather than trust a comment, ask the database which
 * tables those are and refuse if one is unaccounted for.
 *
 * A table can be accounted for in two ways: it appears in the plan, or it is named in
 * KNOWN_NOT_DELETED with the reason. `events` is the standing example — it refuses DELETE at the
 * database and the seed writes none.
 */
const KNOWN_NOT_DELETED = new Set([
  'events',            // append-only; a trigger refuses DELETE and the seed writes none
]);

async function assertCoverage(planTables) {
  const { rows } = await c.query(`
    select distinct src.relname as child, tgt.relname as parent
      from pg_constraint k
      join pg_class src on src.oid = k.conrelid
      join pg_class tgt on tgt.oid = k.confrelid
     where k.contype = 'f' and tgt.relname in ('customers','subscriptions')
       and src.relname <> tgt.relname`);
  const missing = rows
    .map((r) => r.child)
    .filter((t, i, a) => a.indexOf(t) === i)
    .filter((t) => !planTables.has(t) && !KNOWN_NOT_DELETED.has(t));
  if (missing.length) {
    console.error(`demo-clear.mjs does not know about ${missing.length} table(s) that reference customers or subscriptions:`);
    for (const t of missing) {
      const parents = rows.filter((r) => r.child === t).map((r) => r.parent).join(', ');
      console.error(`  ${t}  ->  ${parents}`);
    }
    console.error('Add each to the plan (child-first) or to KNOWN_NOT_DELETED with a reason.');
    console.error('Refusing to run: a half-finished cleanup against a live database is worse than none.');
    process.exit(2);
  }
  console.log(`foreign-key coverage: ${rows.length} reference(s) from ${new Set(rows.map((r) => r.child)).size} table(s), all accounted for`);
}

/**
 * How each plan entry's parameters are bound. ONE copy, because the dry run and the real run
 * must send byte-identical statements — a dry run that binds differently is not a rehearsal.
 *
 * `ids` is ONE array parameter ($1::uuid[]). Passing the array itself as the parameter list
 * bound each uuid as its own parameter — invisible with one demo customer, a crash with seven
 * (found 2026-09-16; the transaction rolled back and nothing was removed). And the binding
 * follows what the SQL ASKS FOR, not whether the list happens to be empty: skipping it on an
 * empty list sent `= any($1::uuid[])` with nothing bound and died with "there is no parameter
 * $1" instead of reporting that there was nothing to remove.
 */
const bindFor = (sql, params) => (sql.includes('$1::uuid[]') ? [params] : params);

const before = await census();

// The demo customers, resolved once. Every child delete keys off this list, so a row can
// only be removed because a MARKED customer owns it.
const { rows: demoCustomers } = await c.query('select id, name from customers where name like $1', [like]);
const ids = demoCustomers.map((r) => r.id);

// Child-first, so a foreign key never has to be deferred or cascaded by luck.
const plan = [
  ['payments',         `delete from payments where customer_id = any($1::uuid[])`, ids],
  ['invoice_lines',    `delete from invoice_lines where invoice_id in
                          (select id from invoices where customer_id = any($1::uuid[]))`, ids],
  ['invoices',         `delete from invoices where customer_id = any($1::uuid[])`, ids],
  ['messages',         `delete from messages where customer_id = any($1::uuid[])`, ids],
  ['visits',           `delete from visits where subscription_id in
                          (select id from subscriptions where customer_id = any($1::uuid[]))`, ids],
  ['stripe_customers', `delete from stripe_customers where customer_id = any($1::uuid[])`, ids],
  // EVERY NEW TABLE THAT POINTS AT A CUSTOMER HAS TO BE NAMED HERE, child-first, or the
  // customers delete fails on a foreign key and the cleanup stops halfway.
  //
  // That sentence used to be the whole protection, and it failed three times in two days:
  // customer_invites (018), funnel_sessions (021) and consents (023) each arrived, each broke
  // this script on a foreign key, and each was found by running it rather than by anybody
  // reading the comment. A comment asking the next person to remember is not a mechanism. So
  // `assertCoverage()` below now reads the foreign-key graph and REFUSES TO RUN when a table
  // references customers or subscriptions and is not named in this plan. It names the table.
  // It does not invent a delete for it, because what to do with a new table is a decision.
  ['customer_invites', `delete from customer_invites where customer_id = any($1::uuid[])`, ids],
  // The California consent records for demo bookings. Scoped to demo customers, which is what
  // makes this safe: migration 023 keeps a real consent for three years, or one past
  // termination, and a cleanup that could reach one would be destroying the evidence the table
  // exists to hold. A consent belonging to a customer called "DEMO—..." is evidence of nothing.
  ['consents',         `delete from consents where customer_id = any($1::uuid[])
                          or subscription_id in (select id from subscriptions where customer_id = any($1::uuid[]))`, ids],
  // A demo booking's funnel session is measurement of a customer who does not exist. It goes with
  // the fixture rather than sitting in the growth board's denominator forever.
  ['funnel_sessions', `delete from funnel_sessions where subscription_id in
                         (select id from subscriptions where customer_id = any($1::uuid[]))`, ids],
  // The three `assertCoverage()` found on its first run, 2026-09-19 — none of which anyone had
  // noticed, and each of which would have stopped the cleanup dead the first time a demo
  // booking touched it. offer_redemptions is the likeliest: every demo booking applies the
  // half-off offer.
  ['offer_redemptions', `delete from offer_redemptions where customer_id = any($1::uuid[])
                           or subscription_id in (select id from subscriptions where customer_id = any($1::uuid[]))`, ids],
  ['payment_methods',  `delete from payment_methods where customer_id = any($1::uuid[])`, ids],
  ['sessions',         `delete from sessions where customer_id = any($1::uuid[])`, ids],
  ['invoices (by sub)', `delete from invoices where subscription_id in (select id from subscriptions where customer_id = any($1::uuid[]))`, ids],
  ['subscriptions',    `delete from subscriptions where customer_id = any($1::uuid[])`, ids],
  ['properties',       `delete from properties where customer_id = any($1::uuid[])`, ids],
  ['customers',        `delete from customers where name like $1`, [like]],
  ['leads',            `delete from leads where name like $1`, [like]],
  ['contact_messages', `delete from contact_messages where name like $1`, [like]],
  // Demo sends are rows about messages that were rewritten to the demo address. They are
  // evidence the demo worked, so they go with the fixture set rather than lingering.
  ['outbox (demo)',    `delete from outbox where demo = true`, []],
];

// The plan's own table names, taken from the plan rather than typed a second time.
await assertCoverage(new Set(plan.map(([label]) => label.replace(/ .*$/, ''))));

if (dry) {
  // RUN THE REAL PLAN AND ROLL IT BACK.
  //
  // This used to be a second hand-written list of SELECTs mirroring the DELETEs, which meant
  // two lists to keep in step and a dry run that under-reported the moment they diverged —
  // the same defect as the plan itself had, one level down. A dry run whose numbers are not the
  // real numbers is worse than no dry run, because it is believed.
  //
  // So: the actual statements, inside a transaction, counted, rolled back. The numbers are
  // exact by construction and a new entry in the plan appears here without anybody adding it.
  await c.query('begin');
  const counts = {};
  try {
    for (const [label, sql, params] of plan) {
      const r = await c.query(sql, bindFor(sql, params));
      counts[label] = r.rowCount;
    }
  } finally {
    await c.query('rollback');
  }
  console.log('  would remove:');
  for (const [k, v] of Object.entries(counts)) console.log(`      ${k.padEnd(18)} ${v}`);
  console.log(`  would keep:   ${before.real_leads} real leads, ${before.real_customers} real customers, ` +
              `${before.real_messages} real contact messages`);
  await c.end();
  process.exit(0);
}

await c.query('begin');
const removed = {};
for (const [label, sql, params] of plan) {
  const r = await c.query(sql, bindFor(sql, params));
  removed[label] = r.rowCount;
}
await c.query('commit');

const after = await census();

console.log('  removed:');
for (const [k, v] of Object.entries(removed)) console.log(`      ${k.padEnd(18)} ${v}`);
console.log(`  remaining:    ${after.real_leads} real leads, ${after.real_customers} real customers, ` +
            `${after.real_messages} real contact messages`);
console.log(`      demo rows left: ${after.demo_leads} lead(s), ${after.demo_customers} customer(s)`);

// The two assertions that make this a clear and not a delete.
const exact =
  after.real_leads === before.real_leads &&
  after.real_customers === before.real_customers &&
  after.real_messages === before.real_messages;
const complete = after.demo_leads === 0 && after.demo_customers === 0;

if (!exact) console.error('  FAIL  a real-row count moved. Something was removed that was not seeded.');
if (!complete) console.error('  FAIL  demo rows remain. The clear is not exact in the other direction either.');
if (exact && complete) console.log('  PASS  exactly the demo rows went, and all of them');

await c.end();
process.exit(exact && complete ? 0 : 1);
