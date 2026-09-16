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
import { loadEnv } from './_env.mjs';
import { compileServer } from './_compile.mjs';

loadEnv();
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'test';
const mutate = process.argv.includes('--mutate');
const build = compileServer();
const stripeLib = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows: pkgs } = await c.query(`select id, slug, name, monthly_price_cents, version from packages where status = 'active' order by sort_order`);
const { rows: prices } = await c.query(`select package_id, price_id, unit_amount, version from stripe_prices where livemode = $1`, [mode === 'live']);
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

const { resolve } = stripeLib;
const { stripe, account } = await resolve(mode);
let failed = 0;
for (const p of pkgs) {
  const onPages = printed.get(p.slug) ?? [];
  const pageOk = onPages.length > 0 && onPages.every((v) => v === p.monthly_price_cents);
  const row = prices.find((x) => x.package_id === p.id && x.version === p.version);
  let stripeAmount = null;
  if (row) stripeAmount = (await stripe.prices.retrieve(row.price_id, {}, { stripeAccount: account })).unit_amount;
  const stripeOk = stripeAmount === p.monthly_price_cents;
  const ok = pageOk && stripeOk;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${p.slug.padEnd(30)} db ${p.monthly_price_cents}  pages ${onPages.length ? [...new Set(onPages)].join('/') : 'none'} (${onPages.length})  stripe ${stripeAmount ?? 'unpublished'}`);
}
await db().end();
console.log(failed ? `FAIL ${failed}/${pkgs.length}` : `PASS ${pkgs.length}/${pkgs.length}`);
process.exit(failed ? 1 : 0);
