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
const { listRateCard, setTier, setPackagePrice, addTier, setBands } = await import(p('server/lib/rate-card.js'));
const { bandProblems, tierForQuantity } = await import(p('src/shared/pricing.js'));

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

      /**
       * AND RETIRING IT ACTUALLY TAKES IT OFF THE SITE. `status` was a column with a writer and
       * no reader: setTier wrote it, the column comment promised a retired tier "is not offered
       * to a new customer and is not shown on a public page", and both catalog readers selected
       * every tier regardless. The owner would have pressed Retire, watched the row change, and
       * seen the tier still on his website. This repo has shipped that shape three times.
       */
      const { rows: afterRetire } = await c.query(
        `select id from service_tiers where status = 'active' and id = $1`, [free.id]);
      check(afterRetire.length === 0,
        'a retired tier is gone from what the catalog readers select',
        'server/lib/catalog-db.ts and scripts/pull-catalog.mjs both filter status = active');
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

  // --------------------------------------------------------- D2. a new tier
  console.log('\nD2. the owner adds a tier, and a new row is held to every rule an edit is');
  {
    // A service priced by a CHOICE the customer makes, where a tier needs no number range. Until the
    // band rules (2026-09-29) this used card.tiers[0] — weekly scooping, priced by dogs — and added a
    // priced tier with no range: a tier no booking could ever land in, accepted without a word.
    const svc = card.services.find((x) => x.price_basis === 'choice' && x.status === 'active').slug;
    const added = await addTier(svc, { label: 'Gate tier — extra large', price_cents: 31_900, price_suffix: '' }, BY, c);
    check(added.tier?.status === 'active' && Number(added.tier.price_cents) === 31_900, 'a new tier is a row, active, with its price', `${svc} · ${added.tier?.label}`);
    const { rows: hist } = await c.query(`select field from catalog_changes where entity_id = $1`, [added.tier.id]);
    check(hist.some((h) => h.field === 'price_cents') && hist.some((h) => h.field === 'label'), 'adding it is in the history, like any change', hist.map((h) => h.field).join(', '));
    const again = await refuses(() => addTier(svc, { label: 'GATE TIER — EXTRA LARGE', price_cents: 100 }, BY, c), 'duplicate_label');
    check(again.refused, 'the same name twice on one service is refused', `code ${again.code}`);
    check((await refuses(() => addTier(svc, { label: '', price_cents: 100 }, BY, c), 'no_label')).refused, 'a tier with no name is refused');
    check((await refuses(() => addTier(svc, { label: 'Gate no price', price_cents: null }, BY, c), 'no_price_no_quote')).refused, 'a tier with neither a price nor the quote switch is refused');
    check((await refuses(() => addTier(svc, { label: 'Gate both', price_cents: null, requires_quote: true, price_is_from: true }, BY, c), 'quote_and_from')).refused, 'quote-only and "from" together is refused');
    check((await refuses(() => addTier(svc, { label: 'Gate cents', price_cents: 12.5 }, BY, c), 'bad_price')).refused, 'a price that is not whole cents is refused');
    check((await refuses(() => addTier('no-such-service', { label: 'x', price_cents: 100 }, BY, c), 'no_service')).refused, 'a tier on a service that does not exist is refused');
    const quoteOnly = await addTier(svc, { label: 'Gate tier — custom', price_cents: 5_000, requires_quote: true }, BY, c);
    check(quoteOnly.tier.requires_quote === true && quoteOnly.tier.price_cents === null, 'NEGATIVE CONTROL: a quote-only tier is accepted, and carries no number even if one was sent');
    const retired = await setTier(added.tier.id, { status: 'retired' }, BY, c);
    check(retired.tier.status === 'retired', 'a tier no plan sells can be taken off the site');
  }

  // --------------------------------------------------------- F. the bands
  console.log('\nF. every quantity lands in exactly one tier, and an edit that breaks that is refused');
  {
    const live = card.tiers.filter((t) => t.status === 'active');
    const bad = card.services.filter((sv) => sv.status === 'active')
      .map((sv) => [sv.slug, bandProblems(sv, live.filter((t) => t.service_slug === sv.slug))])
      .filter(([, pr]) => pr.length);
    check(bad.length === 0, 'every live service\'s bands have no overlap, no gap and no unreachable tier', bad.map(([k, pr]) => `${k}: ${pr[0]}`).join('; ') || `${card.services.filter((x) => x.status === 'active').length} services`);
    // The rule and the pricer agree: every whole number 1..1200 lands in exactly the tier the rule implies.
    const disagree = [];
    for (const sv of card.services.filter((x) => x.status === 'active' && ['dogs', 'boxes', 'units', 'levels', 'sqft'].includes(x.price_basis))) {
      const own = live.filter((t) => t.service_slug === sv.slug);
      for (let n = 1; n <= 1200; n += sv.price_basis === 'sqft' ? 1 : 1) {
        if (sv.price_basis !== 'sqft' && n > 12) break;
        if (!tierForQuantity(sv, own, n)) { disagree.push(`${sv.slug} ${n}`); break; }
      }
    }
    check(disagree.length === 0, 'every quantity a customer can type is priced by some tier (checked by the booking pricer itself)', disagree.join(', ') || 'counts 1-12, square feet 1-1200');

    const T = (label, min_qty, max_qty, requires_quote = false) => ({ label, min_qty, max_qty, requires_quote });
    check(bandProblems({ price_basis: 'dogs' }, [T('1', 1, 1), T('2-3', 2, 3), T('3+', 3, null)]).some((x) => /overlap/.test(x)), 'NEGATIVE CONTROL: an overlap is named');
    check(bandProblems({ price_basis: 'sqft' }, [T('s', null, 200), T('m', 250, 500), T('l', 500, null)]).some((x) => /gap/.test(x)), 'NEGATIVE CONTROL: a gap is named');

    const sq = card.services.find((x) => x.status === 'active' && x.price_basis === 'sqft' &&
      live.filter((t) => t.service_slug === x.slug && (t.min_qty !== null || t.max_qty !== null)).length >= 2);
    const bands = live.filter((t) => t.service_slug === sq.slug && (t.min_qty !== null || t.max_qty !== null))
      .sort((a, b) => (a.min_qty ?? -1) - (b.min_qty ?? -1));
    const [lo, hi] = bands;
    const asIs = bands.map((t) => ({ id: t.id, min_qty: t.min_qty, max_qty: t.max_qty }));
    const move = (fn) => asIs.map((b) => fn({ ...b }));
    const overlap = await refuses(() => setBands(sq.slug, move((b) => (b.id === hi.id ? { ...b, min_qty: lo.max_qty - 50 } : b)), BY, c), 'bands');
    check(overlap.refused, `an overlapping range on ${sq.slug} is refused`, `code ${overlap.code}`);
    const gap = await refuses(() => setBands(sq.slug, move((b) => (b.id === hi.id ? { ...b, min_qty: lo.max_qty + 50 } : b)), BY, c), 'bands');
    check(gap.refused, 'a gap between two ranges is refused');
    const shifted = lo.max_qty + 25;
    const okMove = await setBands(sq.slug, move((b) => (b.id === lo.id ? { ...b, max_qty: shifted } : b.id === hi.id ? { ...b, min_qty: shifted } : b)), BY, c);
    const { rows: [after] } = await c.query(`select max_qty from service_tiers where id = $1`, [lo.id]);
    check(Number(after.max_qty) === shifted && okMove.changed.length > 0, 'NEGATIVE CONTROL: moving the boundary on both tiers at once is accepted and written', `${lo.label} now ends at ${shifted}`);
    const { rows: [bandChange] } = await c.query(`select field from catalog_changes where entity_id = $1 and field = 'max_qty' order by changed_at desc limit 1`, [lo.id]);
    check(!!bandChange, 'a range change is in the history like a price change');
    const middle = await refuses(() => setTier(lo.id, { status: 'retired' }, BY, c), 'bands');
    check(middle.refused || middle.code === 'tier_has_packages', 'retiring the bottom band, which would leave small jobs with no tier, is refused', `code ${middle.code}`);
    const overlapNew = await refuses(() => addTier(sq.slug, { label: 'Gate overlapping band', price_cents: 9_900, min_qty: 1, max_qty: 50 }, BY, c), 'bands');
    check(overlapNew.refused, 'a new tier whose range overlaps an existing one is refused');
    const unreachable = await refuses(() => addTier(sq.slug, { label: 'Gate unreachable', price_cents: 9_900 }, BY, c), 'bands');
    check(unreachable.refused, 'a new priced tier with no range, which no booking could land in, is refused');
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
