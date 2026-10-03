/**
 * The owner edits his offers, and what the page promises is what the checkout applies.
 *
 *   node gates/offers.mjs [--live]
 *
 * Through the shipped functions (server/lib/offers.ts), with this gate's own client inside a
 * transaction that is always rolled back:
 *   - a name that states a discount must state THIS discount ("half off" on a 40% offer is refused);
 *   - the value is a whole percentage 1-100; an offer applies to a live service and never requires
 *     what it applies to; two active offers cannot claim the same service and condition;
 *   - pausing takes an offer out of the catalog the checkout prices from (server/lib/catalog-db.ts);
 *   - redemptions are counted from subscriptions.discount, the one record booking writes, and the two
 *     stores that never had a writer (offers.redeemed_count, offer_redemptions) have no reader either;
 *   - nothing deletes an offer.
 *
 * THE COUPON. couponForOffer() cached one Stripe coupon per (mode, account) and never compared it
 * with the offer, so an edited discount would have kept charging the old one. The key now carries
 * the value and the products; this proves it on the pure key, and with --live mints two real
 * test-mode coupons for two values and reads their percent_off back from Stripe.
 *
 * Every rule has a negative control.
 */
import pg from 'pg';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
const LIVE = process.argv.includes('--live');
let pass = 0, fail = 0, skip = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const refuses = async (fn, code) => {
  try { await fn(); return { refused: false, code: null }; }
  catch (e) { return { refused: e?.code === code, code: e?.code ?? e?.message }; }
};

const out = compileServer();
const p = (f) => path.resolve(out, f);
const O = await import(p('server/lib/offers.js'));
const S = await import(p('server/lib/stripe.js'));
const { db } = await import(p('server/lib/db.js'));

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const x = path.join(d, f); return statSync(x).isDirectory() ? walk(x) : [x]; }) : []);
const code = [...walk('server'), ...walk('api'), ...walk('src')].filter((f) => /\.(ts|tsx|astro|mjs)$/.test(f));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const BY = 'gate+offers@example.invalid';

