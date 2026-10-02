/**
 * The door a visitor pressed is the door the funnel opens on.
 *
 *   node scripts/dev-server.mjs --port 4330 &
 *   node gates/entry-walk.mjs [--base http://127.0.0.1:4330]
 *
 * The browser half of `gates/entry-params.mjs`. That one proves every parameter a page writes has
 * a reader; this one presses the buttons and reads what the funnel shows. It walks the entries a
 * visitor really uses, on a phone-sized screen, from the page they start on:
 *
 *   a homepage service card        -> the ZIP step names that service, and its size question
 *                                     follows; Back still reaches the full list
 *   a one-time service page        -> the ZIP box is on the first screen and goes straight to
 *                                     that service's size question
 *   a city page                    -> the ZIP box is on the first screen
 *   an unserved ZIP typed elsewhere-> answered on arrival, not asked for twice
 *   a service page                 -> no link to /contact?service= (nothing reads it)
 *   any entry                      -> the first track call names the page and the control
 *   an advert click (gclid)        -> the session is recorded as paid.google.com
 *   a size that needs a quote      -> the quote form names the service and size, with the ZIP in
 *
 * MEASURED BEFORE THIS EXISTED (2026-10-02, on the preview): all eleven `?service=` entries
 * landed on an eleven-item picker with nothing chosen. It submits nothing past the size step and
 * marks itself as a verifier, so it never moves the owner's numbers (migration 033).
 *
 * It is a browser job: run it alone, not beside Lighthouse or another browser gate.
 */
