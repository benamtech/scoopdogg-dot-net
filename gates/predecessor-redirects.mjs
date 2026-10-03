/**
 * Every URL the old site published still resolves, and a redirect never throws away the city.
 *
 *   node gates/predecessor-redirects.mjs
 *
 * R8. `gates/predecessor-routes.json` is the Bolt site's own route table and sitemap, generated
 * from its source at 91cf745. Those URLs are what Google, Ahrefs and every inbound link still
 * hold. A migration does not get to decide they stop existing; it only gets to decide where they
 * go. So this gate reads the predecessor table, resolves each path through `vercel.json`'s
 * redirect rules exactly as Vercel would, and requires two things of the answer.
 *
 * WHAT WAS MEASURED, 2026-09-22, on production:
 *
 *   71 of the old sitemap's URLs — every /areas/<city>/<service> page — returned 308 to
 *   /services/<service>. The status was right and the destination was wrong. "weekly pooper
 *   scooper service in Agoura Hills" landed on a page that never says Agoura Hills. The one
 *   signal the URL carried, the only one those 71 pages had that /services/<service> does not,
 *   was discarded on the way.
 *
 *   That is not a small loss. In the largest published study of local rankings (3,269 businesses
 *   across four sectors) proximity decides 55% of positions 1-21 and 36% of the top ten. The
 *   locality-bearing page on this site is /areas/<city>: it carries the city name, five to seven
 *   named neighborhoods, the route days, local context and city FAQs, and it links all eleven
 *   services and /book. Sending the old URL there keeps the locality and costs one click.
 *
 * WHY NOT REBUILD THE 176 PAGES INSTEAD. Because we would have to invent them. A real
 * city x service page needs something true about that service in that city, and nothing on
 * disk knows it — `gates/city-pages.mjs` already requires 20% of a city page's shingles to
 * appear on no other city page, and 176 pages generated from one template would fail it, as
 * they should. R8 A1: doorway abuse is defined by funnelling, not by volume. A page family
 * nobody can write honestly is a page family that should be a redirect.
 *
 * TWO CHECKS:
 *
 *   1. RESOLVES. Every predecessor path, after redirects, names a page that exists in dist/.
 *   2. KEEPS THE CITY. A source containing /areas/<city>/ must resolve to a destination that
 *      still contains <city>. This is the check that was missing, and the one that fired.
 *
 * NEGATIVE CONTROLS: a planted rule pointing at a page that does not exist must trip check 1, a
 * planted rule that drops the city must trip check 2, and the pattern compiler must be shown to
 * match something — a compiler that matched nothing would pass every check above in silence.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  ok    ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m) => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

/**
 * Compile one Vercel `source` into a matcher. Vercel's syntax here is `:name`, `:name(regex)`
 * and `:name*`; the site uses the first two plus `/:path*`. Anything this does not understand
 * becomes a rule that matches nothing, and the negative control below is what stops that being
 * a silent pass.
 */
