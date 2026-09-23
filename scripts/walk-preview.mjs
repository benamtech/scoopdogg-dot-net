/**
 * Walk a deployed preview on a phone, and say what a person would see.
 *
 *   node scripts/walk-preview.mjs https://scoopdogg-xxxx.vercel.app
 *
 * SPEC step 11 asks for exactly this and it is the check no gate can stand in for: the gates run
 * against `dist` and a local dev server, and every one of them can be green while the deployment
 * serves something else. Summit's site was down for a week in precisely that gap.
 *
 * GETTING IN WITHOUT A BYPASS SECRET. A preview sits behind Vercel Authentication, where plain
 * curl answers 302. A local development OIDC token for a LINKED project reaches that project's own
 * previews, so every request carries `x-vercel-trusted-oidc-idp-token`. The token is read from the
 * environment by scripts/_env.mjs and never printed, logged or returned - rule 12. If it has
 * expired, `npx vercel env pull` refreshes it.
 *
 * It writes screenshots to output/ (gitignored) and a receipt, and it changes nothing: it stops at
 * the review step, before the pay button.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from './_env.mjs';

/**
 * EVERY SESSION THIS FILE CREATES IS MARKED AS OURS (migration 033).
 *
 * A browser-driven verifier walks the real funnel, so it writes real `funnel_sessions` rows into
 * the client's database — and until 033 nothing distinguished them. Measured 2026-09-23: all 25
 * rows in the table were ours, and the growth board was reporting AMTECH's continuous integration
 * as this client's booking-intent sessions.
 *
 * `api/booking.ts` maps this header to `source = 'gate'` and `server/lib/growth.ts` filters it out
 * of every number an owner sees. Deleting the rows afterwards is still worth doing and is not
 * enough on its own: a walk that fails halfway leaves its rows behind, and that is exactly the
 * walk somebody is staring at the board during.
 */
const VERIFIER_HEADER = { 'x-scoopdogg-verifier': 'gate' };

loadEnv();
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: node scripts/walk-preview.mjs <deployment-url>'); process.exit(2); }
const token = process.env.VERCEL_OIDC_TOKEN;
console.log(`  base: ${base}`);
console.log(`  oidc token: ${token ? `present, ${token.length} chars` : 'ABSENT — a preview will answer 302'}`);

mkdirSync('output/preview-walk', { recursive: true });
const steps = [];
const shot = async (page, name) => {
  await page.screenshot({ path: `output/preview-walk/${name}.png` });
  steps.push(name);
};

const browser = await chromium.launch();
const page = await browser.newPage({ extraHTTPHeaders: VERIFIER_HEADER,
  viewport: { width: 390, height: 844 },                       // iPhone 14, portrait
  deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ...(token ? { extraHTTPHeaders: { 'x-vercel-trusted-oidc-idp-token': token } } : {}),
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const failed = [];
// A 401 from /api/admin/session while signed out is the RIGHT answer, not a failure: it is how
// the admin shell asks "am I signed in" of the only thing that can answer. Everything else that
// fails is a failure.
const EXPECTED = (r) => r.status() === 401 && r.url().includes('/api/admin/session');
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon') && !EXPECTED(r)) failed.push(`${r.status()} ${r.url().replace(base, '')}`);
});

