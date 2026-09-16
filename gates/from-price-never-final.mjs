/**
 * e-from-never-final: a tier Josue publishes as a floor ("From $40/visit", "$50+") is never
 * printed on a built page as a final price.
 *
 *   node gates/from-price-never-final.mjs
 *
 * For every price_is_from tier, every occurrence of its amount+suffix in the built text must be
 * preceded by "From". A planted page with the bare price must fail (negative control).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));
const froms = catalog.tiers.filter((t) => t.price_is_from && t.price_cents);
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

function bare(body, t) {
  const amount = money(t.price_cents).replace('$', '\\$');
  const re = new RegExp(`(.{0,6})${amount}\\s*${(t.price_suffix || '').replace('/', '\\/')}(?![\\d])`, 'gi');
  return [...body.matchAll(re)].filter((m) => !/from\s*$/i.test(m[1])).length;
}

const planted = text(`<p>Small yard ${money(froms[0].price_cents)}${froms[0].price_suffix}</p>`);
const controlFires = bare(planted, froms[0]) > 0;
let hits = 0;
const pages = walk('dist').filter((f) => f.endsWith('.html') && !f.includes('/admin/'));
for (const f of pages) {
  const body = text(readFileSync(f, 'utf8'));
  for (const t of froms) {
    // Only the tier's own service pages and pricing can print a per-visit price with its suffix.
    const n = t.price_suffix ? bare(body, t) : 0;
    if (n) { hits += n; console.log(`  FAIL  ${path.relative('dist', f)} prints ${money(t.price_cents)}${t.price_suffix} without "From" (${t.label})`); }
  }
}
console.log(`  negative control: ${controlFires ? 'fires on a planted bare price' : 'BLIND'}; ${froms.length} floor tiers; ${pages.length} pages`);
console.log(controlFires && hits === 0 ? `PASS ${froms.length}/${froms.length}` : 'FAIL');
process.exit(controlFires && hits === 0 ? 0 : 1);
