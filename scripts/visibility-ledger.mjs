/**
 * One command, one page of numbers: what the site IS, and whether anybody arrived.
 *
 *   node scripts/visibility-ledger.mjs [--base https://scoopdogg.net] [--json] [--days 30]
 *
 * R8 §G specified this and it was never built. Its rule is the whole design: it prints ONLY what
 * it can measure from bytes and rows. Where a line cannot be measured it says so and says why,
 * because a dashboard that fills a gap with a plausible number is worse than one with a hole —
 * the hole gets fixed.
 *
 * THREE OF R8's NINE LINES ARE NOT MEASURABLE AS SPECIFIED, measured 2026-09-26, and each says
 * so rather than being quietly dropped:
 *
 *   sitemap "newest <date>"  @astrojs/sitemap emits <lastmod> only when given a `lastmod` option
 *                            or a `serialize` function, and astro.config.mjs passes neither. The
 *                            built sitemap contains zero <lastmod> elements.
 *   indexnow                 There is no IndexNow key, no submission code and no receipt store
 *                            anywhere in the repo. Not "0 submitted" — not set up.
 *   crawler access           Needs a live origin. Without --base there is nothing to ask.
 *
 * IT IS A REPORT, NOT A GATE, with two exceptions R8 names as failures: an orphan page, and a
 * robots.txt that points somewhere the sitemap is not. Those exit non-zero. Everything else is
 * a number to read.
 *
 * AND IT CARRIES ITS OWN FALSIFIER. R8 §G: "if page count grows and booking-intent sessions do
 * not rise for eight weeks, the pages are not answering anything anybody asks." A falsifier that
 * needs history is not a falsifier unless something keeps the history, so every run writes a
 * receipt to output/visibility/ and every run compares itself to the oldest receipt inside the
 * window. Nothing else on this project keeps that series.
 *
 * WHERE A GATE ALREADY MEASURES A LINE, THIS RUNS THE GATE rather than reimplementing it.
 * A ledger with its own copy of the similarity maths would eventually disagree with the gate
 * that fails the build, and the disagreement would be invisible. If a gate's output cannot be
 * parsed the line reads "unreadable" and names the gate.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
loadEnv();

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const BASE = arg('--base', '');
const DAYS = Number(arg('--days', '30'));
const JSON_OUT = process.argv.includes('--json');
const DIST = 'dist';
const RECEIPTS = 'output/visibility';

const out = {};
const notes = [];
let failures = 0;
const fail = (line, why) => { failures++; notes.push(`FAIL  ${line}: ${why}`); };

const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc); else acc.push(f);
  }
  return acc;
};

if (!existsSync(DIST)) { console.error('no dist/ — run `npm run build` first'); process.exit(2); }
const html = walk(DIST).filter((f) => f.endsWith('.html'));
const routeOf = (f) => '/' + path.relative(DIST, f).replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');

// ---- pages by family -------------------------------------------------------------------------
const publicHtml = html.filter((f) => !routeOf(f).startsWith('/admin'));
const family = {};
for (const f of publicHtml) {
  const seg = routeOf(f).split('/')[1] || '(root)';
  const fam = ['questions', 'areas', 'services', 'resources'].includes(seg) ? seg : 'other';
  family[fam] = (family[fam] ?? 0) + 1;
}
out.pages = { total: html.length, public: publicHtml.length, family };

// ---- schema: does every indexable page carry parseable JSON-LD? -------------------------------
let ld = 0, ldBad = 0, noindex = 0, noLd = [];
for (const f of publicHtml) {
  const body = readFileSync(f, 'utf8');
  if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(body)) { noindex++; continue; }
  const blocks = [...body.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (!blocks.length) { noLd.push(routeOf(f)); continue; }
  for (const b of blocks) {
    try { JSON.parse(b[1]); ld++; } catch { ldBad++; }
  }
}
out.schema = { blocks: ld, unparseable: ldBad, indexable_without_any: noLd, noindex_pages: noindex };

// ---- sitemap, and whether robots points at what exists ----------------------------------------
const sitemapFiles = walk(DIST).filter((f) => /sitemap.*\.xml$/.test(f));
const locs = sitemapFiles.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))
  .filter((u) => !/sitemap.*\.xml$/.test(u));
const lastmods = sitemapFiles.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]));
const robots = existsSync(`${DIST}/robots.txt`) ? readFileSync(`${DIST}/robots.txt`, 'utf8') : '';
const declared = (/^Sitemap:\s*(\S+)/mi.exec(robots) ?? [])[1] ?? null;
const declaredPath = declared ? new URL(declared).pathname : null;
const sitemapExists = declaredPath ? existsSync(path.join(DIST, declaredPath)) : false;
out.sitemap = {
  urls: locs.length,
  newest: lastmods.length ? lastmods.sort().at(-1) : null,
  newest_unmeasurable: lastmods.length ? null : 'astro.config.mjs passes @astrojs/sitemap no lastmod or serialize option, so the built sitemap carries no <lastmod>',
  robots_declares: declared,
  robots_points_at_a_real_file: sitemapExists,
};
if (declaredPath && !sitemapExists) fail('sitemap', `robots.txt points at ${declaredPath} and dist has no such file`);

// A noindex page advertised in the sitemap is a contradiction the site is telling crawlers.
const noindexRoutes = new Set(publicHtml
  .filter((f) => /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(readFileSync(f, 'utf8')))
  .map(routeOf));
out.sitemap.advertises_noindex = locs.map((u) => new URL(u).pathname.replace(/\/$/, '') || '/')
  .filter((p) => noindexRoutes.has(p));

// ---- orphans and similarity: run the gate that owns each, never a second copy -----------------
const gateLine = (gate, re, label) => {
  try {
    const text = execFileSync('node', [`gates/${gate}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = re.exec(text);
    return m ? m.slice(1) : { unreadable: `gates/${gate} ran but printed no line matching ${label}` };
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    const m = re.exec(text);
    if (m) return m.slice(1);
    return { unreadable: `gates/${gate} exited ${e.status ?? '?'} and printed no line matching ${label}` };
  }
};
const orphanNums = gateLine('orphan-pages.mjs', /(\d+) pages built, (\d+) public, (\d+) declared private/, 'pages built');
const orphanFail = gateLine('orphan-pages.mjs', /orphan(?:ed)? pages?:?\s*(\d+)/i, 'orphan count');
out.orphans = Array.isArray(orphanNums)
  ? { pages_built: Number(orphanNums[0]), public: Number(orphanNums[1]), private: Number(orphanNums[2]),
      orphaned: Array.isArray(orphanFail) ? Number(orphanFail[0]) : 0 }
  : orphanNums;
if (out.orphans.orphaned > 0) fail('orphans', `${out.orphans.orphaned} page(s) reachable by fewer than the minimum inbound links`);

const q = gateLine('question-pages.mjs', /nearest-sibling similarity: median ([\d.]+), p90 ([\d.]+), max ([\d.]+) \(limit ([\d.]+)\)/, 'sibling similarity');
out.question_similarity = Array.isArray(q)
  ? { median: Number(q[0]), p90: Number(q[1]), max: Number(q[2]), limit: Number(q[3]) } : q;
const cp = gateLine('city-pages.mjs', /unique content: worst ([\d.]+)% \(([a-z-]+)\), best ([\d.]+)% \(([a-z-]+)\), floor (\d+)%/, 'city uniqueness');
out.city_uniqueness = Array.isArray(cp)
  ? { worst_pct: Number(cp[0]), worst: cp[1], best_pct: Number(cp[2]), best: cp[3], floor_pct: Number(cp[4]) } : cp;

// ---- IndexNow: not zero, absent ---------------------------------------------------------------
// EXCLUDING THIS FILE, which is the whole reason the first run reported IndexNow as present:
// a scanner that reads its own source finds every word it is looking for.
const SELF = path.resolve('scripts/visibility-ledger.mjs');
const repoText = ['src', 'server', 'api', 'scripts', 'public'].filter(existsSync)
  .flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx|mjs|js|astro|txt|json)$/.test(f))
  .filter((f) => path.resolve(f) !== SELF)
  .some((f) => /indexnow/i.test(readFileSync(f, 'utf8')));
out.indexnow = repoText ? { present: true } : { present: false, why: 'no IndexNow key, no submission code and no receipt store exists in this repo — not "0 submitted"' };

// ---- crawler access: only with a live origin ---------------------------------------------------
const CRAWLERS = ['OAI-SearchBot', 'GPTBot', 'PerplexityBot', 'ClaudeBot', 'Googlebot'];
out.crawler_access = {};
if (!BASE) {
  out.crawler_access = { unmeasured: 'pass --base <origin> — a crawler check needs something to ask' };
} else {
  for (const ua of CRAWLERS) {
    try {
      const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', '-A', ua, BASE], { encoding: 'utf8' });
      out.crawler_access[ua] = Number(code);
    } catch { out.crawler_access[ua] = null; }
  }
  // robots.txt naming them is a separate question from the origin answering them.
  out.crawler_access.robots_names_any = CRAWLERS.some((c) => new RegExp(c, 'i').test(robots));
}

// ---- the funnel, and whose it is ---------------------------------------------------------------
/**
 * ONE AUTHOR FOR "WHICH SOURCES ARE OURS". server/lib/funnel.ts exports VERIFIER_SOURCES, but a
 * .ts module cannot be imported here (its own imports use emitted .js specifiers), and a copy of
 * the list in this file would drift the first time somebody added a verifier. So the literal is
 * READ OUT of that file, and a parse failure is fatal rather than a silent fallback to a guess —
 * a ledger quietly filtering by the wrong list would overstate real demand, which is the one
 * direction this report must never be wrong in.
 */
