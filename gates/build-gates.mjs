/**
 * Gates over the BUILT bytes in dist/. Run by code, never by the model that made them.
 *
 *   node gates/build-gates.mjs
 *
 * Every gate here fails the site as it exists on Netlify today. That is the point: a
 * gate that has never rejected anything protects nothing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';

const DIST = 'dist';
const allPages = globSync(`${DIST}/**/index.html`);
// /admin/* is an application, not content: no <h1>, little text, and a spinner while it
// asks the server who you are. The content gates below are about pages Google reads, so
// they run on the public set. The admin gets its own gate instead - see `admin-*`.
const isAdmin = (f) => path.relative(DIST, f).split(path.sep)[0] === 'admin';
const pages = allPages.filter((f) => !isAdmin(f));
const adminPages = allPages.filter(isAdmin);
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m) => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const textOf = (h) => strip(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const route = (f) => '/' + path.relative(DIST, path.dirname(f)).replace(/\\/g, '/');

if (!pages.length) { console.log('  FAIL  no pages in dist/ — did the build run?'); process.exit(1); }

// 1. crawlable — the defect that made all 71 live URLs serve one empty shell
{
  const bad = pages.filter((f) => {
    const h = readFileSync(f, 'utf8');
    return (h.match(/<h1/g) || []).length !== 1 || textOf(h).length < 1000;
  });
  bad.length
    ? no('crawlable', `${bad.length} page(s) missing an <h1> or under 1,000 chars: ${bad.slice(0,3).map(route)}`)
    : ok('crawlable', `${pages.length} pages, one <h1> each, all over 1,000 chars`);
}

// 2. distinct titles — the live site serves the homepage <title> on every URL
{
  const seen = new Map();
  for (const f of allPages) {
    const t = (readFileSync(f, 'utf8').match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1].trim();
    seen.set(t, [...(seen.get(t) || []), route(f)]);
  }
  const dupes = [...seen.entries()].filter(([, v]) => v.length > 1);
  dupes.length
    ? no('distinct-titles', `${dupes.length} title(s) used more than once: ${dupes[0][1].slice(0,3)}`)
    : ok('distinct-titles', `${seen.size} distinct`);
}

// 3. no database credential in any shipped byte. The live bundle leaks an anon key
//    that returns every customer record.
{
  const assets = globSync(`${DIST}/**/*.{js,html,json,txt,xml}`);
  const patterns = [
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'a JWT'],
    [/\/rest\/v1\//, 'a PostgREST path'],
    [/supabase\.co/, 'a Supabase host'],
    [/postgres(ql)?:\/\//, 'a Postgres connection string'],
    [/sk_(live|test)_[A-Za-z0-9]{10,}/, 'a Stripe secret key'],
  ];
  const hits = [];
  for (const f of assets) {
    const s = readFileSync(f, 'utf8');
    for (const [re, what] of patterns) if (re.test(s)) hits.push(`${what} in ${path.relative(DIST, f)}`);
  }
  hits.length ? no('no-browser-db-credential', hits.slice(0, 4).join('; '))
              : ok('no-browser-db-credential', `${assets.length} files scanned`);
}

// 4. one phone form and one email form. A masked tel: shipped live on another AMTECH
//    site and tap-to-call was dead on an enquiry-driven business.
for (const [scheme, label] of [['tel', 'tel'], ['mailto', 'mailto']]) {
  const found = new Set();
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(new RegExp(`href="(${scheme}:[^"]*)"`, 'g'))) {
      found.add(m[1]);
    }
  }
  found.size === 1 ? ok(`single-${label}`, [...found][0])
    : no(`single-${label}`, found.size === 0 ? 'none found' : `${found.size} forms: ${[...found].join(', ')}`);
}

// 5. content must be visible without JavaScript. The whole rebuild exists because the
//    site was invisible without it.
{
  const bad = pages.filter((f) => {
    const h = readFileSync(f, 'utf8');
    const body = h.slice(h.indexOf('<body'));
    return /class="[^"]*\bopacity-0\b/.test(body);
  });
  bad.length ? no('visible-without-js', `${bad.length} page(s) render content at opacity-0: ${bad.slice(0,3).map(route)}`)
             : ok('visible-without-js');
}

