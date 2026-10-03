/**
 * The owner edits his services, and a save can never ship a page the build gates would reject.
 *
 *   node gates/services.mjs
 *
 * A. Through server/lib/services.ts, inside a transaction that is always rolled back:
 *    - every live service's words pass the page rules today (or Josue could not save his own copy);
 *    - a typed price, a thin introduction, a duplicate search title, a service related to itself
 *      are each refused, with every problem listed;
 *    - a new service starts as a draft, cannot go on the site without a price on the rate card, and
 *      goes on once it has one;
 *    - retiring takes it out of every other service's "often paired with"; the last live service
 *      cannot be retired; nothing deletes a service.
 * B. Through the BUILT function (.vercel/output), the way a visitor meets it: a retired service's
 *    address answers a permanent redirect to /services, never a 404 — the predecessor-routes gate
 *    holds the old site's URLs, and a retired page must keep resolving (migration 003's own rule).
 *    An address that was never a service answers 404 (the negative control). B writes one
 *    gate-owned retired row to the database and deletes it again in `finally`.
 */
import pg from 'pg';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const refuses = async (fn, code) => {
  try { await fn(); return { refused: false, code: null, problems: [] }; }
  catch (e) { return { refused: e?.code === code, code: e?.code ?? e?.message, problems: e?.problems ?? [] }; }
};

const out = compileServer();
const p = (f) => path.resolve(out, f);
const Sv = await import(p('server/lib/services.js'));
const R = await import(p('server/lib/rate-card.js'));
const { serviceProblems } = await import(p('src/shared/service-rules.js'));
const { db } = await import(p('server/lib/db.js'));

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const x = path.join(d, f); return statSync(x).isDirectory() ? walk(x) : [x]; }) : []);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const BY = 'gate+services@example.invalid';
const STAMP = Date.now().toString().slice(-7);