function compile(source) {
  const names = [];
  let re = '';
  const parts = source.split(/(:[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\*?)/g);
  for (const part of parts) {
    if (!part) continue;
    const m = /^:([A-Za-z_][A-Za-z0-9_]*)(\(([^)]*)\))?(\*)?$/.exec(part);
    if (!m) { re += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    names.push(m[1]);
    re += m[4] ? '(.*)' : `(${m[3] ?? '[^/]+'})`;
  }
  return { re: new RegExp(`^${re}$`), names };
}

/** Resolve a path through an ordered rule list, following at most `hops` redirects. */
function resolve(p, rules, hops = 5) {
  for (let i = 0; i < hops; i++) {
    let moved = false;
    for (const r of rules) {
      if (r.has) continue;                       // host-conditional rules (www -> apex) are not path rules
      const { re, names } = compile(r.source);
      const m = re.exec(p);
      if (!m) continue;
      let dest = r.destination;
      names.forEach((n, k) => { dest = dest.replaceAll(`:${n}*`, m[k + 1] ?? '').replaceAll(`:${n}`, m[k + 1] ?? ''); });
      p = dest; moved = true; break;
    }
    if (!moved) return p;
  }
  return p;
}

/** Does this path name a page in dist/? cleanUrls is on, so /a/b is dist/a/b/index.html. */
function exists(p) {
  const clean = p.split('#')[0].split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  if (!clean) return existsSync(path.join(DIST, 'index.html'));
  return existsSync(path.join(DIST, clean, 'index.html'))
      || existsSync(path.join(DIST, `${clean}.html`))
      || existsSync(path.join(DIST, clean));
}

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const rules = vercel.redirects ?? [];
const pre = JSON.parse(readFileSync('gates/predecessor-routes.json', 'utf8'));

// Admin routes are deliberately not public pages; the predecessor table lists them because the
// old SPA routed them client-side. They are excluded by name rather than by pattern so that a
// new /admin route cannot quietly join the exclusion.
const SKIP = new Set(['/admin', '/admin/leads', '/admin/login', '/admin/messages']);

const paths = [...pre.staticRoutes, ...pre.sitemapPaths, ...pre.redirectSources]
  .filter((p) => !SKIP.has(p));

// ---- 1. every predecessor URL resolves to something that exists ---------------------------
{
  const dead = [];
  for (const p of new Set(paths)) {
    const dest = resolve(p, rules);
    if (!exists(dest)) dead.push(`${p} -> ${dest}`);
  }
  dead.length ? no('every predecessor URL resolves to a page that exists',
                   `${dead.length} do not: ${dead.slice(0, 3).join('; ')}`)
              : ok('every predecessor URL resolves to a page that exists', `${new Set(paths).size} checked`);
}

// ---- 2. a redirect never throws away the city ---------------------------------------------
{
  const lost = [];
  let withCity = 0;
  for (const p of new Set(paths)) {
    const m = /^\/areas\/([a-z0-9-]+)\//.exec(p);
    if (!m) continue;
    withCity++;
    const dest = resolve(p, rules);
    if (!dest.includes(m[1])) lost.push(`${p} -> ${dest}`);
  }
  if (!withCity) no('a redirect keeps the city', 'no /areas/<city>/... paths found — the check ran on nothing');
  else lost.length ? no('a redirect keeps the city', `${lost.length} of ${withCity} lose it: ${lost.slice(0, 3).join('; ')}`)
                   : ok('a redirect keeps the city', `${withCity} city URLs, all land on their own city page`);
}

// ---- negative controls ---------------------------------------------------------------------
{
  const cityRule = rules.find((r) => /\/areas\/:city/.test(r.source) && /:service/.test(r.source));
  if (!cityRule) no('negative control: the city x service rule is present to test', 'rule not found in vercel.json');
  else {
    const one = '/areas/agoura-hills/weekly-pooper-scooper-service';

    // (a) the compiler matches the real rule at all. Without this every check above passes by
    //     matching nothing and falling through to the unchanged path.
    compile(cityRule.source).re.test(one)
      ? ok('negative control: the pattern compiler matches the real rule')
      : no('negative control: the pattern compiler matches the real rule', 'DETECTOR BLIND');

    // (b) the destination this gate exists to reject.
    const dropped = [{ ...cityRule, destination: '/services/:service' }];
    resolve(one, dropped).includes('agoura-hills')
      ? no('negative control: a destination that drops the city is caught', 'DETECTOR BLIND')
      : ok('negative control: a destination that drops the city is caught', '/services/:service would fail check 2');

    // (c) a destination that does not exist in dist.
    const nowhere = [{ ...cityRule, destination: '/areas/:city/nothing-here' }];
    exists(resolve(one, nowhere))
      ? no('negative control: a destination missing from dist is caught', 'DETECTOR BLIND')
      : ok('negative control: a destination missing from dist is caught');
  }
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