// 6. no lazy/suspense fallback captured in the HTML. Four pages on another AMTECH site
//    served "Loading…" to Google for as long as its prerenderer existed.
{
  const bad = pages.filter((f) => /<[^>]*>\s*Loading\s*(&hellip;|\.\.\.|…)?\s*</i.test(readFileSync(f, 'utf8')));
  bad.length ? no('no-loading-fallback', `${bad.length} page(s): ${bad.slice(0,3).map(route)}`)
             : ok('no-loading-fallback');
}

// 7. the sitemap must list the pages that exist. The live sitemap advertises 71 URLs,
//    every one of them a city x service page, and omits the homepage entirely.
{
  const idx = `${DIST}/sitemap-index.xml`;
  if (!existsSync(idx)) no('sitemap-present', 'no sitemap-index.xml');
  else {
    const files = globSync(`${DIST}/sitemap*.xml`);
    const locs = new Set();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) locs.add(m[1]);
    const routes = new Set(pages.map((f) => route(f) === '/.' ? '/' : route(f)));
    const missing = [...routes].filter((r) => ![...locs].some((l) => new URL(l).pathname.replace(/\/$/, '') === r.replace(/\/$/, '')));
    missing.length ? no('sitemap-complete', `${missing.length} built page(s) absent from the sitemap: ${missing.slice(0,3)}`)
                   : ok('sitemap-complete', `${routes.size} routes listed`);
  }
}

// 8. every internal link resolves to a page we actually built
{
  const routes = new Set(pages.map((f) => (route(f) === '/.' ? '/' : route(f))));
  const staticFiles = new Set(globSync(`${DIST}/**/*`).map((f) => '/' + path.relative(DIST, f).replace(/\\/g, '/')));
  const broken = new Map();
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1].replace(/\/$/, '') || '/';
      if (routes.has(href) || staticFiles.has(m[1]) || staticFiles.has(href)) continue;
      broken.set(href, (broken.get(href) || 0) + 1);
    }
  }
  broken.size
    ? no('links-resolve', `${broken.size} internal target(s) 404: ${[...broken.keys()].slice(0, 6).join(', ')}`)
    : ok('links-resolve');
}

// 9. every referenced image must exist AND contain something. 2dogjumping.png shipped
//    on the live site as a truncated, fully transparent file used in three places, so
//    three image slots rendered as empty space. Nothing caught it because "the file is
//    there" and "the file shows something" are different facts.
{
  const refs = new Set();
  for (const f of pages) {
    for (const m of readFileSync(f, 'utf8').matchAll(/src="(\/[^"]+\.(?:png|jpe?g|webp|svg|gif))"/gi)) refs.add(m[1]);
  }
  const broken = [];
  for (const r of refs) {
    const p = path.join(DIST, r);
    if (!existsSync(p)) { broken.push(`${r} missing`); continue; }
    const size = readFileSync(p).length;
    if (size < 5000 && !r.endsWith('.svg')) broken.push(`${r} is only ${size}B, probably blank`);
  }
  broken.length ? no('images-have-content', broken.slice(0, 4).join('; '))
                : ok('images-have-content', `${refs.size} referenced images`);
}

// 10. no single image over 1MB. Four 7.4MB PNGs were being served to every visitor,
//     ~30MB of images on a site people open on a phone.
{
  const imgs = globSync(`${DIST}/**/*.{png,jpg,jpeg,webp,gif}`);
  const heavy = imgs.filter((f) => readFileSync(f).length > 1_000_000);
  heavy.length
    ? no('image-weight', `${heavy.length} image(s) over 1MB: ${heavy.slice(0,3).map((f) => path.relative(DIST, f))}`)
    : ok('image-weight', `${imgs.length} images, largest ${Math.max(0, ...imgs.map((f) => readFileSync(f).length)) / 1024 | 0}KB`);
}

