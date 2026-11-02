/**
 * The OKF bundle over the BUILT bytes: conformant to v0.2 section 11, complete, and in step with the rows.
 *
 *   node gates/okf.mjs
 *
 * Every concept has frontmatter with a `type`, a `generated` block and a future `stale_after`; the root index
 * carries only `okf_version`; every service has a concept and a markdown twin; every link in the bundle resolves;
 * every price in a service concept is a price in the catalog; the computation carries its section 10 contract.
 * NEGATIVE CONTROLS: a file with no type, a broken link and a wrong price must each be caught.
 */
import { readFileSync, existsSync, globSync } from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (c, n, m = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} — ${m}`); } };
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));
const FM = /^---\n([\s\S]*?)\n---\n/;
const conceptProblems = (text) => {
  const m = text.match(FM);
  if (!m) return ['no frontmatter'];
  const out = [];
  if (!/^type: \S/m.test(m[1])) out.push('no type');
  if (!/^generated: \{ by: \S+, at: \S+ \}/m.test(m[1])) out.push('no generated');
  const stale = m[1].match(/^stale_after: (\S+)/m);
  if (!stale || new Date(stale[1]).getTime() <= Date.now()) out.push('stale_after missing or past');
  if (!/^status: (draft|stable|deprecated)$/m.test(m[1])) out.push('bad status');
  return out;
};
const brokenLinks = (file, text) => [...text.replace(FM, '').matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map((x) => x[1]).filter((rel) => !existsSync(path.join(path.dirname(file), rel)));
const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}`;
const known = new Set([...catalog.tiers.map((t) => t.price_cents), ...catalog.packages.flatMap((p) => [p.monthly_price_cents, Math.round(p.monthly_price_cents / Number(p.visits_per_month))])].filter(Boolean).map(money));
const unknownPrices = (text) => [...text.matchAll(/\$\d[\d,]*(?:\.\d{2})?/g)].map((x) => x[0]).filter((p) => !known.has(p));

const root = 'dist/okf/index.md';
check(existsSync(root), 'the bundle is built');
const rootText = readFileSync(root, 'utf8');
check(rootText.match(FM)?.[1].trim() === 'okf_version: "0.2"', 'the root index carries only okf_version', rootText.slice(0, 80));
const files = globSync('dist/okf/**/*.md').filter((f) => !f.endsWith('index.md'));
check(files.length >= 5 + catalog.services.length, 'every concept is there', `${files.length} files, ${catalog.services.length} services`);
for (const f of files) { const p = conceptProblems(readFileSync(f, 'utf8')); check(!p.length, `conformant: ${f.slice(9)}`, p.join(', ')); }
for (const f of [root, ...files]) { const b = brokenLinks(f, readFileSync(f, 'utf8')); check(!b.length, `links resolve: ${f.slice(9)}`, b.join(', ')); }
const live = catalog.services.filter((s) => s.status === 'active' || !s.status);
for (const s of live) {
  const c = `dist/okf/services/${s.slug}.md`;
  check(existsSync(c) && existsSync(`dist/services/${s.slug}.md`), `${s.slug} has a concept and a twin`);
  if (existsSync(c)) { const u = unknownPrices(readFileSync(c, 'utf8')); check(!u.length, `${s.slug}: every price is in the catalog`, u.join(', ')); }
}
const comp = readFileSync('dist/okf/computations/price-a-booking.md', 'utf8');
check(/^type: Attested Computation$/m.test(comp) && /^runtime: /m.test(comp) && /^executor:/m.test(comp) && /^attester:/m.test(comp) && /receipt: \[/.test(comp), 'the computation carries its section 10 contract');
check(existsSync('dist/okf/references/attest-price.mjs') && !/\b(model|llm|openai|anthropic)\b.*fetch/i.test(readFileSync('dist/okf/references/attest-price.mjs', 'utf8')), 'the attester is served');
check(/okf\/index\.md/.test(readFileSync('dist/llms.txt', 'utf8')), 'llms.txt points at the bundle');

check(conceptProblems('---\ntitle: x\n---\n').includes('no type'), 'NEGATIVE CONTROL: a concept with no type is caught');
check(brokenLinks('dist/okf/index.md', '[x](nowhere.md)').length === 1, 'NEGATIVE CONTROL: a broken link is caught');
check(unknownPrices('$12,345').length === 1, 'NEGATIVE CONTROL: a price not in the catalog is caught');

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
