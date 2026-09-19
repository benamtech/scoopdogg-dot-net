/**
 * S15/S14: a visitor goes from the homepage to a booking, in all three shapes the funnel now
 * offers, and every price on the way is the resolver's price.
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
 * THREE RUNS, because the funnel is three shapes now (P16 §3, §5):
 *   A  a recurring plan, prepay          -> the first month is charged
 *   B  the same plan, pay after visit 1  -> a card is saved, payment_state 'trialing', $0 today
 *   C  a one-time cleanup                -> frequency 'one_time', charged through chargeOnce()
 *
 * It never mails a real person: the dev server forces demo mode, and this gate asserts the outbox
 * rows it created were addressed only to the demo address. Its rows carry the DEMO— mark so
 * scripts/demo-clear.mjs removes them.
 */
import { chromium } from 'playwright';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';
import { quoteBooking, quoteOneTime, formatCents } from '../.gate-build/src/shared/pricing.js';

loadEnv();
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const BASE = arg('--base', 'http://127.0.0.1:4330');
const CARD = arg('--card', '4242424242424242');
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));
const pkg = catalog.packages.find((p) => p.slug === 'scoop-weekly-2-dogs');
const quote = quoteBooking(catalog, { packageId: pkg.id });
const cleanupTier = catalog.tiers.find((t) => t.service_slug === 'one-time-dog-poop-cleanup' && t.price_cents && !t.requires_quote && !t.price_is_from);
const oneTime = quoteOneTime(catalog, cleanupTier.id);
const expectMonthly = formatCents(pkg.monthly_price_cents);
const expectFirst = formatCents(quote.firstChargeCents, { forceDecimals: quote.firstChargeCents % 100 !== 0 });
const stamp = Date.now().toString().slice(-6);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const errors = [];
const outcomes = {};
const people = {};
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();

