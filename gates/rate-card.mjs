/**
 * The owner can change any price, and doing so cannot change what an existing customer pays.
 *
 *   node gates/rate-card.mjs
 *
 * THE PROMISE THIS DEFENDS is the one the screen makes out loud, every time: "raising a price
 * here does not touch a single existing customer". That is not copy — it is a property of the
 * schema, and this is the thing that keeps it a property. `packages.version` is bumped by the
 * `packages_version` trigger, `stripe_prices` is keyed on (package_id, livemode, account_id,
 * version) so a bump mints a NEW Price rather than mutating one a live subscription points at,
 * and a subscription froze its own `monthly_price_cents` at sign-up.
 *
 * NOTHING HERE TOUCHES STRIPE, and that is enforced rather than hoped for. Every write goes
 * through the shipped functions with this gate's own client inside a transaction that is always
 * rolled back, and `setPackagePrice` publishes only when it owns the connection — so a version
 * this gate invents and then discards can never leave a Price behind on the connected account.
 * That orphaning has happened on this project once already, from the other direction.
 *
 * Every assertion carries a negative control. A detector that cannot go red is not a detector.
 */
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0, skip = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const skipped = (w, why) => { skip++; console.log(`  SKIP  ${w} — ${why}`); };
const money = (c) => (c === null ? '—' : `$${(c / 100).toFixed(2)}`);

/** Run a call that must refuse, and report WHICH refusal — a 500 would pass a bare try/catch. */
const refuses = async (fn, code) => {
  try { await fn(); return { refused: false, code: null }; }
  catch (e) { return { refused: e?.code === code, code: e?.code ?? e?.message }; }
};

