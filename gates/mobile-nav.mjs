/**
 * The mobile menu opens, STAYS open, and its links go where they say.
 *
 *   node gates/mobile-nav.mjs
 *
 * WHY THIS GATE EXISTS, and it is the clearest case on this project for writing one. The two
 * commits on `main` that this branch does not have are both this:
 *
 *   ddeddcd  "Fix mobile menu closing immediately"
 *   8fcdb06  "Fix city navigation from Areas menu"
 *
 * Two hotfixes, on production, on consecutive minutes, on the same component — the phone
 * navigation of a business whose customers are overwhelmingly on phones. Nothing could see either
 * one. `gates/orphan-pages.mjs` reads the built bytes and proved all 17 links are THERE; a link
 * that is in the HTML and unreachable with a thumb passes it, which is exactly what shipped.
 *
 * NEITHER BUG CAN RECUR IN THE SAME WAY, and that is not the reason to skip the gate. Both were
 * react-router faults in `src/components/Nav.tsx`: `useEffect(..., [location])` re-ran on every
 * render because `location` is a fresh object each time, and one `dropdownRef` was shared by the
 * desktop and mobile dropdowns so the mobile one's own outside-click handler closed it. This
 * branch deleted that component. `src/components/site/Header.astro` is static markup and one
 * vanilla toggle with no router, no refs, no outside-click handler and no dropdown.
 *
 * So this gate is not defending against those two lines. It is defending against the CLASS: this
 * business has now shipped a phone menu that did not work twice, and the only reason anyone found
 * out was somebody picking up a phone. A gate is cheaper than that.
 *
 * IT SERVES `dist/` ITSELF rather than needing `scripts/dev-server.mjs` on a port, because
 * everything it touches is static and a gate that needs a second process running is a gate that
 * gets skipped. It is a browser job, so it belongs in `npm run gates:browser` and must not run
 * beside Lighthouse (SPEC §5: two browser jobs at once fake failures).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadEnv } from '../scripts/_env.mjs';

const DIST = 'dist';
const PHONE = { width: 390, height: 844 };

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.avif': 'image/avif', '.mp4': 'video/mp4' };

/** cleanUrls: /areas/ventura is dist/areas/ventura/index.html, same as Vercel serves it. */
async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '').replace(/\/$/, '');
  for (const p of [path.join(DIST, clean, 'index.html'), path.join(DIST, `${clean}.html`), path.join(DIST, clean),
                   path.join(DIST, 'index.html')]) {
    if (!clean && !p.endsWith('index.html')) continue;
    try { const s = await stat(p); if (s.isFile()) return p; } catch { /* next */ }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/');
  if (!file) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  res.end(await readFile(file));
});
/**
 * `node gates/mobile-nav.mjs <deployment-url>` walks a DEPLOYMENT instead of dist/. The two
 * hotfixes this gate exists for were found on production, not in a build folder, so the version
 * of this check that matters most is the one run against what Vercel actually serves. Behind
 * Vercel Authentication the preview token rides only requests to the deployment's own origin —
 * set globally it would also hit the font CDN, whose CORS preflight rejects it and looks exactly
 * like a page defect (the same reason gates/admin-browser.mjs routes it this way).
 */
loadEnv();
const REMOTE = (process.argv[2] || '').replace(/\/$/, '');
if (!REMOTE) await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = REMOTE || `http://127.0.0.1:${server.address().port}`;
console.log(`  walking ${REMOTE ? `the deployment ${REMOTE}` : 'dist/ on a local server'}`);
const token = process.env.VERCEL_OIDC_TOKEN;