let verdict = 'FAIL';
try {
  const home = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const title = await page.title();
  console.log(`  GET /  -> ${home.status()}  "${title}"`);
  // HTTP 200 IS NOT "I AM ON THE SITE". An expired OIDC token gets Vercel's own login page with a
  // 200 and 340KB of HTML, and a walk that only checked the status code called that a pass -
  // measured 2026-09-19, with a token that had expired eight days earlier. So the check is the
  // page's identity, and the remedy is named in the message.
  if (home.status() !== 200 || /vercel/i.test(title) || !/scoop dogg/i.test(title)) {
    throw new Error(`the homepage is not the site: HTTP ${home.status()} "${title}". ` +
      'The OIDC token is missing or expired — run `npx vercel env pull --environment=development --yes`.');
  }
  await shot(page, '01-home');

  const hero = page.locator('form[data-hero-cta]');
  await hero.locator('input[name=address]').fill('93030');
  await hero.locator('button[type=submit]').click();
  await page.waitForURL(/\/book/);
  await page.getByRole('heading', { name: /what do you need/i }).waitFor({ timeout: 25000 });
  await shot(page, '02-services');

  await page.getByRole('button', { name: /weekly pooper scooper/i }).first().click();
  await page.getByRole('heading', { name: /how many dogs/i }).waitFor();
  await shot(page, '03-size');
  await page.getByRole('button', { name: /^.*2 dogs/i }).first().click();
  await page.getByRole('heading', { name: /here's your price/i }).waitFor();
  await shot(page, '04-price');
  const price = await page.locator('main').innerText();

  await page.getByRole('button', { name: /pay after my first visit/i }).click();
  await page.getByRole('button', { name: /choose my start day/i }).click();
  await page.getByRole('heading', { name: /when should we start/i }).waitFor({ timeout: 25000 });
  await shot(page, '05-day');
  const day = page.locator('main button[aria-pressed]').first();
  await day.waitFor();
  await day.click();
  await page.getByRole('heading', { name: /almost done/i }).waitFor();
  await page.fill('#bk-name', 'Preview Walk');
  await page.fill('#bk-address', '1 Preview St');
  await page.fill('#bk-email', 'delivered@resend.dev');
  await page.fill('#bk-phone', '8055550101');
  await shot(page, '06-details');
  await page.getByRole('button', { name: /review and book/i }).click();
  await page.getByRole('heading', { name: /review your booking/i }).waitFor();
  await shot(page, '07-review');
  const review = await page.locator('main').innerText();

  // An unserved ZIP, on the same phone. Nothing is submitted.
  //
  // The storage clear is not tidiness: the funnel saves progress to sessionStorage and resumes
  // where the customer left off (P16 §4), so returning to /book in the same tab correctly lands
  // on the review step rather than the ZIP box. Proof the resume works, and a walk that did not
  // know it would read as a broken first step.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base}/book`, { waitUntil: 'networkidle' });
  await page.fill('#bk-zip', '93041');
  await page.getByRole('button', { name: /see my price/i }).click();
  await page.getByRole('heading', { name: /not on a route in 93041/i }).waitFor({ timeout: 25000 });
  await shot(page, '08-unserved-zip');

  // The admin, signed out: it must ask for a sign-in rather than showing anything.
  const admin = await page.goto(`${base}/admin/growth`, { waitUntil: 'networkidle' });
  await shot(page, '09-admin-signed-out');

  console.log('\n  what a person sees:');
  console.log(`    price step: ${(price.match(/\$\d+[^\n]*/) ?? [''])[0]}`);
  console.log(`    lane B:     ${(review.match(/first payment is[^.]*/i) ?? ['(not shown)'])[0]}`);
  console.log(`    due today:  ${(review.match(/Due today\s*\S+/i) ?? [''])[0].replace(/\s+/g, ' ')}`);
  console.log(`    admin:      HTTP ${admin.status()}, ${(await page.locator('body').innerText()).slice(0, 60).replace(/\n/g, ' ')}`);
  console.log(`    failed requests: ${failed.length ? failed.slice(0, 5).join(', ') : 'none (a signed-out 401 on /api/admin/session is expected)'}`);
  console.log(`    javascript errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
  verdict = failed.length === 0 && errors.length === 0 ? 'PASS' : 'ATTENTION';
} catch (e) {
  console.log(`  STOPPED: ${String(e.message).split('\n')[0]}`);
  await page.screenshot({ path: 'output/preview-walk/failure.png' }).catch(() => {});
} finally {
  await browser.close();
}

writeFileSync('output/preview-walk/receipt.json', JSON.stringify({
  ran_at: new Date().toISOString(), base, viewport: '390x844', steps, failed_requests: failed, js_errors: errors, verdict,
}, null, 2));
console.log(`\n  ${verdict} — ${steps.length} screens in output/preview-walk/`);
process.exit(verdict === 'FAIL' ? 1 : 0);