const out = compileServer();
const p = (f) => `${process.cwd()}/${out}/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd());
const { listRateCard, setTier, setPackagePrice } = await import(p('server/lib/rate-card.js'));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const BY = 'gate+rate-card@example.invalid';

try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');

  const card = await listRateCard(c);
  check(card.tiers.length > 0 && card.packages.length > 0,
    'the rate card reads every tier and every plan', `${card.tiers.length} tiers, ${card.packages.length} plans`);

  // --------------------------------------------------------- A. a tier price is a row
  console.log('\nA. a tier price is a row, and the change is recorded');
  const tier = card.tiers.find((t) => !t.requires_quote && t.price_cents !== null && t.status === 'active');
  check(!!tier, 'there is a priced tier to edit', tier ? `${tier.service_slug} · ${tier.label}` : 'none');

  const wasCents = tier.price_cents;
  const bumped = wasCents + 700;
  const r1 = await setTier(tier.id, { price_cents: bumped }, BY, c);
  check(Number(r1.tier.price_cents) === bumped, 'the new price is on the row', money(bumped));
  check(r1.changed.includes('price_cents'), 'the save reports what it changed', r1.changed.join(', '));

  const { rows: [chg] } = await c.query(
    `select field, old_value, new_value, changed_by from catalog_changes where entity_id = $1 order by changed_at desc limit 1`, [tier.id]);
  check(chg?.field === 'price_cents' && Number(chg.old_value) === wasCents && Number(chg.new_value) === bumped && chg.changed_by === BY,
    'the history holds what it was, what it is, and who',
    chg ? `${money(Number(chg.old_value))} -> ${money(Number(chg.new_value))} by ${chg.changed_by}` : 'no row');

  {
    const { rows: [n0] } = await c.query(`select count(*)::int as n from catalog_changes where entity_id = $1`, [tier.id]);
    const same = await setTier(tier.id, { price_cents: bumped }, BY, c);
    const { rows: [n1] } = await c.query(`select count(*)::int as n from catalog_changes where entity_id = $1`, [tier.id]);
    check(same.changed.length === 0 && n1.n === n0.n,
      'NEGATIVE CONTROL: saving the same number changes nothing and records nothing',
      'so the history is a record of changes, not of clicks');
  }

  // --------------------------------------------------------- B. the refusals
  console.log('\nB. what it refuses, and each refusal is a sentence');
  {
    const r = await refuses(() => setTier(tier.id, { price_cents: null, requires_quote: false }, BY, c), 'no_price_no_quote');
    check(r.refused, 'a tier cannot have neither a price nor the quote switch', `code ${r.code}`);
  }
  {
    const r = await refuses(() => setTier(tier.id, { price_cents: -100 }, BY, c), 'bad_price');
    check(r.refused, 'a negative price is refused before the database sees it', `code ${r.code}`);
  }
  {
    const r = await refuses(() => setTier(tier.id, { requires_quote: true, price_is_from: true }, BY, c), 'quote_and_from');
    check(r.refused, 'quote-only and "from" cannot both be on — they say opposite things', `code ${r.code}`);
  }

  /**
   * THE LONELY FROM-PRICE. gates/from-price-never-final.mjs checks that a "from" price is never
   * shown as final, tier by tier. It cannot see the case where EVERY firm price on a service has
   * been turned into a floor, because each tier is individually fine and the service as a whole
   * quietly stops having a price. This is that check, and it lives here because the rate card is
   * the only thing that can cause it.
   */
  {
    const bySvc = new Map();
    for (const t of card.tiers) {
      if (t.status !== 'active') continue;
      if (!bySvc.has(t.service_slug)) bySvc.set(t.service_slug, []);
      bySvc.get(t.service_slug).push(t);
    }
    const lonely = [...bySvc.values()].map((ts) => ts.filter((t) => !t.requires_quote && !t.price_is_from && t.price_cents !== null))
      .find((firm) => firm.length === 1);
    if (!lonely) skipped('a service with exactly one firm price exists to test the floor rule', 'every service has two or more');
    else {
      const r = await refuses(() => setTier(lonely[0].id, { price_is_from: true }, BY, c), 'lonely_from_price');
      check(r.refused, 'the last firm price on a service cannot become a "from" price', `${lonely[0].service_slug} · ${lonely[0].label}`);
    }
    const plural = [...bySvc.values()].map((ts) => ts.filter((t) => !t.requires_quote && !t.price_is_from && t.price_cents !== null))
      .find((firm) => firm.length >= 2);
    if (!plural) skipped('NEGATIVE CONTROL for the floor rule', 'no service has two firm prices');
    else {
      const r = await refuses(() => setTier(plural[0].id, { price_is_from: true }, BY, c), 'lonely_from_price');
      check(!r.refused, 'NEGATIVE CONTROL: with another firm price on the service it is allowed',
        'so the rule is about the service, not about the flag');
    }
  }

  // --------------------------------------------------------- C. retire, never delete
  console.log('\nC. retire, never delete');
  {
    const sold = card.packages.find((pk) => pk.status === 'active');
    const { rows: [t] } = await c.query(`select tier_id from packages where id = $1`, [sold.id]);
    if (!t?.tier_id) skipped('a tier that an active plan sells', 'no active package points at a tier');
    else {
      const r = await refuses(() => setTier(t.tier_id, { status: 'retired' }, BY, c), 'tier_has_packages');
      check(r.refused, 'a tier an active plan still sells cannot be retired out from under it', `code ${r.code}`);
    }
    const free = card.tiers.find((x) => x.status === 'active'
      && !card.packages.some((pk) => pk.status === 'active' && pk.service_slug === x.service_slug));
    if (!free) skipped('NEGATIVE CONTROL: retiring a tier no plan sells', 'every tier backs a plan');
    else {
      const r = await setTier(free.id, { status: 'retired' }, BY, c);
      check(r.tier.status === 'retired', 'NEGATIVE CONTROL: a tier no plan sells retires cleanly', `${free.service_slug} · ${free.label}`);
      const { rows: [still] } = await c.query(`select id from service_tiers where id = $1`, [free.id]);
      check(!!still, 'and the row is still there — retired, not deleted',
        'packages, invoice lines and inbound links still resolve through it');
    }
  }

  // --------------------------------------------------------- D. THE PROMISE
  console.log('\nD. raising a price does not touch an existing customer');
  const pkg = card.packages.find((x) => x.status === 'active' && x.live_customers > 0)
           ?? card.packages.find((x) => x.status === 'active');
  const { rows: liveBefore } = await c.query(
    `select id, monthly_price_cents, price_cents, package_version from subscriptions
      where package_id = $1 and state not in ('draft', 'cancelled') order by id`, [pkg.id]);

  const newMonthly = pkg.monthly_price_cents + 1500;
  const rp = await setPackagePrice(pkg.id, newMonthly, BY, c);

  check(Number(rp.package.monthly_price_cents) === newMonthly, 'the plan carries the new price', money(newMonthly));
  check(Number(rp.package.version) === Number(rp.was_version) + 1,
    'the version moved by exactly one, so the old Price is still addressable',
    `v${rp.was_version} -> v${rp.package.version}`);

  const { rows: liveAfter } = await c.query(
    `select id, monthly_price_cents, price_cents, package_version from subscriptions
      where package_id = $1 and state not in ('draft', 'cancelled') order by id`, [pkg.id]);
  if (liveBefore.length === 0) {
    skipped('an existing customer on this plan is untouched', 'nobody is on it — the strongest check has no subject');
  } else {
    check(JSON.stringify(liveBefore) === JSON.stringify(liveAfter),
      `all ${liveBefore.length} existing customer(s) still pay exactly what they were sold`,
      liveBefore.map((s) => money(s.monthly_price_cents)).join(', '));
  }

  check(Object.keys(rp.published).length === 0,
    'NEGATIVE CONTROL: nothing was published to Stripe from inside this transaction',
    'a Price for a version that is about to be rolled back would be an orphan');

  {
    const before = Number(rp.package.version);
    const again = await setPackagePrice(pkg.id, newMonthly, BY, c);
    check(again.changed.length === 0 && Number(again.package.version) === before,
      'NEGATIVE CONTROL: saving the same monthly price does not mint a version',
      'a version per click would orphan a Stripe Price per click');
  }

  await c.query('rollback');

  // --------------------------------------------------------- E. what is actually published
  /**
   * OUTSIDE THE TRANSACTION, because this is about the REAL catalog and the REAL connected
   * account. Scoped per mode and per account_id: the unscoped version of this query is a bug
   * this repo has already been bitten by, and it is what let nine of ten Prices sit orphaned
   * while every package looked published.
   */
  console.log('\nE. every live plan has a Stripe Price on the account that is actually connected');
  for (const mode of ['test', 'live']) {
    const { rows: [conn] } = await c.query(
      `select account_id from stripe_connection where livemode = $1`, [mode === 'live']);
    if (!conn?.account_id) { skipped(`${mode} mode`, `no ${mode} account is connected yet — saying so beats a vacuous pass`); continue; }
    const { rows: gap } = await c.query(
      `select p.slug, p.version from packages p
        where p.status = 'active'
          and not exists (select 1 from stripe_prices sp
                           where sp.package_id = p.id and sp.version = p.version
                             and sp.livemode = $1 and sp.account_id = $2)`,
      [mode === 'live', conn.account_id]);
    check(gap.length === 0,
      `every active plan has a ${mode} Price on ${conn.account_id}`,
      gap.length ? `missing: ${gap.map((g) => `${g.slug} v${g.version}`).join(', ')}` : `${card.packages.filter((x) => x.status === 'active').length} plans`);
  }
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  cleanupCompile(out);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail === 0 ? 0 : 1);