// 11. the lead path renders. This is the one that actually cost us: src/lib/supabase.ts
//     threw at module load when its env vars were absent, so the booking island never
//     mounted and /book shipped with no form at all — while every other gate stayed
//     green. A site that cannot take a booking is worse than the one it replaced.
{
  const checks = [
    ['/book', ['Where&#x27;s your yard?', 'Ventura'], 'booking wizard step 1'],
    ['/contact', ['<textarea', '<input'], 'contact form fields'],
    ['/', ['Book in 60 Seconds'], 'homepage booking call to action'],
  ];
  for (const [route, needles, what] of checks) {
    const f = path.join(DIST, route === '/' ? '' : route, 'index.html');
    if (!existsSync(f)) { no('lead-path-renders', `${route} was not built`); continue; }
    const h = readFileSync(f, 'utf8');
    const missing = needles.filter((n) => !h.includes(n));
    missing.length
      ? no('lead-path-renders', `${route} is missing ${what} (${missing.join(', ')})`)
      : ok('lead-path-renders', `${route} — ${what}`);
  }
}

// 12. no island may throw at module load. A retired module that throws on import is
//     correct for the admin and fatal if it reaches a public bundle.
{
  const bundles = globSync(`${DIST}/_astro/*.js`);
  const poisoned = bundles.filter((f) => readFileSync(f, 'utf8').includes('is retired. Use /api/lead'));
  poisoned.length
    ? no('no-throwing-import', `${poisoned.length} public bundle(s) import a retired module: ${poisoned.map((f) => path.basename(f))}`)
    : ok('no-throwing-import', `${bundles.length} bundles`);
}

// 13. no third-party media. 25 images were hotlinked from a free image host and two
//     videos from imgur and pexels. If any of those hosts prunes a file, a section of a
//     client's live site becomes an empty box, and nobody finds out from a deploy log.
{
  const hosts = new Set();
  for (const f of [...pages, ...globSync(`${DIST}/_astro/*.js`)]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)[^"'`\s]*\.(?:mp4|webm|png|jpe?g|webp|gif|avif)/gi)) {
      hosts.add(m[1].toLowerCase());
    }
  }
  const allowed = new Set(['scoopdogg.net', 'www.scoopdogg.net']);
  const foreign = [...hosts].filter((h) => !allowed.has(h));
  foreign.length
    ? no('no-third-party-media', `served from: ${foreign.join(', ')}`)
    : ok('no-third-party-media', 'all media is first-party');
}