const funnelSrc = readFileSync('server/lib/funnel.ts', 'utf8');
const vsMatch = /export const VERIFIER_SOURCES = \[([^\]]*)\]/.exec(funnelSrc);
if (!vsMatch) { console.error('could not read VERIFIER_SOURCES out of server/lib/funnel.ts — refusing to guess which sessions are ours'); process.exit(2); }
const ours = [...vsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query('begin transaction read only');
  const { rows: bySource } = await c.query(
    `select coalesce(source, '(direct)') as source, count(*)::int as sessions,
            count(subscription_id)::int as booked
       from funnel_sessions where started_at >= now() - ($1 || ' days')::interval
      group by 1 order by 2 desc`, [DAYS]);
  const { rows: [tot] } = await c.query(
    `select count(*)::int as starts, count(subscription_id)::int as booked
       from funnel_sessions where started_at >= now() - ($1 || ' days')::interval
        and (source is null or source <> all ($2::text[]))`, [DAYS, ours]);
  /**
   * PRICED IS COUNTED OVER THE SAME POPULATION AS STARTS, using server/lib/growth.ts's own
   * definition (`price_cents_seen is not null`). The first version of this counted distinct
   * subjects on `booking.priced` events with no source filter at all, against a starts figure
   * that had one — so it printed starts 2, priced 59, conversion 100%. Three numbers from two
   * populations are not a funnel.
   */
  const { rows: [priced] } = await c.query(
    `select count(*) filter (where price_cents_seen is not null)::int as n
       from funnel_sessions where started_at >= now() - ($1 || ' days')::interval
        and (source is null or source <> all ($2::text[]))`, [DAYS, ours]);

  /**
   * THE HEADLINE NUMBER IS BROKEN OUT BY SOURCE ON PURPOSE. Applying the growth board's own
   * verifier filter leaves a number that still is not real demand: a click on a Vercel preview
   * is AMTECH looking at its own work, and it is indistinguishable from a customer in the
   * totals. Measured 2026-09-26, every session this table has ever held was ours. The owner
   * reads this line, so it shows him where each one came from rather than one confident figure.
   */
  out.funnel = {
    days: DAYS,
    starts_excluding_our_verifiers: tot.starts,
    priced: priced.n,
    booked: tot.booked,
    conversion_pct: tot.starts ? Number(((tot.booked / tot.starts) * 100).toFixed(1)) : null,
    by_source: bySource,
  };
} finally { await c.query('rollback').catch(() => {}); await c.end().catch(() => {}); }

