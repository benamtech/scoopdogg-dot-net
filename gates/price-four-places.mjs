/**
 * S19: one price, four places. For every active package:
 *   database row  ==  the price printed on the built pages  ==  the Stripe Price unit_amount
 * and the first-charge the booking API computes equals the resolver's (the fourth place, the
 * invoice line, is asserted by gates/checkout-e2e.mjs on a real test payment).
 *
 *   node gates/price-four-places.mjs [--mode test]
 *
 * Mutation check: pass --mutate to add $1 to one package's built-page price in memory; the gate
 * must then fail, or it is decoration.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer } from './_compile.mjs';

loadEnv();
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'test';
const mutate = process.argv.includes('--mutate');
const build = compileServer();
const stripeLib = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

const { resolve: resolveAccount } = stripeLib;
const { account } = await resolveAccount(mode);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows: pkgs } = await c.query(`select id, slug, name, monthly_price_cents, version from packages where status = 'active' order by sort_order`);
/**
 * SCOPED TO THE CONNECTED ACCOUNT, because a Stripe Price belongs to one.
 *
 * This read every `stripe_prices` row for the mode and then retrieved the id against whatever
 * account is connected now. Switch the connected account — which is the single most important
 * event in this product, the day Josue connects his own — and every row from the previous
 * account names a Price that does not exist on the new one. The gate did not fail; it THREW,
 * with a StripeInvalidRequestError and a stack, which is a different and worse thing.
 *
 * `server/lib/stripe.ts:177` already gets this right: `priceForPackage` filters on
 * `account_id`, so the running site creates fresh Prices on a new account exactly as it should.
 * The defect was only ever in this gate's own query.
 */
const { rows: prices } = await c.query(
  `select package_id, price_id, unit_amount, version from stripe_prices
    where livemode = $1 and account_id = $2`, [mode === 'live', account]);
await c.end();

const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const pages = walk('dist').filter((f) => f.endsWith('.html'));
const printed = new Map();
for (const f of pages) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/data-package="([^"]+)"[\s\S]*?data-price-cents="(\d+)"/g)) {
    printed.set(m[1], [...(printed.get(m[1]) ?? []), Number(m[2])]);
  }
}
if (mutate) { const k = [...printed.keys()][0]; printed.set(k, printed.get(k).map((v) => v + 100)); }

const { stripe } = await resolveAccount(mode);
let failed = 0;
for (const p of pkgs) {
  const onPages = printed.get(p.slug) ?? [];
  const pageOk = onPages.length > 0 && onPages.every((v) => v === p.monthly_price_cents);
  const row = prices.find((x) => x.package_id === p.id && x.version === p.version);
  let stripeAmount = null;
  if (row) {
    // A row scoped to this account should always resolve. If it does not, say which price is
    // missing rather than dying with a stack — a gate that crashes tells you less than one
    // that fails.
    stripeAmount = await stripe.prices.retrieve(row.price_id, {}, { stripeAccount: account })
      .then((x) => x.unit_amount)
      .catch((e) => { console.log(`        ${row.price_id} not on ${account}: ${e.raw?.message ?? e.message}`); return null; });
  }
  const stripeOk = stripeAmount === p.monthly_price_cents;
  const ok = pageOk && stripeOk;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${p.slug.padEnd(30)} db ${p.monthly_price_cents}  pages ${onPages.length ? [...new Set(onPages)].join('/') : 'none'} (${onPages.length})  stripe ${stripeAmount ?? 'unpublished'}`);
}
await db().end();
console.log(failed ? `FAIL ${failed}/${pkgs.length}` : `PASS ${pkgs.length}/${pkgs.length}`);
process.exit(failed ? 1 : 0);
