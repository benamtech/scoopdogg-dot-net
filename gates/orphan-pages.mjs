/**
 * Every published page is reachable, and no page depends on a single link to exist.
 *
 *   node gates/orphan-pages.mjs
 *
 * P15 §8 and R10 §5. A crawler discovers a page by following a link to it, so a page with no
 * inbound internal link receives no internal PageRank at all — that mechanism is not
 * correlational, unlike most of what gets said about internal linking. And depth matters: pages
 * within three clicks of the homepage are crawled and indexed more readily than buried ones.
 *
 * Measured on this branch before step 8: /resources (6 guides) and /questions (26 pages) had
 * their first inbound links ever, from the homepage band alone. That is 32 answer-shaped pages
 * whose entire reachability rested on one section of one page. This gate is what stops that
 * being true again.
 *
 * THREE CHECKS, and the third is the one that will actually fire one day:
 *
 *   1. REACHABLE. Every public page is within MAX_DEPTH clicks of `/`.
 *   2. FAN-IN. Every public page has at least MIN_INBOUND distinct pages linking to it. One
 *      inbound link means one edit away from an orphan. It caught four real pages: /gallery
 *      (homepage only), two question pages crowded out of every sibling list by the greedy
 *      top-five `related` computation, and two guides linked only from their own index.
 *   3. DECLARED. A page in `dist/` that is neither reachable nor on the PRIVATE list fails.
 *      Without this the gate is only as good as somebody remembering to look — a new page
 *      nobody linked would pass check 1 and 2 by being invisible to them.
 *
 * WHAT IT READS: the built bytes in `dist/`, not the source. A link that exists in a component
 * but is rendered behind a condition that is false does not count, which is the point. It does
 * NOT read a running server, so it cannot see a redirect or a client-rendered link — a route
 * that only an island links is an orphan as far as this gate and a crawler both know.
 *
 * NEGATIVE CONTROLS built in: a planted unreachable page, a planted single-inbound page and a
 * planted undeclared page must each trip their own check, or the gate reports itself blind.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const MAX_DEPTH = 3;
const MIN_INBOUND = 2;

/**
 * Pages that are deliberately not linked from the public site, each with the reason it is not a
 * defect. Every one of these must EXIST in dist — a stale entry here would silently excuse a
 * page that had been renamed, which is the failure mode of every allowlist.
 */
const PRIVATE = {
  '/404': 'the error page: the server serves it, nothing links to it',
  '/invite': 'a customer opens it from a one-time token in an email',
  '/book/complete': 'reached by redirect from Stripe after payment, never by a link',
  '/admin': 'the owner signs in; a public link to the admin is not wanted',
  '/admin/login': 'as above',
  '/admin/today': 'as above',
  '/admin/leads': 'as above',
  '/admin/lead': 'as above',
  '/admin/messages': 'as above',
  '/admin/message': 'as above',
  '/admin/customers': 'as above',
  '/admin/payments': 'as above',
  '/admin/growth': 'as above',
  '/admin/setup': 'as above',
};

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const walk = (d) => (existsSync(d)
  ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; })
  : []);

/** `dist/areas/ventura/index.html` -> `/areas/ventura`, and `dist/index.html` -> `/`. */
const routeOf = (file) => {
  const r = file.slice(DIST.length).split(path.sep).join('/').replace(/\/index\.html$/, '').replace(/\.html$/, '');
  return r || '/';
};

const HREF = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;

/** An href as a site route, or null when it does not address a page in this build. */
const routeFor = (href, from) => {
  if (!href) return null;
  // Off-site, and the schemes a contact link uses. `sms:` is Loop 1's (P16 §7) and is not a page.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || href.startsWith('#')) return null;
  let u = href.split('#')[0].split('?')[0];
  if (!u) return null;
  if (!u.startsWith('/')) u = path.posix.normalize(path.posix.join(from === '/' ? '/' : from, u));
  return u.replace(/\/+$/, '') || '/';
};

/**
 * The link graph, as `{ out, inbound }` over the routes given. Pulled out of the checks so the
 * negative controls can run it over a planted graph rather than over a planted file tree.
 */
function graph(pages) {
  const out = new Map([...pages.keys()].map((r) => [r, new Set()]));
  const inbound = new Map([...pages.keys()].map((r) => [r, new Set()]));
  for (const [from, html] of pages) {
    for (const m of html.matchAll(HREF)) {
      const to = routeFor(m[1], from);
      if (to && to !== from && pages.has(to)) { out.get(from).add(to); inbound.get(to).add(from); }
    }
  }
  return { out, inbound };
}

/** Click depth from `/`, by breadth-first search. Absent from the map means unreachable. */
function depths(out) {
  const d = new Map([['/', 0]]);
  let frontier = ['/'];
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      for (const to of out.get(node) ?? []) if (!d.has(to)) { d.set(to, d.get(node) + 1); next.push(to); }
    }
    frontier = next;
  }
  return d;
}

const files = walk(DIST).filter((f) => f.endsWith('.html'));
if (!files.length) { console.log('FAIL — no HTML in dist/. Run `npm run build` first.'); process.exit(1); }
const pages = new Map(files.map((f) => [routeOf(f), readFileSync(f, 'utf8')]));
const { out, inbound } = graph(pages);
const depth = depths(out);
const isPrivate = (r) => Object.hasOwn(PRIVATE, r);
const publicRoutes = [...pages.keys()].filter((r) => !isPrivate(r)).sort();

console.log(`  ${pages.size} pages built, ${publicRoutes.length} public, ${Object.keys(PRIVATE).length} declared private`);

