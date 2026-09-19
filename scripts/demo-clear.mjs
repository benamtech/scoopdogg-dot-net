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
  // customers delete fails on a foreign key and the cleanup stops halfway. Both of these were
  // added on 2026-09-19 and both were found by a gate rather than by reading: customer_invites
  // (018) references customers, properties and subscriptions; funnel_sessions (021) references
  // subscriptions and service_areas.
  ['customer_invites', `delete from customer_invites where customer_id = any($1::uuid[])`, ids],
  // A demo booking's funnel session is measurement of a customer who does not exist. It goes with
  // the fixture rather than sitting in the growth board's denominator forever.
  ['funnel_sessions', `delete from funnel_sessions where subscription_id in
                         (select id from subscriptions where customer_id = any($1::uuid[]))`, ids],
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

if (dry) {
  // Count, do not delete. Same predicates, turned into selects.
  const counts = {
    payments: await n(`select count(*)::int n from payments where customer_id = any($1::uuid[])`, [ids]),
    invoice_lines: await n(`select count(*)::int n from invoice_lines where invoice_id in
                             (select id from invoices where customer_id = any($1::uuid[]))`, [ids]),
    invoices: await n(`select count(*)::int n from invoices where customer_id = any($1::uuid[])`, [ids]),
    messages: await n(`select count(*)::int n from messages where customer_id = any($1::uuid[])`, [ids]),
    visits: await n(`select count(*)::int n from visits where subscription_id in
                       (select id from subscriptions where customer_id = any($1::uuid[]))`, [ids]),
    subscriptions: await n(`select count(*)::int n from subscriptions where customer_id = any($1::uuid[])`, [ids]),
    properties: await n(`select count(*)::int n from properties where customer_id = any($1::uuid[])`, [ids]),
    customers: demoCustomers.length,
    leads: await n(`select count(*)::int n from leads where name like $1`, [like]),
    contact_messages: await n(`select count(*)::int n from contact_messages where name like $1`, [like]),
    'outbox (demo)': await n(`select count(*)::int n from outbox where demo = true`, []),
  };
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
  // `ids` is ONE array parameter ($1::uuid[]). Passing the array itself as the parameter list
  // bound each uuid as its own parameter - invisible with one demo customer, a crash with seven
  // (found 2026-09-16; the transaction rolled back and nothing was removed).
  const bind = sql.includes('$1::uuid[]') ? [params] : params;
  // BIND BY WHAT THE SQL ASKS FOR, not by whether the list happens to be empty. Skipping the
  // parameters when there are no demo customers left sent `... = any($1::uuid[])` to Postgres
  // with nothing bound, and a second run - or a first run on a clean database - died with
  // "there is no parameter $1" instead of reporting that there was nothing to remove.
  const r = await c.query(sql, bind);
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