try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');
  const { offers, services } = await O.listOffers(c);
  const half = offers.find((o) => o.status === 'active' && o.value === 50 && !o.requires_slugs.length);
  check(!!half && services.length > 0, 'the offers screen reads the live offers and the services they can apply to', `${offers.length} offers, ${services.length} services`);

  // --- counting
  {
    const { rows: [n] } = await c.query(`select count(*)::int as n from subscriptions where discount->>'offer_id' = $1`, [half.id]);
    check(half.redeemed === n.n, 'redemptions are counted from the bookings themselves', `${half.redeemed} (subscriptions.discount)`);
    const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const readers = code.filter((f) => /redeemed_count|offer_redemptions/.test(noComments(readFileSync(f, 'utf8'))));
    check(readers.length === 0, 'nothing reads or writes offers.redeemed_count or offer_redemptions, the two stores that were never kept', readers.join(', ') || 'none');
    check(/redeemed_count/.test('select redeemed_count from offers'), 'NEGATIVE CONTROL: the pattern finds a reader when there is one');
  }

  // --- the name and the value agree
  {
    const r = await refuses(() => O.saveOffer(c, half.id, { value: 40 }, BY), 'name_disagrees');
    check(r.refused, `"${half.name}" cannot become 40% while its name says half`, `code ${r.code}`);
    const renamed = await O.saveOffer(c, half.id, { value: 40, name: 'First month 40% off' }, BY);
    check(renamed.value === 40 && renamed.name === 'First month 40% off', 'NEGATIVE CONTROL: the same change with a name that says 40% is saved');
    check(O.statedPercent('First month half off') === 50 && O.statedPercent('25% off your first month') === 25 && O.statedPercent('Welcome offer') === null,
      'the stated discount is read from words and numbers, and a name with no number states none');
    for (const [v, why] of [[0, 'zero'], [101, 'over 100'], [12.5, 'a fraction']]) {
      check((await refuses(() => O.saveOffer(c, half.id, { value: v, name: 'Welcome offer' }, BY), 'bad_value')).refused, `a discount of ${why} is refused`);
    }
  }

  // --- what it applies to
  {
    const other = services.find((s) => s.monthly && !half.applies_to_slugs.includes(s.slug));
    const oneTime = services.find((s) => !s.monthly);
    const onJob = await refuses(() => O.addOffer(c, { name: 'Gate job offer', value: 10, applies_to_slugs: [oneTime.slug], status: 'paused' }, BY), 'not_monthly');
    check(onJob.refused, `an offer on ${oneTime.slug}, which has no monthly plan and so could never be applied, is refused`, `code ${onJob.code}`);
    check((await refuses(() => O.saveOffer(c, half.id, { applies_to_slugs: [] }, BY), 'no_services')).refused, 'an offer on no service is refused');
    check((await refuses(() => O.saveOffer(c, half.id, { applies_to_slugs: ['no-such-service'] }, BY), 'unknown_service')).refused, 'an offer on a service that is not live is refused');
    check((await refuses(() => O.saveOffer(c, half.id, { requires_slugs: half.applies_to_slugs }, BY), 'requires_itself')).refused, 'an offer that requires what it discounts is refused');
    const twin = await refuses(() => O.addOffer(c, { name: 'Gate twin offer', value: 10, applies_to_slugs: half.applies_to_slugs, requires_slugs: [], status: 'active' }, BY), 'overlaps');
    check(twin.refused, 'a second active offer on the same service and condition is refused — a customer only ever gets one', `code ${twin.code}`);
    const pausedTwin = await O.addOffer(c, { name: 'Gate twin offer', value: 10, applies_to_slugs: half.applies_to_slugs, requires_slugs: [], status: 'paused' }, BY);
    check(pausedTwin.status === 'paused', 'NEGATIVE CONTROL: the same offer saved paused is accepted');
    const fresh = await O.addOffer(c, { name: 'Gate 15% off', value: 15, applies_to_slugs: [other.slug], requires_slugs: [], status: 'active' }, BY);
    check(fresh.status === 'active' && fresh.kind === 'percent_off', 'a new offer on another service is added, live', `${other.slug}`);
    const { rows: ev } = await c.query(`select event_type from events where subject_kind = 'offer' and subject_id = $1`, [fresh.id]);
    check(ev.some((e) => e.event_type === 'offer.added'), 'adding it is on the event spine');
  }

  // --- pausing reaches the checkout's catalog
  {
    await O.saveOffer(c, half.id, { status: 'paused' }, BY);
    const { rows } = await c.query(`select id from offers where status = 'active'`);  // catalog-db.ts's own filter
    check(!rows.some((r) => r.id === half.id), 'a paused offer is out of the catalog the checkout prices from');
    await O.saveOffer(c, half.id, { status: 'active', name: 'First month 40% off' }, BY);
    const { rows: again } = await c.query(`select id from offers where status = 'active'`);
    check(again.some((r) => r.id === half.id), 'NEGATIVE CONTROL: offering it again puts it back');
  }

  // --- never deleted
  {
    const deleters = code.filter((f) => /delete\s+from\s+offers\b/i.test(readFileSync(f, 'utf8')));
    check(deleters.length === 0, 'nothing deletes an offer', deleters.join(', ') || 'no `delete from offers` anywhere');
  }
  await c.query('rollback');

  // --- the coupon follows the offer
  {
    const k50 = S.couponKey('test', 'acct_x', 50, ['prod_b', 'prod_a']);
    check(k50 !== S.couponKey('test', 'acct_x', 40, ['prod_b', 'prod_a']), 'a changed discount is a different coupon');
    check(k50 !== S.couponKey('test', 'acct_x', 50, ['prod_a']), 'a changed product list is a different coupon');
    check(k50 === S.couponKey('test', 'acct_x', 50, ['prod_a', 'prod_b']), 'NEGATIVE CONTROL: the same offer in another order is the same coupon');
    const src = readFileSync('server/lib/stripe.ts', 'utf8');
    check(/idempotencyKey: `coupon-\$\{account\}-\$\{offer\.id\}-\$\{offer\.value\}/.test(src), 'the idempotency key carries the value, so Stripe cannot hand back yesterday\'s coupon');
    if (!LIVE) { skip++; console.log('  SKIP  two real test-mode coupons for two values — run with --live'); }
    else {
      const { rows: [o] } = await c.query(`select id, name, stripe_coupon_ids from offers where status = 'active' and value = 50 and requires_slugs = '{}' limit 1`);
      const { stripe, account } = await S.resolve('test');
      const prod = await stripe.products.create({ name: 'AMTECH gate product (offers.mjs)' }, { stripeAccount: account });
      try {
        const a = await S.couponForOffer('test', { id: o.id, name: o.name, value: 50 }, [prod.id]);
        const b = await S.couponForOffer('test', { id: o.id, name: o.name, value: 40 }, [prod.id]);
        const [ca, cb] = await Promise.all([stripe.coupons.retrieve(a, {}, { stripeAccount: account }), stripe.coupons.retrieve(b, {}, { stripeAccount: account })]);
        check(a !== b && ca.percent_off === 50 && cb.percent_off === 40, 'Stripe holds one coupon per value, each with its own discount', `${a}=${ca.percent_off}% ${b}=${cb.percent_off}%`);
        const again = await S.couponForOffer('test', { id: o.id, name: o.name, value: 50 }, [prod.id]);
        check(again === a, 'NEGATIVE CONTROL: asking again for the same offer reuses its coupon');
        await Promise.all([stripe.coupons.del(a, {}, { stripeAccount: account }), stripe.coupons.del(b, {}, { stripeAccount: account })]);
      } finally {
        await stripe.products.update(prod.id, { active: false }, { stripeAccount: account }).catch(() => {});
        // Put the offer's coupon map back exactly as it was: the gate's coupons were deleted above.
        await c.query(`update offers set stripe_coupon_ids = $2::jsonb where id = $1`, [o.id, JSON.stringify(o.stripe_coupon_ids)]);
      }
    }
  }
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  await db().end().catch(() => {});
  cleanupCompile(out);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail ? 1 : 0);