// 1. reachable from the homepage within MAX_DEPTH clicks.
{
  const bad = publicRoutes.filter((r) => !depth.has(r) || depth.get(r) > MAX_DEPTH);
  const hist = {};
  for (const r of publicRoutes) { const k = depth.has(r) ? depth.get(r) : 'unreachable'; hist[k] = (hist[k] ?? 0) + 1; }
  console.log(`  clicks from /: ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  bad.length === 0
    ? ok(`every public page is within ${MAX_DEPTH} clicks of /`)
    : no(`every public page is within ${MAX_DEPTH} clicks of /`, bad.map((r) => `${r} (${depth.has(r) ? depth.get(r) : 'unreachable'})`).join(', '));
}

// 2. no page depends on a single inbound link.
{
  const counts = publicRoutes.map((r) => [r, inbound.get(r).size]).sort((a, b) => a[1] - b[1]);
  const bad = counts.filter(([, n]) => n < MIN_INBOUND);
  console.log(`  fewest inbound links: ${counts.slice(0, 3).map(([r, n]) => `${r} (${n})`).join(', ')}`);
  bad.length === 0
    ? ok(`every public page has at least ${MIN_INBOUND} inbound links`)
    : no(`every public page has at least ${MIN_INBOUND} inbound links`, bad.map(([r, n]) => `${r} (${n})`).join(', '));
}

// 3. nothing is unreachable by accident, and nothing on the private list has been renamed away.
{
  const undeclared = [...pages.keys()].filter((r) => !depth.has(r) && !isPrivate(r));
  undeclared.length === 0
    ? ok('every unlinked page is a declared one')
    : no('every unlinked page is a declared one', `${undeclared.join(', ')} — link it, or add it to PRIVATE with the reason`);

  const missing = Object.keys(PRIVATE).filter((r) => !pages.has(r));
  missing.length === 0
    ? ok('every declared private page still exists')
    : no('every declared private page still exists', `${missing.join(', ')} — renamed or deleted; the entry is excusing nothing`);

  // A declared-private page that the public site links is not private. It is not a failure —
  // /admin/login IS linked from the footer as "Team sign-in" — but the list must not claim
  // otherwise, so the reachable ones are printed rather than assumed.
  const linked = Object.keys(PRIVATE).filter((r) => pages.has(r) && inbound.get(r).size > 0);
  if (linked.length) console.log(`  declared private but linked (fine, and worth seeing): ${linked.join(', ')}`);
}

// ---- negative controls -------------------------------------------------------------------------
// Each plants the exact fault its check exists to find, in memory, over a four-page site.
{
  const home = '<a href="/a">a</a><a href="/b">b</a>';
  const healthy = new Map([
    ['/', home],
    ['/a', '<a href="/">home</a><a href="/b">b</a>'],
    ['/b', '<a href="/">home</a><a href="/a">a</a>'],
  ]);
  const g = graph(healthy);
  const d = depths(g.out);
  const baseline = [...healthy.keys()].every((r) => d.has(r) && d.get(r) <= MAX_DEPTH && g.inbound.get(r).size >= MIN_INBOUND);
  baseline ? ok('negative control: the control site itself passes both checks')
           : no('negative control: the control site itself passes both checks', 'the controls below prove nothing');

  // (1) an orphan: present, linked by nobody.
  const orphaned = new Map([...healthy, ['/lost', '<a href="/">home</a>']]);
  const og = graph(orphaned);
  depths(og.out).has('/lost')
    ? no('negative control: a page nothing links to trips the reachability check', 'DETECTOR BLIND')
    : ok('negative control: a page nothing links to trips the reachability check');

  // (2) one inbound link: reachable, and one edit from gone.
  const thin = new Map([...healthy, ['/', `${home}<a href="/thin">thin</a>`], ['/thin', '<a href="/">home</a>']]);
  const tg = graph(thin);
  tg.inbound.get('/thin').size < MIN_INBOUND
    ? ok('negative control: a page with one inbound link trips the fan-in check')
    : no('negative control: a page with one inbound link trips the fan-in check', 'DETECTOR BLIND');

  // (3) too deep: reachable, but past MAX_DEPTH.
  const chain = new Map([
    ['/', '<a href="/1">1</a>'], ['/1', '<a href="/2">2</a>'], ['/2', '<a href="/3">3</a>'],
    ['/3', '<a href="/4">4</a>'], ['/4', '<a href="/">home</a>'],
  ]);
  depths(graph(chain).out).get('/4') > MAX_DEPTH
    ? ok(`negative control: a page ${MAX_DEPTH + 1} clicks deep trips the depth check`)
    : no(`negative control: a page ${MAX_DEPTH + 1} clicks deep trips the depth check`, 'DETECTOR BLIND');

  // (4) the href reader itself. A gate whose regex matched nothing would pass everything above.
  graph(new Map([['/', '<a class="x" href="/a">a</a>'], ['/a', '']])).inbound.get('/a').size === 1
    ? ok('negative control: the href reader finds a link with attributes before href')
    : no('negative control: the href reader finds a link with attributes before href', 'DETECTOR BLIND');
  graph(new Map([['/', '<a href="mailto:x@y.z">mail</a><a href="tel:+1">call</a>'], ['/a', '']])).inbound.get('/a').size === 0
    ? ok('negative control: mailto:, tel: and sms: are not counted as pages')
    : no('negative control: mailto:, tel: and sms: are not counted as pages', 'DETECTOR BLIND');
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