/** One walk. `shape` is 'prepay' | 'payafter' | 'onetime'. */
async function walk(shape) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  const person = {
    name: `DEMO—E2E ${shape} ${stamp}`,
    email: `delivered+sd-e2e-${shape}-${stamp}@resend.dev`,
    phone: `805${shape === 'prepay' ? '511' : shape === 'payafter' ? '522' : '533'}${stamp.slice(-4)}`,
  };
  people[shape] = person;
  let outcome = 'unknown';
  try {
    // The hero: one field, a plain GET to /book. A pasted street address still works, which is
    // the promise P16 §2 makes about the ZIP field.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const hero = page.locator('form[data-hero-cta]');
    const t0 = Date.now();
    await hero.locator('input[name=address]').fill(shape === 'prepay' ? '123 Main St, Ventura, CA 93001' : '93001');
    await hero.locator('button[type=submit]').click();
    await page.waitForURL(/\/book/);
    await page.getByRole('heading', { name: /what do you need/i }).waitFor({ timeout: 20000 });
    if (shape === 'prepay') check('a pasted address still reaches the service question (the ZIP is parsed out)', true, `${Date.now() - t0}ms`);

    if (shape === 'onetime') {
      await page.getByRole('button', { name: /one-time dog poop cleanup/i }).first().click();
      await page.getByRole('heading', { name: /how much has built up/i }).waitFor();
      await page.getByRole('button', { name: new RegExp(cleanupTier.label.split(' (')[0], 'i') }).first().click();
      await page.getByRole('heading', { name: /here's your price/i }).waitFor();
      const text = await page.locator('main').innerText();
      check('the one-time price on screen is the tier row', text.includes(formatCents(oneTime.cents)), formatCents(oneTime.cents));
      await page.getByRole('button', { name: /choose my day/i }).click();
    } else {
      await page.getByRole('button', { name: /weekly pooper scooper/i }).first().click();
      await page.getByRole('heading', { name: /how many dogs/i }).waitFor();
      await page.getByRole('button', { name: /^.*2 dogs/i }).first().click();
      await page.getByRole('heading', { name: /here's your price/i }).waitFor();
      if (shape === 'prepay') {
        const priceText = await page.locator('main').innerText();
        check(`price step shows the resolver's monthly price ${expectMonthly}`, priceText.includes(expectMonthly));
        check(`price step shows the resolver's first month ${expectFirst}`, priceText.includes(expectFirst));
        check('no contact field appears before the price', (await page.locator('input[type=email], input[type=tel]').count()) === 0);
      }
      if (shape === 'payafter') await page.getByRole('button', { name: /pay after my first visit/i }).click();
      await page.getByRole('button', { name: /^this week$/i }).click().catch(() => {});
      await page.getByRole('button', { name: /choose my start day/i }).click();
    }

    await page.getByRole('heading', { name: shape === 'onetime' ? /when should we come/i : /when should we start/i }).waitFor({ timeout: 20000 });
    const firstDay = page.locator('main button[aria-pressed]').first();
    await firstDay.waitFor();
    await firstDay.click();
    await page.getByRole('heading', { name: /almost done/i }).waitFor();
    await page.fill('#bk-name', person.name);
    await page.fill('#bk-address', '123 Main St');
    await page.fill('#bk-email', person.email);
    await page.fill('#bk-phone', person.phone);
    await page.fill('#bk-notes', 'Automated end-to-end gate. Not a real customer.');
    await page.getByRole('button', { name: /review and book/i }).click();
    await page.getByRole('heading', { name: /review your booking/i }).waitFor();
    const review = await page.locator('main').innerText();
    if (shape === 'prepay') check(`review shows Due today ${expectFirst}`, review.includes(expectFirst));
    if (shape === 'payafter') check('lane B shows nothing due today and the date of the first charge',
      /Due today\s*Nothing/i.test(review) && /first payment is/i.test(review));

    await page.getByRole('button', { name: /(pay .* and book|save my card and book)/i }).click();
    await Promise.race([
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 25000 }),
      page.getByRole('heading', { name: /booking received/i }).waitFor({ timeout: 25000 }),
    ]).catch(() => {});

    if (/checkout\.stripe\.com/.test(page.url())) {
      outcome = 'paid';
      await page.locator('#cardNumber').fill(CARD);
      await page.locator('#cardExpiry').fill('12 / 34');
      await page.locator('#cardCvc').fill('123');
      await page.locator('#billingName').fill(person.name);
      const zip = page.locator('#billingPostalCode');
      if (await zip.count()) await zip.fill('93001');
      await page.locator('button[type=submit]').click();
      await page.waitForURL(/\/book\/complete/, { timeout: 60000 });
      await page.getByRole('heading', { name: /you're booked/i }).waitFor({ timeout: 30000 });
      check(`${shape}: returned from Stripe to a confirmed booking`, true);
    } else {
      outcome = 'request';
      await page.getByRole('heading', { name: /booking received/i }).waitFor({ timeout: 10000 });
      check(`${shape}: payments not connected, so the booking is saved as a request — never a dead end`, true);
    }
  } catch (e) {
    check(`${shape}: the journey completed without an exception`, false, String(e.message).split('\n')[0]);
    await page.screenshot({ path: `output/checkout-e2e-${shape}-failure.png` }).catch(() => {});
  }
  outcomes[shape] = outcome;
  await page.close();
}

for (const shape of ['prepay', 'payafter', 'onetime']) await walk(shape);

// ---- the rows, which are what any of this was for -------------------------------------------
try {
  for (const shape of ['prepay', 'payafter', 'onetime']) {
    const { rows } = await c.query(
      `select s.state, s.frequency, s.monthly_price_cents, s.price_cents, s.payment_state,
              s.booking_answers->>'lane' as lane, s.discount->>'first_charge_cents' as first_charge
         from subscriptions s join customers cu on cu.id = s.customer_id where cu.email = $1`, [people[shape].email]);
    check(`${shape}: exactly one subscription row`, rows.length === 1, JSON.stringify(rows[0] ?? {}));
    const r = rows[0] ?? {};
    if (shape === 'onetime') {
      check('onetime: frequency is one_time and the price is the tier price',
        r.frequency === 'one_time' && r.price_cents === oneTime.cents, `${r.frequency} ${r.price_cents}`);
    } else {
      check(`${shape}: frozen monthly price equals the resolver`, r.monthly_price_cents === pkg.monthly_price_cents);
      check(`${shape}: frozen first charge equals the resolver`, Number(r.first_charge) === quote.firstChargeCents);
      check(`${shape}: the lane is recorded on the row`, r.lane === shape, String(r.lane));
    }
    if (outcomes[shape] === 'paid' && shape === 'payafter') {
      check('payafter: the subscription is active and trialing, with no money taken',
        r.state === 'active' && r.payment_state === 'trialing', `${r.state}/${r.payment_state}`);
    } else if (outcomes[shape] === 'paid') {
      check(`${shape}: the subscription is active and paid`, r.state === 'active' && r.payment_state === 'ok');
    }
  }
  const { rows: mail } = await c.query(
    `select payload->'to' as to_list, demo from outbox where created_at > now() - interval '15 minutes'
       and (payload->>'subject' ilike $1 or payload->'requested_to' ?| $2)`, [`%${stamp}%`, Object.values(people).map((p) => p.email)]);
  const leaked = mail.filter((m) => !m.demo || JSON.stringify(m.to_list).match(/scoopdogg|amtechai|gmail/));
  check('every message these bookings sent was demo-addressed (no real inbox)', leaked.length === 0, `${mail.length} messages`);
} catch (e) {
  check('the rows could be read back', false, String(e.message).split('\n')[0]);
}

check('no JavaScript errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await c.end();
await browser.close();

const failed = results.filter((r) => !r.ok).length;
const distinct = [...new Set(Object.values(outcomes))];
const verdict = failed === 0 ? `PASS(${distinct.length === 1 ? distinct[0] : distinct.join('+')})` : 'FAIL';
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync('output', { recursive: true });
writeFileSync('output/checkout-e2e-receipt.json', JSON.stringify({ ran_at: new Date().toISOString(), base: BASE, verdict, outcomes, results }, null, 2));
console.log(`\n${verdict} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
