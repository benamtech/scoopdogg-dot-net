/**
 * Derive monthly packages from the published rate card, and write the arithmetic beside
 * every number.
 *
 *   node scripts/seed-packages.mjs [--dry-run]
 *
 * Ben, 2026-09-16: monthly packages for scooping and yard work, built "using ... all the
 * pricing info on the site". So nothing here invents a price. A package's monthly price is
 * the published per-visit price times the visits in an average month, rounded to the
 * dollar, and the `derivation` column says exactly that in words.
 *
 * WHICH FACTOR. `billing.monthly_factor` is "52/12" (4.33 visits: a customer pays for the
 * visits they get across a year) unless Ben sets "4". Changing the setting and re-running
 * this re-derives every row that is still `derived_from_published`.
 *
 * IT NEVER TOUCHES A CONFIRMED ROW. Once somebody with authority has confirmed a price,
 * that price is theirs; a re-derivation that overwrote it would be the script setting a
 * price, which AGENTS.md rule 4 forbids.
 */
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const DRY = process.argv.includes('--dry-run');

// Which tiers become monthly packages, and how often a visit happens. Only services whose
// published price is per visit or per week can be a package; a one-time job is not.
const PLAN = [
  { service: 'weekly-pooper-scooper-service', family: 'scoop', name: 'Weekly poop scooping', frequency: 'weekly', featured: '2 dogs' },
  { service: 'weekly-turf-maintenance', family: 'turf', name: 'Weekly turf maintenance', frequency: 'weekly' },
  { service: 'weekly-yard-maintenance', family: 'yard', name: 'Weekly yard maintenance', frequency: 'weekly' },
  { service: 'kitty-litter-exchange', family: 'litter', name: 'Weekly litter box service', frequency: 'weekly' },
];

const c = new pg.Client({
  host: process.env.PGHOST, user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, ssl: { rejectUnauthorized: true },
});
await c.connect();

const { rows: [factorRow] } = await c.query(`select value from settings where key = 'billing.monthly_factor'`);
const factorName = factorRow?.value === '4' ? '4' : '52/12';
const visits = factorName === '4' ? 4 : 52 / 12;

const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const slugify = (s) => s.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let written = 0, skipped = 0;
const out = [];
for (const p of PLAN) {
  const { rows: tiers } = await c.query(
    `select id, label, price_cents, price_suffix, price_is_from, requires_quote, sort_order
       from service_tiers where service_slug = $1 order by sort_order`, [p.service]);
  for (const t of tiers) {
    if (t.requires_quote || !t.price_cents) continue; // a quote is not a package
    const raw = (t.price_cents / 100) * visits;
    const monthly = Math.round(raw) * 100;
    const short = t.label.replace(/\s*\(.*\)\s*/, '').trim();
    const slug = `${p.family}-${p.frequency}-${slugify(short)}`;
    const derivation =
      `${t.price_is_from ? 'From ' : ''}${dollars(t.price_cents)}${t.price_suffix || '/visit'} published` +
      ` x ${factorName === '4' ? '4 visits' : '52 visits / 12 months (4.33)'} = $${raw.toFixed(2)}` +
      ` -> ${dollars(monthly)}/month` +
      (t.price_is_from ? '. The published price is a FLOOR ("from"), so this monthly number is a decision, not arithmetic.' : '');
    out.push({ slug, name: `${p.name} · ${short}`, monthly: dollars(monthly), derivation });
    if (DRY) continue;
    const res = await c.query(
      `insert into packages (slug, service_slug, tier_id, name, short_label, frequency, visits_per_month,
                             monthly_price_cents, derivation, source, featured, sort_order, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'derived_from_published',$10,$11,'active')
       on conflict (slug) do update set
         tier_id = excluded.tier_id, name = excluded.name, short_label = excluded.short_label,
         visits_per_month = excluded.visits_per_month, monthly_price_cents = excluded.monthly_price_cents,
         derivation = excluded.derivation, featured = excluded.featured, sort_order = excluded.sort_order
       where packages.source = 'derived_from_published'
       returning slug`,
      [slug, p.service, t.id, `${p.name} · ${short}`, short, p.frequency, visits.toFixed(2), monthly, derivation,
       p.featured === short, PLAN.indexOf(p) * 100 + t.sort_order]);
    if (res.rowCount) written++; else skipped++;
  }
}
await c.end();
for (const o of out) console.log(`${o.slug.padEnd(34)} ${o.monthly.padEnd(6)} ${o.derivation}`);
console.log(`\nfactor ${factorName}; ${DRY ? 'dry run, nothing written' : `${written} written, ${skipped} confirmed rows left untouched`}`);