const browser = await chromium.launch();
const newPage = async (opts) => {
  const pg = await browser.newPage(opts);
  if (REMOTE && token) {
    const origin = new URL(REMOTE).origin;
    await pg.route('**/*', (route) => {
      const u = route.request().url();
      route.continue(u.startsWith(origin) ? { headers: { ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': token } } : {});
    });
  }
  return pg;
};
try {
  const page = await newPage({ viewport: PHONE });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });

  const toggle = page.locator('[data-menu-toggle]');
  const menu = page.locator('[data-menu]');

  // ---- the detector can see a closed menu. Without this every "visible" below is free.
  check(await toggle.count() === 1, 'the phone has exactly one menu button', `${await toggle.count()} found`);
  check(await toggle.isVisible(), 'and it is visible at 390px');
  check(await page.locator('nav[aria-label="Main"]').isVisible() === false,
    'the desktop nav is not shown on a phone', 'or the button would be decoration');
  check(await menu.isVisible() === false, 'the menu starts closed',
    'this is the control: if it were always "visible" the open check below would prove nothing');
  check(await toggle.getAttribute('aria-expanded') === 'false', 'and says so to a screen reader');

  // ---- it opens
  await toggle.click();
  check(await menu.isVisible(), 'tapping the button opens the menu');
  check(await toggle.getAttribute('aria-expanded') === 'true', 'aria-expanded follows');
  check(await page.locator('html').evaluate((el) => el.classList.contains('overflow-hidden')),
    'the page behind it stops scrolling');
  check(await toggle.locator('[data-icon-close]').isVisible()
     && await toggle.locator('[data-icon-open]').isVisible() === false,
    'and the hamburger becomes a close icon');

  // ---- IT STAYS OPEN. This is commit ddeddcd, measured rather than assumed.
  await page.waitForTimeout(600);
  check(await menu.isVisible(), 'it is still open 600ms later',
    'main shipped a menu that closed itself immediately — an effect re-running on every render');
  check(errors.length === 0, 'and no JavaScript error was thrown', errors.slice(0, 2).join(' | '));

  // ---- every link in it is reachable with a thumb
  const links = menu.locator('a[href^="/"]');
  const n = await links.count();
  check(n >= 8, 'the menu carries the whole navigation', `${n} links`);
  const tooSmall = [];
  const hrefs = [];
  for (let i = 0; i < n; i++) {
    const l = links.nth(i);
    hrefs.push(await l.getAttribute('href'));
    const box = await l.boundingBox();
    // 44px is the long-standing platform minimum for a touch target on both iOS and Android.
    if (!box || box.height < 44) tooSmall.push(`${await l.innerText()} ${box ? `${Math.round(box.height)}px` : 'not visible'}`);
  }
  check(tooSmall.length === 0, 'every menu link is at least 44px tall', tooSmall.slice(0, 3).join(', '));

  /**
   * ---- GETTING TO A CITY FROM THE MENU. This is commit 8fcdb06, walked.
   *
   * The first version of this check demanded a `/areas/<city>` link IN the menu and failed. That
   * was the check being wrong, not the site: this menu is FLAT — eleven links, `/areas` among
   * them, no nested dropdown — and a flat menu is exactly why the bug `main` hotfixed cannot
   * recur, because that bug was one `dropdownRef` shared by a desktop and a mobile dropdown.
   *
   * So the check is the user's path and not a particular markup: open the menu, tap Areas, tap a
   * city, arrive. Two taps instead of one, and both of them have to work.
   */
  const areasHref = hrefs.find((h) => h === '/areas');
  check(!!areasHref, 'the menu reaches the areas index', areasHref ?? `not among ${hrefs.length} links`);
  if (areasHref) {
    await menu.locator('a[href="/areas"]').click();
    await page.waitForLoadState('load');
    check(new URL(page.url()).pathname === '/areas', 'tapping it arrives there', new URL(page.url()).pathname);
    // A full page load rebuilds the header, so the menu is closed again — the property that makes
    // the react-router bug structurally impossible here.
    check(await page.locator('[data-menu]').isVisible() === false,
      'and the menu is closed on the new page', 'a full page load, not a client-side route');

    const cities = page.locator('a[href^="/areas/"]');
    const cityCount = await cities.count();
    check(cityCount >= 10, 'the areas page lists the towns', `${cityCount} city links`);
    const firstCity = await cities.first().getAttribute('href');
    await cities.first().click();
    await page.waitForLoadState('load');
    check(new URL(page.url()).pathname === firstCity, 'and tapping one arrives on that city page',
      `${new URL(page.url()).pathname} — main shipped a version where this did nothing`);
    const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim();
    check(h1.length > 0 && /[A-Za-z]/.test(h1), 'which renders a heading naming the place', h1.slice(0, 60));
  }

  // ---- and it closes
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const t2 = page.locator('[data-menu-toggle]');
  await t2.click();
  check(await page.locator('[data-menu]').isVisible(), 'it opens again');
  await t2.click();
  check(await page.locator('[data-menu]').isVisible() === false, 'and the button closes it');
  check(await page.locator('html').evaluate((el) => !el.classList.contains('overflow-hidden')),
    'and scrolling comes back', 'a locked page behind a closed menu is the worse half of this bug');

  // ---- negative control: the selectors are not matching everything
  console.log('\nnegative controls');
  check(await page.locator('[data-menu-toggle-nonexistent]').count() === 0,
    'a made-up attribute selector matches nothing', 'so the counts above are real');
  const wide = await newPage({ viewport: { width: 1280, height: 900 } });
  await wide.goto(`${BASE}/`, { waitUntil: 'load' });
  check(await wide.locator('[data-menu-toggle]').isVisible() === false,
    'the menu button is hidden on a desktop', 'the viewport is actually being applied');
  check(await wide.locator('nav[aria-label="Main"]').isVisible(),
    'and the desktop nav appears there', 'or both checks would pass on a blank page');
  await wide.close();
} catch (e) {
  no('the gate ran to the end', String(e.message ?? e));
} finally {
  await browser.close().catch(() => {});
  server.close();
}

console.log(`\n${fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`}`);
process.exit(fail ? 1 : 0);