import { chromium } from 'playwright';
const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : fallback; };
const base = arg('--base', 'http://127.0.0.1:4330');
const browser = await chromium.launch();
let pass = 0, fail = 0;
const check = (c, w, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${w}${d ? ` — ${d}` : ''}`); };
const heading = (page) => page.evaluate(() => document.querySelector('main h1')?.textContent.trim());
const fresh = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-scoopdogg-verifier': 'gate' } }); return [ctx, await ctx.newPage()]; };

// 1. homepage card -> funnel opens on that service
{ const [ctx, page] = await fresh();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.locator('[data-service-card="pressure-washing"], a[data-cta="service-pressure-washing"]').first().scrollIntoViewIfNeeded();
  await page.locator('a[data-cta="service-pressure-washing"]').first().click();
  await page.waitForURL(/\/book\?service=pressure-washing/); await page.waitForTimeout(900);
  check(await page.locator('[data-entry-service="pressure-washing"]').count() === 1, 'home card: the ZIP step names the service', await heading(page));
  await page.fill('#bk-zip', '93003'); await page.keyboard.press('Enter'); await page.waitForFunction(() => !/Where's your yard/.test(document.querySelector('main h1')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  check(/How big is the area/.test(await heading(page)), 'home card: after the ZIP the next question is about that service', await heading(page));
  await page.getByRole('button', { name: 'Back' }).click(); await page.waitForTimeout(500);
  check(/What do you need/.test(await heading(page)), 'home card: Back reaches the full list', await heading(page));
  await ctx.close(); }

// 2. one-time service page: ZIP box on the first screen -> straight to the size question
{ const [ctx, page] = await fresh();
  await page.goto(base + '/services/one-time-dog-poop-cleanup', { waitUntil: 'networkidle' });
  const box = await page.locator('main form[data-address-form]').first().boundingBox();
  check(box && box.y + box.height < 844, 'one-time service page: the ZIP box is on the first phone screen', box ? `bottom at ${Math.round(box.y + box.height)}px` : 'no form');
  await page.locator('main form[data-address-form] input[name=address]').first().fill('93003');
  await page.locator('main form[data-address-form] button').first().click();
  await page.waitForURL(/\/book\?/); await page.waitForTimeout(1200);
  check(/How much has built up/.test(await heading(page)), 'one-time service page: ZIP goes straight to its size question', await heading(page));
  const req = page.url(); check(/service=one-time-dog-poop-cleanup/.test(req) && /from=service-one-time/.test(req), 'one-time service page: the URL carries service and from', req.split('?')[1]);
  await ctx.close(); }

// 3. city page: ZIP box on the first screen
{ const [ctx, page] = await fresh();
  await page.goto(base + '/areas/ventura', { waitUntil: 'networkidle' });
  const box = await page.locator('main form[data-address-form]').first().boundingBox();
  check(box && box.y + box.height < 844, 'city page: the ZIP box is on the first phone screen', box ? `bottom at ${Math.round(box.y + box.height)}px` : 'no form');
  await ctx.close(); }

// 4. an unserved ZIP typed on the homepage gets its answer without being asked twice
{ const [ctx, page] = await fresh();
  await page.goto(base + '/book?address=90210&from=home-hero', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.querySelector('main astro-island')?.innerText.slice(0, 300));
  check(/not on a route|on the map yet/.test(text || ''), 'an unserved ZIP from another page is answered at once', (text || '').replace(/\s+/g, ' ').slice(0, 110));
  await ctx.close(); }

// 5. a quote-only service sent to /book lands in the quote lane (if any exists)
{ const [ctx, page] = await fresh();
  await page.goto(base + '/services/pressure-washing', { waitUntil: 'networkidle' });
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('main a[href]')].map(a => a.getAttribute('href')).filter(h => /^\/(book|contact|custom-quote)/.test(h)));
  check(!hrefs.some(h => h.startsWith('/contact?')), 'service page: no link to /contact?service=', [...new Set(hrefs)].join(' '));
  await ctx.close(); }

// 6. the entry page reaches the track call
{ const [ctx, page] = await fresh();
  let body = null; page.on('request', (r) => { if (r.url().includes('/api/booking/track') && !body) body = r.postData(); });
  await page.goto(base + '/services/weekly-pooper-scooper-service', { waitUntil: 'networkidle' });
  await page.locator('main form[data-address-form] input[name=address]').first().fill('93003');
  await page.locator('main form[data-address-form] button').first().click();
  await page.waitForURL(/\/book\?/); await page.waitForTimeout(1500);
  const j = body ? JSON.parse(body) : {};
  check(j.entry === '/services/weekly-pooper-scooper-service' && /^service-weekly/.test(j.control || ''), 'the first track call names the page and the control', JSON.stringify({ step: j.step, entry: j.entry, control: j.control }));
  await ctx.close(); }

// 7. a click on an advert is recorded as paid, and the click id is not kept
{ const [ctx, page] = await fresh();
  let body = null; page.on('request', (r) => { if (r.url().includes('/api/booking/track') && !body) body = r.postData(); });
  await page.goto(base + '/areas/ventura?gclid=PLANTED-CLICK-ID', { waitUntil: 'networkidle' });
  await page.locator('main form[data-address-form] input[name=address]').first().fill('93003');
  await page.locator('main form[data-address-form] button').first().click();
  await page.waitForURL(/\/book\?/); await page.waitForTimeout(1500);
  const j = body ? JSON.parse(body) : {};
  check(j.source === 'paid.google.com' && !/PLANTED/.test(body || ''), 'an advert click is recorded as paid.google.com, without its click id', JSON.stringify({ source: j.source, entry: j.entry }));
  await ctx.close(); }

// 8. a size that needs a quote hands over everything the visitor already said
{ const [ctx, page] = await fresh();
  await page.goto(base + '/book?service=pressure-washing&address=93003', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Get a quote/ }).first().click();
  await page.waitForURL(/\/custom-quote\?/); await page.waitForTimeout(900);
  const said = await page.locator('[data-context-text]').innerText().catch(() => '');
  const zip = await page.locator('#cq-city').inputValue().catch(() => '');
  check(/Pressure/i.test(said) && /Large/i.test(said) && zip === '93003', 'the quote form names the service and size, and has the ZIP filled in', `"${said}", ZIP ${zip || 'empty'}`);
  check(!(await page.locator('[data-kinds]').evaluate((d) => d.open)), 'and it does not ask again what kind of job it is');
  await ctx.close(); }

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