// ---- the falsifier: pages up, intent flat ------------------------------------------------------
mkdirSync(RECEIPTS, { recursive: true });
const stamp = new Date().toISOString();
const receipt = { at: stamp, pages: out.pages.public, starts: out.funnel.starts_excluding_our_verifiers, booked: out.funnel.booked };
const past = readdirSync(RECEIPTS).filter((f) => f.endsWith('.json'))
  .map((f) => { try { return JSON.parse(readFileSync(path.join(RECEIPTS, f), 'utf8')); } catch { return null; } })
  .filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
const EIGHT_WEEKS_MS = 56 * 24 * 3600 * 1000;
const oldest = past.find((r) => Date.parse(stamp) - Date.parse(r.at) >= EIGHT_WEEKS_MS);
out.falsifier = oldest
  ? {
      since: oldest.at,
      pages_then: oldest.pages, pages_now: receipt.pages,
      starts_then: oldest.starts, starts_now: receipt.starts,
      verdict: receipt.pages > oldest.pages && receipt.starts <= oldest.starts
        ? 'PAGES GREW AND BOOKING INTENT DID NOT. R8 §G: the pages are not answering anything anybody asks.'
        : 'not triggered',
    }
  : { unmeasured: `needs a receipt at least eight weeks old; ${past.length} receipt(s) on file, oldest ${past[0]?.at ?? 'none'}` };