// 14. the admin must be noindex, absent from the sitemap, and behind robots. Three
//     separate mistakes, each of which has put a client's private screens in a search
//     index somewhere.
{
  if (!adminPages.length) {
    no('admin-exists', 'no /admin pages were built — the old site had six and losing them is a regression');
  } else {
    const notNoindex = adminPages.filter((f) => !/name="robots"\s+content="noindex/.test(readFileSync(f, 'utf8')));
    notNoindex.length
      ? no('admin-noindex', `${notNoindex.length} admin page(s) are indexable: ${notNoindex.map(route)}`)
      : ok('admin-noindex', `${adminPages.length} admin pages`);

    const sm = globSync(`${DIST}/sitemap*.xml`);
    const locs = new Set();
    for (const f of sm) for (const m of readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) locs.add(new URL(m[1]).pathname);
    const leaked = [...locs].filter((l) => l.startsWith('/admin'));
    leaked.length ? no('admin-not-in-sitemap', `${leaked.length} admin URL(s) advertised: ${leaked.slice(0,3)}`)
                  : ok('admin-not-in-sitemap');

    const robots = readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
    /Disallow:\s*\/admin/.test(robots) ? ok('admin-disallowed-in-robots')
                                       : no('admin-disallowed-in-robots', 'robots.txt does not disallow /admin');

    // and the screens must actually render something, not a blank island
    const empty = adminPages.filter((f) => {
      const h = readFileSync(f, 'utf8');
      const body = h.slice(h.indexOf('<body'));
      return body.replace(/<[^>]+>/g, '').trim().length < 20 && !/astro-island/.test(body);
    });
    empty.length ? no('admin-renders', `${empty.length} admin page(s) emitted no server HTML: ${empty.map(route)}`)
                 : ok('admin-renders', 'server HTML present on every admin page');
  }
}

// 15. framed art must not be floated over a card. /img/5878.jpg is a complete
//     illustrated scene with its own border, not a transparent cut-out, and it shipped
//     `absolute -top-36 -right-6` — a rectangle pasted over the card, covering its own
//     heading. Ben reported it twice, because the fix landed on /services and the
//     homepage had a second card renderer that never saw it.
//
//     The rule is about the artwork, not the file: an <img> is only allowed to be
//     absolutely positioned if its source actually has transparent pixels for the page
//     to show through. Measured with sharp, never inferred from the file extension —
//     a PNG with an alpha channel can still be fully opaque.
{
  const cache = new Map();
  async function hasTransparency(src) {
    if (cache.has(src)) return cache.get(src);
    const file = path.join(DIST, src);
    let answer;
    if (!existsSync(file)) answer = null;                       // gate 9 owns missing files
    else if (/\.svg$/i.test(src)) answer = true;                // vector, transparent by default
    else {
      const meta = await sharp(file).metadata();
      if (!meta.hasAlpha) answer = false;
      else {
        const stats = await sharp(file).stats();
        const alpha = stats.channels[stats.channels.length - 1];
        answer = alpha.min < 255;
      }
    }
    cache.set(src, answer);
    return answer;
  }

  const floated = new Map();   // src -> routes where it is absolutely positioned
  for (const f of allPages) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const src = (tag.match(/\bsrc="(\/[^"]+)"/) || [])[1];
      const cls = (tag.match(/\bclass="([^"]*)"/) || [, ''])[1];
      if (!src || !/(^|\s|:)absolute(\s|$)/.test(cls)) continue;
      floated.set(src, [...(floated.get(src) || []), route(f)]);
    }
  }

  const offenders = [];
  for (const [src, routes] of floated) {
    const transparent = await hasTransparency(src);
    if (transparent === false) offenders.push(`${src} is opaque and floated on ${routes.slice(0, 3).join(', ')}`);
  }
  offenders.length
    ? no('framed-art-not-floated', offenders.join('; '))
    : ok('framed-art-not-floated', `${floated.size} floated image(s), all with transparent pixels`);
}

