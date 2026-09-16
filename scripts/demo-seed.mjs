/**
 * Put a demonstrable business into the database, entirely made of rows that can be taken
 * back out again.
 *
 *   node --env-file=.env.local scripts/demo-seed.mjs --rehearse   # ONE row, round trip, receipt
 *   node --env-file=.env.local scripts/demo-seed.mjs --one-row    # ONE row, leave it there
 *   node --env-file=.env.local scripts/demo-seed.mjs              # the full fixture set
 *   node --env-file=.env.local scripts/demo-seed.mjs --status      # what is already seeded
 *
 * WHY THIS EXISTS. Before it, the only way to create test data on this system was to submit
 * a real form, which emails the owner. Every acceptance step is "Ben tried it", so every
 * acceptance step cost the client an email. This and demo-clear.mjs are the pair that make
 * the system exercisable.
 *
 * THE MARK IS THE WHOLE DESIGN. Every row this writes is reachable from a customer or a
 * lead whose name begins with DEMO—, so demo-clear.mjs can delete exactly this and nothing
 * else. There are 24 real leads and real people in this database. A delete that has to
 * reason about which rows are test data is a delete that will one day be wrong.
 *
 * REHEARSE BEFORE YOU SEED. `--rehearse` writes one marked lead, reads it back, removes it,
 * reads back that it is gone and that the real rows are untouched, and writes
 * output/demo-rehearsal-receipt.json. A revert that has never been run is a plan, not a
 * revert - and the cheapest moment to find out is on one row.
 *
 * IT WRITES NO `events` ROWS, on purpose. `events` is append-only with a database trigger
 * refusing UPDATE and DELETE, so anything written there could not be cleared, and the
 * fixture set would stop being exactly reversible. A demo fixture is state, not history.
 * When the verb framework lands, seeding through verbs is what produces the history.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const MARK = 'DEMO—';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/demo-seed.mjs');
  process.exit(1);
}
const host = (() => { try { return new URL(url).host.split('.').slice(-3).join('.'); } catch { return 'unknown'; } })();

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
console.log(`connected to …${host}`);

/** Counts of the things a clear must not touch, and of the things it must. */
async function census() {
  const q = async (sql, p = []) => Number((await c.query(sql, p)).rows[0].n);
  return {
    real_leads: await q(`select count(*)::int n from leads where name not like $1`, [MARK + '%']),
    demo_leads: await q(`select count(*)::int n from leads where name like $1`, [MARK + '%']),
    real_customers: await q(`select count(*)::int n from customers where name not like $1`, [MARK + '%']),
    demo_customers: await q(`select count(*)::int n from customers where name like $1`, [MARK + '%']),
    demo_properties: await q(
      `select count(*)::int n from properties p join customers cu on cu.id = p.customer_id
        where cu.name like $1`, [MARK + '%']),
    demo_subscriptions: await q(
      `select count(*)::int n from subscriptions s join customers cu on cu.id = s.customer_id
        where cu.name like $1`, [MARK + '%']),
    demo_visits: await q(
      `select count(*)::int n from visits v
         join subscriptions s on s.id = v.subscription_id
         join customers cu on cu.id = s.customer_id
        where cu.name like $1`, [MARK + '%']),
    demo_invoices: await q(
      `select count(*)::int n from invoices i join customers cu on cu.id = i.customer_id
        where cu.name like $1`, [MARK + '%']),
    demo_messages: await q(
      `select count(*)::int n from messages m join customers cu on cu.id = m.customer_id
        where cu.name like $1`, [MARK + '%']),
    demo_contact_messages: await q(
      `select count(*)::int n from contact_messages where name like $1`, [MARK + '%']),
  };
}

const show = (label, x) => {
  console.log(`  ${label}`);
  for (const [k, v] of Object.entries(x)) console.log(`      ${k.padEnd(24)} ${v}`);
};

/** One marked lead. The smallest possible thing to rehearse a revert against. */
async function seedOneLead(suffix = 'rehearsal') {
  const id = randomUUID();
  await c.query(
    `insert into leads (id, name, phone, email, address, city, service_slug, yard_size,
                        num_dogs, notes, source_page, status, created_at)
     values ($1,$2,'8050000001','demo@example.invalid','1 Demo Street','Ventura',
             'weekly-pooper-scooper-service','small',1,$3,'/demo','new', now())`,
    [id, `${MARK}${suffix}`, `Written by scripts/demo-seed.mjs. Safe to delete.`]);
  return id;
}