writeFileSync(path.join(RECEIPTS, `${stamp.slice(0, 10)}.json`), JSON.stringify(receipt, null, 2) + '\n');

// ---- print --------------------------------------------------------------------------------------
if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); }
else {
  const row = (k, v) => console.log(`  ${k.padEnd(24)} ${v}`);
  const fam = Object.entries(out.pages.family).filter(([k]) => k !== 'other').map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`\nVISIBILITY LEDGER — ${stamp}\n`);
  row('pages by family', `${fam} · other ${out.pages.family.other ?? 0}   (${out.pages.public} public of ${out.pages.total})`);
  row('orphans', out.orphans.unreadable ?? `${out.orphans.orphaned}   (${out.orphans.public} public, ${out.orphans.private} declared private)`);
  row('sibling similarity', out.question_similarity.unreadable ?? `max ${out.question_similarity.max} (limit ${out.question_similarity.limit}), median ${out.question_similarity.median}`);
  row('city uniqueness', out.city_uniqueness.unreadable ?? `worst ${out.city_uniqueness.worst_pct}% (${out.city_uniqueness.worst}), floor ${out.city_uniqueness.floor_pct}%`);
  row('schema', `${out.schema.blocks} blocks parsed, ${out.schema.unparseable} unparseable, ${out.schema.indexable_without_any.length} indexable page(s) with none`);
  row('sitemap', `${out.sitemap.urls} urls · robots -> ${out.sitemap.robots_declares ?? 'nothing'} ${out.sitemap.robots_points_at_a_real_file ? '(exists)' : '(MISSING)'}`);
  row('  newest', out.sitemap.newest ?? `unmeasurable — ${out.sitemap.newest_unmeasurable}`);
  if (out.sitemap.advertises_noindex.length) row('  advertises noindex', out.sitemap.advertises_noindex.join(', '));
  row('indexnow', out.indexnow.present ? 'present' : `not set up — ${out.indexnow.why}`);
  row('crawler access', out.crawler_access.unmeasured ?? CRAWLERS.map((u) => `${u} ${out.crawler_access[u] ?? 'err'}`).join(' · '));
  row(`funnel (${DAYS}d)`, `starts ${out.funnel.starts_excluding_our_verifiers} · priced ${out.funnel.priced} · booked ${out.funnel.booked} · conversion ${out.funnel.conversion_pct ?? '—'}%`);
  console.log(`  ${'  every source, unfiltered'.padEnd(24)} (the line above excludes ${ours.join(' and ')})`);
  for (const s of out.funnel.by_source) row(`  from ${s.source}`, `${s.sessions} session(s), ${s.booked} booked`);
  row('falsifier (8wk)', out.falsifier.unmeasured ?? out.falsifier.verdict);
  console.log('');
  console.log('  Not measurable here, and not guessed: rankings, AI citations, share of voice.');
  console.log('  Those need Search Console (not yet verified for this domain) or a paid tool.');
  for (const n of notes) console.log(`  ${n}`);
  console.log('');
}
process.exit(failures === 0 ? 0 : 1);
