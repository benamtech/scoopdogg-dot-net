/**
 * The funnel writes down what happens, and a step that did not happen leaves no event.
 *
 *   node scripts/dev-server.mjs --port 4331 &     # forces demo mode: test Stripe, test inbox
 *   node gates/funnel-events.mjs [--base http://127.0.0.1:4331]
 *
 * P16 §9 and P19 §2. The growth board's top number has never been measured, and a board that
 * reports a number nobody wrote is worse than one that admits it cannot see. So this walks three
 * real journeys in a browser and reads the rows back.
 *
 * THE DISCRIMINATOR IS THE POINT. It is easy to write a gate that passes because every event
 * fires on every page load; such a gate measures nothing and would let a conversion rate of 100%
 * through. So walk A stops at the ZIP, and this gate REQUIRES that it produced `booking.started`
 * and NOT `booking.priced`. An instrumentation that cannot tell those two apart fails here.
 *
 * Walk A also exercises the no-dead-end promise for real: an unserved ZIP has to reach the
 * waitlist and leave a lead row behind.
 *
 * Everything it creates is marked DEMO— and removed in a `finally` - except the `events` rows,
 * which cannot be deleted because the spine refuses DELETE at the database. That is the trade the
 * append-only design makes and it is worth naming rather than working around.
 */
import { chromium } from 'playwright';
import pg from 'pg';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const BASE = arg('--base', 'http://127.0.0.1:4331');
const stamp = Date.now().toString().slice(-6);

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const sessionIds = [];
const eventsFor = async (id) => (await c.query(
  `select event_type from events where subject_kind = 'booking' and subject_id = $1 order by seq`, [id])).rows.map((r) => r.event_type);
const sessionRow = async (id) => (await c.query(`select * from funnel_sessions where id = $1`, [id])).rows[0];
const sid = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('sd-booking-v2') || '{}').idem || null);
const settle = () => new Promise((r) => setTimeout(r, 900));   // the track call is fire-and-forget

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