try {
  console.log('A. the rules, through the shipped functions');
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');
  const { services } = await Sv.listServices(c);
  const live = services.filter((s) => s.status === 'active');
  const failing = live.filter((s) => serviceProblems({ ...s, h1: s.h1 ?? '', intro: s.intro ?? '', meta_title: s.meta_title ?? '', meta_description: s.meta_description ?? '' }).length);
  check(live.length > 0 && failing.length === 0, 'every live service\'s words pass the page rules, so the owner can save his own copy', failing.map((s) => s.slug).join(', ') || `${live.length} services`);

  const target = live.find((s) => s.slug === 'pressure-washing') ?? live[0];
  {
    const r = await refuses(() => Sv.saveService(c, target.slug, { intro: `${target.intro} Most patios are $45.` }, BY), 'page_rules');
    check(r.refused && r.problems.some((x) => /types a price/.test(x)), 'a price typed into the introduction is refused, with the reason', r.problems[0] ?? r.code);
    const thin = await refuses(() => Sv.saveService(c, target.slug, { intro: 'We wash it.', what_includes: ['Washing'] }, BY), 'page_rules');
    check(thin.refused && thin.problems.length >= 2, 'a thin page is refused and EVERY problem is listed at once', `${thin.problems.length} problems`);
    const other = live.find((s) => s.slug !== target.slug);
    const dupe = await refuses(() => Sv.saveService(c, target.slug, { meta_title: other.meta_title }, BY), 'page_rules');
    check(dupe.refused && dupe.problems.some((x) => /already uses/.test(x)), 'a search title another page already uses is refused');
    check((await refuses(() => Sv.saveService(c, target.slug, { related_slugs: [target.slug] }, BY), 'bad_related')).refused, 'a service related to itself is refused');
    const newIntro = `${target.intro} Edited by the services gate.`;
    const saved = await Sv.saveService(c, target.slug, { intro: newIntro, sort_order: 5 }, BY);
    check(saved.intro === newIntro && saved.sort_order === 5 && saved.updated_by === BY, 'NEGATIVE CONTROL: a sound edit is saved, with who made it');
  }

  {
    const draft = await Sv.addService(c, { name: `Gate Yard Sanitizing ${STAMP}`, kind: 'one_time', price_basis: 'choice' }, BY);
    check(draft.status === 'draft', 'a new service starts as a draft, off the site', draft.slug);
    const words = {
      h1: `Gate yard sanitizing in Ventura County ${STAMP}`,
      intro: 'A one-time sanitizing treatment for the areas your dogs use most, applied after the yard is cleared, so the smell and the germs go with the mess. We treat turf, gravel, concrete and dirt runs, and tell you what we used.',
      what_includes: ['A full pickup first', 'Enzyme treatment on every used area', 'A rinse where the surface allows it'],
      meta_title: `Gate Yard Sanitizing ${STAMP} | Scoop Dogg`,
      meta_description: 'A one-time yard sanitizing treatment for dog areas in Ventura and Santa Barbara counties: pickup, enzyme treatment and rinse.',
    };
    await Sv.saveService(c, draft.slug, words, BY);
    const noPrice = await refuses(() => Sv.saveService(c, draft.slug, { status: 'active' }, BY), 'page_rules');
    check(noPrice.refused && noPrice.problems.some((x) => /rate card/.test(x)), 'it cannot go on the site before it has a price on the rate card', noPrice.problems.at(-1));
    await R.addTier(draft.slug, { label: 'Standard yard', price_cents: 12_900 }, BY, c);
    const on = await Sv.saveService(c, draft.slug, { status: 'active', related_slugs: [target.slug] }, BY);
    check(on.status === 'active', 'NEGATIVE CONTROL: with a price, it goes on the site');
    await Sv.saveService(c, target.slug, { related_slugs: [draft.slug] }, BY);
    await Sv.saveService(c, draft.slug, { status: 'retired' }, BY);
    const { rows: [t] } = await c.query(`select related_slugs from services where slug = $1`, [target.slug]);
    check(!t.related_slugs.includes(draft.slug), 'retiring it takes it out of every other service\'s "often paired with"');
    const { rows: ev } = await c.query(`select event_type from events where subject_kind = 'service' and subject_id = md5('service:' || $1)::uuid order by seq`, [draft.slug]);
    check(ev.map((e) => e.event_type).join(',') === 'service.added,service.saved,service.saved,service.saved', 'each step is on the event spine', ev.map((e) => e.event_type).join(', '));
    const again = await refuses(() => Sv.addService(c, { name: `Gate Yard Sanitizing ${STAMP}`, kind: 'one_time', price_basis: 'choice' }, BY), 'exists');
    check(again.refused, 'a retired service\'s name cannot be taken by a new one — bring the old one back instead');
  }
  {
    await c.query(`update services set status = 'retired' where status = 'active' and slug <> $1`, [target.slug]);
    const last = await refuses(() => Sv.saveService(c, target.slug, { status: 'retired' }, BY), 'last_service');
    check(last.refused, 'the last service on the site cannot be retired');
  }
  {
    const code = [...walk('server'), ...walk('api'), ...walk('src')].filter((f) => /\.(ts|tsx|astro|mjs)$/.test(f));
    const deleters = code.filter((f) => /delete\s+from\s+services\b/i.test(readFileSync(f, 'utf8')));
    check(deleters.length === 0, 'nothing deletes a service', deleters.join(', ') || 'no `delete from services` anywhere');
  }
  await c.query('rollback');

  console.log('\nB. a retired address, through the built function');
  const FUNC = path.resolve('.vercel/output/functions/_render.func/dist/server/entry.mjs');
  if (!existsSync(FUNC)) no('the built function exists', 'run `npm run build` first');
  else {
    const slug = `amtech-gate-retired-${STAMP}`;
    await c.query(`insert into services (slug, name, status, updated_by) values ($1, 'AMTECH gate retired service', 'retired', $2)`, [slug, BY]);
    try {
      const { default: handler } = await import(pathToFileURL(FUNC).href);
      const server = http.createServer((req, res) => handler(req, res));
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${server.address().port}`;
      const r = await fetch(`${base}/services/${slug}`, { redirect: 'manual' });
      check(r.status === 301 && /\/services$/.test(r.headers.get('location') ?? ''), 'a retired service\'s address sends people to /services, permanently', `${r.status} -> ${r.headers.get('location')}`);
      const nf = await fetch(`${base}/services/never-a-service-${STAMP}`, { redirect: 'manual' });
      check(nf.status === 404, 'NEGATIVE CONTROL: an address that was never a service is a 404, not a redirect', `${nf.status}`);
      const live1 = await fetch(`${base}/services/${target.slug}`, { redirect: 'manual' });
      check(live1.status === 200, 'and a live service still renders', `${target.slug} ${live1.status}`);
      server.close();
    } finally {
      await c.query(`delete from services where slug = $1 and updated_by = $2`, [slug, BY]);
    }
  }
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  await db().end().catch(() => {});
  cleanupCompile(out);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
