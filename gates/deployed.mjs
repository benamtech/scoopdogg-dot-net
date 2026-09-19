/**
 * The gates that need a DEPLOYED site rather than a local build.
 *
 *   npm run gates:deployed -- https://scoopdogg-git-<branch>-<team>.vercel.app
 *   SD_DEPLOY_URL=https://... npm run gates:deployed
 *
 * WHY THIS FILE EXISTS. `admin-e2e.mjs` and `admin-browser.mjs` both take a URL as argv[2], so
 * neither could sit in an npm script, so neither sat anywhere — and on 2026-09-19 an audit found
 * eight gate files that appeared in no npm script at all. One of them (`lighthouse`) had been red
 * for days against its own threshold and one (`demo-banner-on-pages`) had been red since step 4
 * added a route. An unknown gate is where the red ones hide, and "documented in SPEC.md" is not
 * a command anybody runs.
 *
 * These two are promotion gates, not build gates: they prove the admin against a real deployment
 * — the API path and then the screens, because a `client:load` island that throws on first
 * render still serves identical server HTML, so curl reads it as fine while the owner sees a
 * blank page.
 *
 * They need SESSION_SECRET, which `admin-e2e.mjs` reads from the brain's sealed env itself. This
 * runner never touches a secret and never prints one.
 */
import { execFileSync } from 'node:child_process';

const url = process.argv[2] || process.env.SD_DEPLOY_URL;
if (!url) {
  console.error('usage: npm run gates:deployed -- <deployment-url>   (or set SD_DEPLOY_URL)');
  process.exit(1);
}
if (!/^https:\/\/[^/]+\./.test(url)) {
  console.error(`refusing to run against ${url} — a deployment URL is expected, over https`);
  process.exit(1);
}

const GATES = [
  ['admin-e2e.mjs', 'the sign-in path and the role boundary, over HTTP'],
  ['admin-browser.mjs', 'every admin screen rendered in a real browser, pageerror listener attached first'],
];

let failed = 0;
for (const [file, why] of GATES) {
  console.log(`\n=== ${file} — ${why}`);
  try {
    // One at a time, on purpose: two browser jobs at once fake failures (SPEC §5).
    execFileSync('node', [`gates/${file}`, url], { stdio: 'inherit' });
  } catch {
    failed++;
    console.log(`  FAILED: ${file}`);
  }
}

console.log(`\nRESULT: ${GATES.length - failed} passed, ${failed} failed against ${url}`);
process.exit(failed === 0 ? 0 : 1);