// 16. nothing the predecessor served may 404. Every other gate here tests what the new
//     site HAS. None of them tested what the old one SERVED, and the rebuild silently
//     dropped six admin routes, the /areas/westlake 301 that lived in public/_redirects,
//     and 71 sitemap URLs. Each was found by hand, one at a time.
//
//     The old route table is read from gates/predecessor-routes.json, frozen out of git
//     by scripts/build-predecessor-routes.mjs — the Vercel build runs from an uploaded
//     tarball with no git history, so a gate that shells out to git runs nowhere that
//     matters. Where git IS available the snapshot is re-derived from its own commit and
//     must match exactly, so it cannot quietly rot.
//
//     Every concrete path either builds in dist/ or is carried by a vercel.json redirect
//     or rewrite whose DESTINATION builds. A 301 into a 404 is not a save.
{
  const SNAPSHOT = 'gates/predecessor-routes.json';
  if (!existsSync(SNAPSHOT)) {
    no('predecessor-routes-still-served', `${SNAPSHOT} is missing — run node scripts/build-predecessor-routes.mjs`);
  } else {
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

    // the snapshot must still say what its own commit says
    let derived = null;
    try {
      execFileSync('git', ['cat-file', '-e', `${snap.commit}^{commit}`], { stdio: 'ignore' });
      derived = (await import('../scripts/build-predecessor-routes.mjs')).derive(snap.commit);
    } catch { /* no git, or the commit is not in this clone: the Vercel build, and fine */ }
    if (!derived) ok('predecessor-snapshot-current', `git unavailable here; trusting ${SNAPSHOT} at ${snap.commit.slice(0, 8)}`);
    else {
      const keys = ['staticRoutes', 'dynamicRoutes', 'redirectSources', 'sitemapPaths'];
      const drifted = keys.filter((k) => JSON.stringify(derived[k]) !== JSON.stringify(snap[k]));
      drifted.length
        ? no('predecessor-snapshot-current', `${SNAPSHOT} disagrees with ${snap.commit.slice(0, 8)} on ${drifted.join(', ')} — re-run scripts/build-predecessor-routes.mjs`)
        : ok('predecessor-snapshot-current', `matches ${snap.commit.slice(0, 8)}`);
    }

    // vercel.json, minus anything conditional on the request (the www -> apex redirect
    // matches /:path* and would otherwise declare every path covered).
    const vercel = existsSync('vercel.json') ? JSON.parse(readFileSync('vercel.json', 'utf8')) : {};
    const rules = [...(vercel.redirects || []), ...(vercel.rewrites || [])].filter((r) => !r.has && !r.missing);

    // Vercel source syntax: `:name`, `:name(alternation|here)`, `:name*`. The literal
    // parts are escaped and the parameter parts are not — escaping the whole string
    // first turns `(a|b)` into a match for the literal characters `a|b`.
    const lit = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const compile = (source) => {
      const names = [];
      const token = /:(\w+)(?:\(([^)]*)\))?(\*)?/g;
      let out = '', last = 0, m;
      while ((m = token.exec(source))) {
        out += lit(source.slice(last, m.index));
        names.push(m[1]);
        out += m[2] !== undefined ? `(${m[2]})` : m[3] ? '(.*)' : '([^/]+)';
        last = m.index + m[0].length;
      }
      out += lit(source.slice(last));
      return { re: new RegExp(`^${out}$`), names };
    };
    const compiled = rules.map((r) => ({ ...r, ...compile(r.source) }));

    const built = new Set(allPages.map((f) => {
      const r = '/' + path.relative(DIST, path.dirname(f)).replace(/\\/g, '/');
      return r === '/.' ? '/' : r;
    }));
    const files = new Set(globSync(`${DIST}/**/*`).map((f) => '/' + path.relative(DIST, f).replace(/\\/g, '/')));

    const resolve = (p, depth = 0) => {
      if (built.has(p) || files.has(p)) return true;
      if (depth > 3) return false;
      for (const r of compiled) {
        const m = p.match(r.re);
        if (!m) continue;
        let dest = r.destination;
        r.names.forEach((n, i) => { dest = dest.split(`:${n}*`).join(m[i + 1]).split(`:${n}`).join(m[i + 1]); });
        if (!dest.startsWith('/')) return true;            // off-site, not ours to build
        return resolve(dest.replace(/\/$/, '') || '/', depth + 1);
      }
      return false;
    };

    const wanted = new Map();
    const want = (p, why) => wanted.set(p.replace(/\/$/, '') || '/', why);
    for (const p of snap.staticRoutes) want(p, 'App.tsx route');
    for (const p of snap.redirectSources) want(p, 'public/_redirects');
    for (const p of snap.sitemapPaths) want(p, 'sitemap.xml');

    const dead = [...wanted].filter(([p]) => !resolve(p));
    dead.length
      ? no('predecessor-routes-still-served', `${dead.length} path(s) the old site served now 404: ${dead.slice(0, 5).map(([p, why]) => `${p} (${why})`).join(', ')}`)
      : ok('predecessor-routes-still-served', `${wanted.size} paths from App.tsx, _redirects and the old sitemap all build or redirect`);

    // A dynamic route is a shape, not a path. Each one must still have somewhere to land.
    const orphanShapes = snap.dynamicRoutes.filter((shape) => {
      const shapeRe = new RegExp('^' + lit(shape).replace(/:(\w+)/g, '[^/]+') + '$');
      if ([...built].some((p) => shapeRe.test(p))) return false;                       // built out as real pages
      if ([...wanted.keys()].some((p) => shapeRe.test(p) && resolve(p))) return false; // carried by a rule
      return !resolve(shape.replace(/:(\w+)/g, 'probe-value'));                        // or by a catch-all
    });
    orphanShapes.length
      ? no('predecessor-dynamic-routes', `${orphanShapes.length} dynamic route(s) from App.tsx land nowhere: ${orphanShapes.join(', ')}`)
      : ok('predecessor-dynamic-routes', `${snap.dynamicRoutes.length} dynamic shapes`);
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