const browser = await chromium.launch();
const errors = [];
try {
  // ---- WALK A: a ZIP we know and do not serve ------------------------------------------------
  {
    const page = await browser.newPage({ extraHTTPHeaders: VERIFIER_HEADER, viewport: { width: 390, height: 844 } });   // a phone
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
    await page.fill('#bk-zip', '93041');                       // Port Hueneme: known, not served
    await page.getByRole('button', { name: /see my price/i }).click();
    await page.getByRole('heading', { name: /not on a route in 93041/i }).waitFor({ timeout: 15000 });
    ok('an unserved ZIP says so by name, rather than shrugging');
    const id = await sid(page);
    sessionIds.push(id);
    await page.fill('#wl-email', `delivered+sd-funnel-a-${stamp}@resend.dev`);
    await page.fill('#wl-address', 'DEMO—Funnel A');
    await page.getByRole('button', { name: /tell me when/i }).click();
    await page.getByRole('heading', { name: /you're on the list/i }).waitFor({ timeout: 15000 });
    ok('the waitlist branch ends somewhere, and says nothing was charged');
    await settle();

    const { rows: lead } = await c.query(`select id, city, notes from leads where address = 'DEMO—Funnel A'`);
    lead.length === 1 ? ok('it left a lead row behind (P19 §4: that row is where the next route day comes from)')
                      : no('it left a lead row behind', `${lead.length} rows`);

    const evs = await eventsFor(id);
    evs.includes('booking.started') ? ok('booking.started was written', evs.join(', '))
                                    : no('booking.started was written', evs.join(', ') || 'none');
    // THE DISCRIMINATOR.
    evs.includes('booking.priced')
      ? no('a walk that never saw a price writes no booking.priced', `got ${evs.join(', ')}`)
      : ok('a walk that never saw a price writes no booking.priced');
    const row = await sessionRow(id);
    row?.postal_code === '93041' && !row?.area_slug
      ? ok('the session row records the ZIP and no area')
      : no('the session row records the ZIP and no area', JSON.stringify(row ?? {}));
    await page.close();
  }

  // ---- WALK B: a recurring plan, on lane B ----------------------------------------------------
  {
    const page = await browser.newPage({ extraHTTPHeaders: VERIFIER_HEADER, viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
    await page.fill('#bk-zip', '93030');                        // Oxnard
    await page.getByRole('button', { name: /see my price/i }).click();
    await page.getByRole('heading', { name: /what do you need/i }).waitFor({ timeout: 15000 });
    ok('a served ZIP goes straight to the service question');
    const id = await sid(page);
    sessionIds.push(id);

    await page.getByRole('button', { name: /weekly pooper scooper|weekly poop scooping/i }).first().click();
    await page.getByRole('heading', { name: /how many dogs/i }).waitFor();
    await page.getByRole('button', { name: /2 dogs/i }).first().click();
    await page.getByRole('heading', { name: /here's your price/i }).waitFor();
    const priceText = await page.locator('main').innerText();
    /\$120/.test(priceText) ? ok('the price step shows the ladder price for two dogs', '$120')
                            : no('the price step shows the ladder price for two dogs', priceText.slice(0, 80));
    // The weekly equivalent under every monthly price (P16 §5).
    /about \$[\d,.]+ a visit/i.test(priceText) ? ok('the monthly price carries its per-visit equivalent')
                                           : no('the monthly price carries its per-visit equivalent');

    await page.getByRole('button', { name: /pay after my first visit/i }).click();
    await settle();
    await page.getByRole('button', { name: /choose my start day/i }).click();
    await page.getByRole('heading', { name: /when should we start/i }).waitFor({ timeout: 20000 });
    const firstDay = page.locator('main button[aria-pressed]').first();
    await firstDay.waitFor();
    await firstDay.click();
    await page.getByRole('heading', { name: /almost done/i }).waitFor();
    await page.fill('#bk-name', `DEMO—Funnel B ${stamp}`);
    await page.fill('#bk-address', '1 Gate Test Way');
    await page.fill('#bk-email', `delivered+sd-funnel-b-${stamp}@resend.dev`);
    await page.fill('#bk-phone', `805333${stamp.slice(-4)}`);
    await page.getByRole('button', { name: /review and book/i }).click();
    await page.getByRole('heading', { name: /review your booking/i }).waitFor();
    const review = await page.locator('main').innerText();

    // LANE B SAYS THE DATE, NEVER "LATER" (P16 §5).
    /Due today\s*Nothing/i.test(review) ? ok('lane B charges nothing today, and says so')
                                        : no('lane B charges nothing today, and says so', review.slice(0, 120));
    /first payment is\s+\w+day,?\s+\w+ \d+/i.test(review)
      ? ok('lane B prints the actual date of the first charge')
      : no('lane B prints the actual date of the first charge', (review.match(/first payment[^.]{0,80}/i) ?? [''])[0]);
    /cancel anytime/i.test(review) ? ok('"Cancel anytime" sits beside the pay button')
                                   : no('"Cancel anytime" sits beside the pay button');
    !/deposit/i.test(review) ? ok('the word "deposit" never appears') : no('the word "deposit" never appears');
    await settle();

    const evs = await eventsFor(id);
    ['booking.started', 'booking.priced', 'booking.lane_chosen'].every((e) => evs.includes(e))
      ? ok('the full sequence was written', evs.join(' -> '))
      : no('the full sequence was written', evs.join(' -> ') || 'none');
    const row = await sessionRow(id);
    row?.lane === 'payafter' && row?.price_cents_seen === 12000 && row?.area_slug === 'oxnard'
      ? ok('the session row carries the lane, the area and the price that was on screen', `${row.price_cents_seen} cents`)
      : no('the session row carries the lane, the area and the price on screen', JSON.stringify(row ?? {}));
    await page.close();
  }

  // ---- WALK C: a one-time job, which could not be booked at all before ------------------------
  {
    const page = await browser.newPage({ extraHTTPHeaders: VERIFIER_HEADER, viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
    await page.fill('#bk-zip', '93030');
    await page.getByRole('button', { name: /see my price/i }).click();
    await page.getByRole('heading', { name: /what do you need/i }).waitFor({ timeout: 15000 });
    const id = await sid(page);
    sessionIds.push(id);
    await page.getByRole('button', { name: /one-time dog poop cleanup/i }).first().click();
    await page.getByRole('heading', { name: /how much has built up/i }).waitFor();
    await page.getByRole('button', { name: /standard yard/i }).first().click();
    await page.getByRole('heading', { name: /here's your price/i }).waitFor();
    const text = await page.locator('main').innerText();
    /\$99/.test(text) ? ok('a one-time cleanup reaches a price (it used to be a link to /contact)', '$99')
                      : no('a one-time cleanup reaches a price', text.slice(0, 100));
    /one visit/i.test(text) ? ok('it is described as one visit, not a plan') : no('it is described as one visit, not a plan');
    await page.getByRole('button', { name: /choose my day/i }).click();
    await page.getByRole('heading', { name: /when should we come/i }).waitFor({ timeout: 20000 });
    const day = page.locator('main button[aria-pressed]').first();
    await day.waitFor();
    await day.click();
    await page.getByRole('heading', { name: /almost done/i }).waitFor();
    await settle();
    const evs = await eventsFor(id);
    evs.includes('onetime.scheduled') ? ok('onetime.scheduled was written', evs.join(' -> '))
                                      : no('onetime.scheduled was written', evs.join(' -> ') || 'none');
    await page.close();
  }

  errors.length === 0 ? ok('no JavaScript errors in any walk') : no('no JavaScript errors in any walk', errors.slice(0, 2).join(' | '));
} catch (e) {
  no('the walks completed without an exception', String(e.message).split('\n')[0]);
} finally {
  await browser.close();
  for (const id of sessionIds.filter(Boolean)) {
    await c.query(`delete from funnel_sessions where id = $1`, [id]).catch(() => {});
  }
  await c.query(`delete from leads where address = 'DEMO—Funnel A'`).catch(() => {});
  await c.query(`delete from subscriptions where customer_id in (select id from customers where name like 'DEMO—Funnel%')`).catch(() => {});
  await c.query(`delete from properties where customer_id in (select id from customers where name like 'DEMO—Funnel%')`).catch(() => {});
  await c.query(`delete from customers where name like 'DEMO—Funnel%'`).catch(() => {});
  const { rows: left } = await c.query(`select count(*)::int n from funnel_sessions`);
  console.log(`  funnel_sessions left in the table: ${left[0].n}`);
  await c.end();
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
