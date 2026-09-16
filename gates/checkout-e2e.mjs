/**
 * S15/S14: a visitor goes from the homepage hero to a paid (or requested) booking, and every
 * price on the way is the resolver's price.
 *
 *   node scripts/dev-server.mjs --port 4330 &   # forces demo mode: test Stripe, test inbox
 *   node gates/checkout-e2e.mjs [--base http://127.0.0.1:4330] [--card 4242424242424242]
 *
 * TWO HONEST OUTCOMES, AND IT SAYS WHICH IT MEASURED
 *   payments connected   -> Stripe Checkout, pay with the test card, land in the account: PASS(paid)
 *   not connected yet    -> the booking is saved as a request and the owner path fires: PASS(request)
 * The second is not the first. The oracle edge for S15 expects PASS(paid); PASS(request) keeps
 * the no-dead-end promise green without pretending money moved.
 *
 * It never mails a real person: the dev server forces demo mode, and this gate asserts the outbox
 * rows it created were addressed only to the demo address. Its rows carry the DEMO— mark so
 * scripts/demo-clear.mjs removes them.
 */
import { chromium } from 'playwright';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadEnv } from './_env.mjs';
import { quoteBooking, formatCents } from '../.gate-build/src/shared/pricing.js';

loadEnv();
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const BASE = arg('--base', 'http://127.0.0.1:4330');
const CARD = arg('--card', '4242424242424242');
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));
const pkg = catalog.packages.find((p) => p.slug === 'scoop-weekly-2-dogs');
const quote = quoteBooking(catalog, { packageId: pkg.id });
const expectMonthly = formatCents(pkg.monthly_price_cents);
const expectFirst = formatCents(quote.firstChargeCents, { forceDecimals: quote.firstChargeCents % 100 !== 0 });
const stamp = Date.now().toString().slice(-6);
const person = { name: `DEMO—E2E Tester ${stamp}`, email: `delivered+sd-e2e-${stamp}@resend.dev`, phone: `805555${stamp.slice(-4)}` };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let outcome = 'unknown';
try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const hero = page.locator('form[data-hero-cta]');
  await hero.locator('input[name=address]').fill('123 Main St, Ventura, CA 93001');
  const t0 = Date.now();
  await hero.locator('button[type=submit]').click();
  await page.waitForURL(/\/book/);
  await page.getByRole('heading', { name: /what do you need/i }).waitFor();
  check('hero address skips to the service question (city detected)', true);

  await page.getByRole('button', { name: /weekly poop scooping/i }).click();
  await page.getByRole('heading', { name: /how many dogs/i }).waitFor();
  await page.getByRole('button', { name: /^.*2 dogs/i }).first().click();
  await page.getByRole('heading', { name: /here's your price/i }).waitFor();
  const interactions = 3; // address submit, service, dogs
  check('exact price within 3 interactions of the homepage (S14)', interactions <= 3, `${Date.now() - t0}ms`);
  const priceText = await page.locator('main').innerText();
  check(`price step shows the resolver's monthly price ${expectMonthly}`, priceText.includes(expectMonthly));
  check(`price step shows the resolver's first month ${expectFirst}`, priceText.includes(expectFirst));
  check('no contact field appears before the price', (await page.locator('input[type=email], input[type=tel]').count()) === 0);

  await page.getByRole('button', { name: 'This week' }).click();
  await page.getByRole('button', { name: /choose my start day/i }).click();
  await page.getByRole('heading', { name: /when should we start/i }).waitFor();
  const firstDay = page.locator('main button[aria-pressed]').first();
  await firstDay.waitFor();
  await firstDay.click();
  await page.getByRole('heading', { name: /almost done/i }).waitFor();
  await page.fill('#bk-name', person.name);
  await page.fill('#bk-email', person.email);
  await page.fill('#bk-phone', person.phone);
  await page.fill('#bk-notes', 'Automated end-to-end gate. Not a real customer.');
  await page.getByRole('button', { name: /review and pay/i }).click();
  await page.getByRole('heading', { name: /review your booking/i }).waitFor();
  const review = await page.locator('main').innerText();
  check(`review shows Due today ${expectFirst}`, review.includes(expectFirst));
  await page.getByRole('button', { name: new RegExp(`pay .* and book`, 'i') }).click();

  await page.waitForURL(/checkout\.stripe\.com|\/book/, { timeout: 30000 });
  await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 }),
    page.getByRole('heading', { name: /booking received/i }).waitFor({ timeout: 20000 }),
  ]).catch(() => {});

  if (/checkout\.stripe\.com/.test(page.url())) {
    outcome = 'paid';
    const stripeText = await page.locator('body').innerText();
    check(`Stripe Checkout shows ${expectFirst} due today`, stripeText.includes(expectFirst.replace('$', '')));
    await page.locator('#cardNumber').fill(CARD);
    await page.locator('#cardExpiry').fill('12 / 34');
    await page.locator('#cardCvc').fill('123');
    await page.locator('#billingName').fill(person.name);
    const zip = page.locator('#billingPostalCode');
    if (await zip.count()) await zip.fill('93001');
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/book\/complete/, { timeout: 60000 });
    await page.getByRole('heading', { name: /you're booked/i }).waitFor({ timeout: 30000 });
    check('returned from Stripe to a confirmed booking', true);
    await page.getByRole('link', { name: /go to my account/i }).click();
    await page.getByRole('heading', { name: /next visit/i }).waitFor({ timeout: 20000 });
    check('lands in the account, signed in, with the next visit (S16)', true);
  } else {
    outcome = 'request';
    await page.getByRole('heading', { name: /booking received/i }).waitFor({ timeout: 10000 });
    check('payments not connected: booking saved as a request, never a dead end', true);
  }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  const { rows: subs } = await c.query(
    `select s.state, s.monthly_price_cents, s.discount->>'first_charge_cents' as first_charge, s.payment_state
       from subscriptions s join customers cu on cu.id = s.customer_id where cu.email = $1`, [person.email]);
  check('one subscription row for this booking', subs.length === 1, JSON.stringify(subs[0] ?? {}));
  check('frozen monthly price equals the resolver', subs[0]?.monthly_price_cents === pkg.monthly_price_cents);
  check('frozen first charge equals the resolver', Number(subs[0]?.first_charge) === quote.firstChargeCents);
  if (outcome === 'paid') check('subscription is active and paid', subs[0]?.state === 'active' && subs[0]?.payment_state === 'ok');
  const { rows: mail } = await c.query(
    `select payload->'to' as to_list, demo from outbox where created_at > now() - interval '10 minutes'
       and (payload->>'subject' ilike $1 or payload->'requested_to' ? $2)`, [`%${stamp}%`, person.email]);
  const leaked = mail.filter((m) => !m.demo || JSON.stringify(m.to_list).match(/scoopdogg|amtechai|gmail/));
  check('every message this booking sent was demo-addressed (no real inbox)', mail.length > 0 && leaked.length === 0, `${mail.length} messages`);
  await c.end();
} catch (e) {
  check('journey completed without an exception', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'output/checkout-e2e-failure.png' }).catch(() => {});
}
check('no JavaScript errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed === 0 ? `PASS(${outcome})` : 'FAIL'} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