if (has('--status')) {
  show('census', await census());
  await c.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --rehearse — the round trip, on one row, with a receipt
// ---------------------------------------------------------------------------
if (has('--rehearse')) {
  const before = await census();
  show('before', before);

  const id = await seedOneLead('rehearsal');
  const seeded = await c.query('select id, name, status from leads where id = $1', [id]);
  const afterSeed = await census();
  if (!seeded.rows.length) {
    console.error('  FAIL  the row was not written, so there is nothing to rehearse');
    await c.end(); process.exit(1);
  }
  console.log(`  seeded 1 lead: ${seeded.rows[0].name}`);

  const removed = await c.query('delete from leads where name like $1', [MARK + '%']);
  const gone = await c.query('select id from leads where id = $1', [id]);
  const afterClear = await census();
  show('after clear', afterClear);

  const ok =
    afterSeed.demo_leads === before.demo_leads + 1 &&
    gone.rows.length === 0 &&
    afterClear.demo_leads === before.demo_leads &&
    afterClear.real_leads === before.real_leads &&
    afterClear.real_customers === before.real_customers;

  const receipt = {
    what: 'seed one marked lead, read it back, remove it, prove nothing else moved',
    ran_at: new Date().toISOString(),
    database_host: host,
    mark: MARK,
    row_id: id,
    removed: removed.rowCount,
    before, after_seed: afterSeed, after_clear: afterClear,
    result: ok ? 'PASS' : 'FAIL',
    note: ok
      ? 'The revert has been run. The full fixture set is safe to seed.'
      : 'The revert did NOT round-trip cleanly. Do not seed the full set.',
  };
  const out = path.resolve('output/demo-rehearsal-receipt.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`\n  ${receipt.result}  removed ${removed.rowCount}, ${afterClear.real_leads} real leads remain`);
  console.log(`  receipt: output/demo-rehearsal-receipt.json`);
  await c.end();
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// --one-row — seed one and leave it
// ---------------------------------------------------------------------------
if (has('--one-row')) {
  const id = await seedOneLead('one-row');
  console.log(`  seeded 1 lead ${id}`);
  show('census', await census());
  await c.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// the full fixture set
// ---------------------------------------------------------------------------
const receipt = await (async () => {
  const before = await census();
  if (before.demo_customers || before.demo_leads) {
    console.error(`  REFUSED: ${before.demo_customers} demo customer(s) and ${before.demo_leads} ` +
                  `demo lead(s) are already seeded. Run demo-clear.mjs first, so the set is ` +
                  `exactly one set and the clear stays exact.`);
    await c.end();
    process.exit(1);
  }
  show('before', before);

  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

  await c.query('begin');

  // Three customers, because the three shapes of this business are different screens:
  // a weekly round, a twice-weekly round, and a one-off job.
  const people = [
    { name: `${MARK}Marisol Reyes`,  phone: '8050000101', email: 'marisol.demo@example.invalid',
      frequency: 'weekly',   weekday: 2, price: 2500, tier: '2 dogs' },
    { name: `${MARK}Dwight Okafor`,  phone: '8050000102', email: 'dwight.demo@example.invalid',
      frequency: 'biweekly', weekday: 4, price: 3500, tier: '3 dogs' },
    { name: `${MARK}Priya Raman`,    phone: '8050000103', email: 'priya.demo@example.invalid',
      frequency: 'one_time', weekday: 1, price: 12000, tier: 'Yard deep clean' },
  ];

  const seeded = { customers: [], properties: [], subscriptions: [], visits: [] };

  for (const [i, p] of people.entries()) {
    const cu = (await c.query(
      `insert into customers (name, phone, email, notes) values ($1,$2,$3,$4) returning id`,
      [p.name, p.phone, p.email, 'Demo fixture. scripts/demo-clear.mjs removes it.'])).rows[0].id;
    seeded.customers.push(cu);

    // Two properties each, and only one of them has a gate code. The gate code is a real
    // field with a real access rule behind it, so a fixture set without one leaves the
    // rule untested and the screen unlooked at.
    const addrs = [
      { address: `${i + 1}01 Demo Ridge Road`, city: 'Ventura',       gate: '4417' },
      { address: `${i + 1}02 Demo Vista Way`,  city: 'Thousand Oaks', gate: null },
    ];
    const props = [];
    for (const a of addrs) {
      props.push((await c.query(
        `insert into properties (customer_id, address, city, postal_code, yard_size, num_dogs,
                                 gate_code, access_notes)
         values ($1,$2,$3,'93003','medium',2,$4,$5) returning id`,
        [cu, a.address, a.city, a.gate,
         a.gate ? 'Side gate, keypad on the left.' : 'Gate is unlocked.'])).rows[0].id);
    }
    seeded.properties.push(...props);

    const sub = (await c.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, price_cents,
                                  price_basis, price_quantity, price_tier_label, priced_at,
                                  frequency, service_weekday, starts_on)
       values ($1,$2,$3,'active',$4,'dogs',2,$5, now(), $6, $7, $8) returning id`,
      [cu, props[0],
       p.frequency === 'one_time' ? 'yard-deep-clean' : 'weekly-pooper-scooper-service',
       p.price, p.tier, p.frequency, p.weekday, day(-28)])).rows[0].id;
    seeded.subscriptions.push(sub);

    // A week of visits covering EVERY state. A state with no fixture is a screen nobody
    // ever looks at until a customer is in it.
    const states = i === 0
      ? [['completed', -7], ['completed', -3], ['en_route', 0], ['scheduled', 2], ['scheduled', 9]]
      : i === 1
      ? [['completed', -6], ['skipped', -2], ['assigned', 1], ['scheduled', 8]]
      : [['cancelled', -5], ['failed_access', -1], ['scheduled', 3]];

    for (const [state, offset] of states) {
      const done = state === 'completed';
      seeded.visits.push((await c.query(
        `insert into visits (subscription_id, property_id, scheduled_for, state,
                             en_route_at, completed_at, photo_urls, crew_notes,
                             charge_cents, chargeable)
         values ($1,$2,$3,$4,
                 case when $4 in ('en_route','completed') then now() - interval '20 minutes' end,
                 case when $4 = 'completed' then now() - interval '1 hour' end,
                 case when $4 = 'completed' then array['/demo/completion-photo.jpg'] else '{}'::text[] end,
                 $5, $6, $7) returning id`,
        [sub, props[0], day(offset), state,
         done ? 'All clear. Gate closed behind me.' : '',
         p.price, state === 'cancelled' ? false : true])).rows[0].id);
    }
  }

  // Money needs both sides on the screen: one invoice raised and unpaid, one paid.
  const invoices = [];
  for (const [i, state] of [['open'], ['paid']].entries()) {
    const s = state[0];
    const cu = seeded.customers[i];
    const amount = people[i].price * 4;
    const fee = Math.round(amount * 0.04);
    const inv = (await c.query(
      `insert into invoices (customer_id, period_start, period_end, subtotal_cents,
                             platform_fee_cents, total_cents, state, issued_at, paid_at)
       values ($1,$2,$3,$4,$5,$4,$6, now() - interval '3 days',
               case when $6 = 'paid' then now() - interval '1 day' end) returning id`,
      [cu, day(-30), day(-1), amount, fee, s])).rows[0].id;
    invoices.push(inv);
    await c.query(
      `insert into invoice_lines (invoice_id, description, amount_cents)
       values ($1, $2, $3)`,
      [inv, `${people[i].price / 100 === 25 ? 'Weekly' : 'Scheduled'} service — 4 visits`, amount]);
    if (s === 'paid') {
      await c.query(
        `insert into payments (customer_id, invoice_id, kind, amount_cents, platform_fee_cents, state)
         values ($1,$2,'manual',$3,$4,'succeeded')`, [cu, inv, amount, fee]);
    }
  }

  // One thread, three messages, both directions — the shape the portal and the admin share.
  const threadCustomer = seeded.customers[0];
  for (const m of [
    ['inbound',  'customer', 'Are you coming today? The gate code changed to 4417.'],
    ['outbound', 'owner',    'Thanks — updated. We are on the way, about 20 minutes.'],
    ['inbound',  'customer', 'Perfect, thank you!'],
  ]) {
    await c.query(
      `insert into messages (customer_id, direction, channel, author_kind, body, created_at)
       values ($1,$2,'portal',$3,$4, now() - interval '2 hours')`,
      [threadCustomer, m[0], m[1], m[2]]);
  }

  // Three leads, one per status that changes what a screen shows.
  for (const [status, who] of [['new', 'Ines Delgado'], ['quoted', 'Arthur Nkemelu'], ['active', 'Tam Whitfield']]) {
    await c.query(
      `insert into leads (id, name, phone, email, address, city, service_slug, yard_size,
                          num_dogs, notes, source_page, status, created_at)
       values ($1,$2,$3,$4,'9 Demo Court','Oxnard','weekly-pooper-scooper-service','small',
               1,'Demo fixture.','/demo',$5, now())`,
      [randomUUID(), `${MARK}${who}`, '80500002' + Math.floor(Math.random() * 90 + 10),
       `${who.split(' ')[0].toLowerCase()}.demo@example.invalid`, status]);
  }

  // One contact-form message, so the messages inbox is not empty on the walk.
  await c.query(
    `insert into contact_messages (name, email, phone, subject, message, source_page)
     values ($1,'ines.demo@example.invalid','8050000299','Quote for two dogs',
             'Hi — what would weekly be for two dogs in Ventura?','/contact')`,
    [`${MARK}Ines Delgado`]);

  await c.query('commit');

  const after = await census();
  show('after', after);

  const untouched = after.real_leads === before.real_leads &&
                    after.real_customers === before.real_customers;
  console.log(`\n  seeded ${after.demo_customers} customers, ${after.demo_properties} properties, ` +
              `${after.demo_subscriptions} subscriptions, ${after.demo_visits} visits, ` +
              `${after.demo_invoices} invoices, ${after.demo_messages} messages, ` +
              `${after.demo_leads} leads, ${after.demo_contact_messages} contact message(s)`);
  console.log(`  ${untouched ? 'real rows untouched' : 'WARNING: a real-row count moved'} — ` +
              `${after.real_leads} real leads, ${after.real_customers} real customers`);
  console.log(`  undo: node --env-file=.env.local scripts/demo-clear.mjs`);
  return untouched;
})();

await c.end();
process.exit(receipt ? 0 : 1);
