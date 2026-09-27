/**
 * The custom-quote lane, walked in a real browser on a deployment, at phone size, end to end.
 *
 *   node gates/quote-e2e.mjs <deployment-url>
 *
 * gates/quote-rail.mjs proves the rules through the server functions. It cannot prove the SCREENS:
 * an island that throws on first render serves the same HTML to curl and shows a person nothing.
 * So this opens them: the request form with a real photo, the status page it links to, the quote
 * page with an optional extra ticked, the approval, a Stripe test-mode deposit, the balance, and
 * what the customer reads after each. Josue's side runs over the real admin API with a session
 * minted the way gates/admin-browser.mjs mints one.
 *
 * RUN IT AGAINST A PREVIEW. A preview forces demo mode (SD_FORCE_DEMO): Stripe is test mode and
 * mail goes to the demo address, never to a customer or to Josue. Every row it creates is keyed on
 * one stamp and removed at the end, and the counts of every table it can write are compared.
 */
import pg from 'pg';
import { createHmac, randomInt } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';
import { payOnPage } from './_pay-checkout.mjs';

loadEnv();
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: quote-e2e.mjs <deployment-url>'); process.exit(2); }
const { chromium } = await import('playwright');

function fromBrainEnv(name) {
  try {
    for (const line of readFileSync(new URL('../../../.env', import.meta.url).pathname, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k.trim() === name) return rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}
let secret = process.env.SESSION_SECRET;
if (!secret || secret.includes('SENSITIVE')) secret = fromBrainEnv('SCOOPDOGG_SESSION_SECRET');
const hmac = (v) => createHmac('sha256', secret).update(v).digest('hex');
const auth = process.env.VERCEL_OIDC_TOKEN ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN } : {};
const origin = new URL(base).origin;

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const SHOTS = 'output/quote-e2e';
mkdirSync(SHOTS, { recursive: true });

const STAMP = Date.now().toString().slice(-8);
const EMAIL = `delivered+sd-quote-e2e-${STAMP}@resend.dev`;
const PHONE = `805558${STAMP.slice(-4)}`;
const NAME = `Walk Customer ${STAMP}`;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await db.connect();
// `events` is append-only by trigger — an audit spine is not cleaned up after anybody, a gate
// included — so it is counted and reported, not deleted. The walk's events belong to DEMO subjects.
const TABLES = ['leads', 'lead_photos', 'quotes', 'quote_lines', 'customers', 'properties', 'subscriptions', 'invoices', 'invoice_lines', 'payments', 'stripe_customers', 'outbox'];
const eventsBefore = (await db.query('select count(*)::int as n from events')).rows[0].n;
const count = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n])));
const before = await count();

// NOBODY'S INBOX. A preview's demo mode sends every message to settings.demo.address — Ben's inbox —
// and this walk sends five, whose links die when it cleans up (Ben clicked one on 2026-09-27 and got
// "That link is not recognised"). For the length of the walk the demo address is Resend's sandbox,
// and it is put back in `finally`, checked, and put back again on any exit.
const { rows: [demoRow] } = await db.query(`select value from settings where key = 'demo.address'`);
const demoWas = demoRow ? demoRow.value : null;
const restoreDemo = async () => {
  if (demoWas === null) return;
  await db.query(`update settings set value = $1::jsonb where key = 'demo.address'`, [JSON.stringify(demoWas)]).catch(() => {});
};
process.once('SIGINT', async () => { await restoreDemo(); process.exit(130); });
await db.query(`update settings set value = $1::jsonb where key = 'demo.address'`, [JSON.stringify(`delivered+sd-quote-e2e-demo-${STAMP}@resend.dev`)]);

// ── Josue's session, minted with the server's own HMAC and completed over HTTP.
const adminEmail = 'ben@amtechai.com';
const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
await db.query(`insert into verification_codes (target_hash, code_hash, purpose, expires_at) values ($1,$2,'admin_login', now() + interval '10 minutes')`,
  [hmac(adminEmail), hmac(`${adminEmail}:${code}`)]);
const verify = await fetch(`${base}/api/admin/login/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ email: adminEmail, code }) });
const cookie = (verify.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('sd_admin='));
check(verify.status === 200 && !!cookie, "Josue's session opens over HTTP", `status ${verify.status}`);
const admin = async (path, init = {}) => {
  const r = await fetch(`${base}/api/admin/${path}`, { ...init, headers: { 'Content-Type': 'application/json', Cookie: cookie ?? '', ...auth, ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${j.error ?? ''}`);
  return j;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  route.continue(url.startsWith(origin) ? { headers: { ...route.request().headers(), ...auth } } : {});
});
const page = await ctx.newPage();
const thrown = [];
page.on('pageerror', (e) => thrown.push(e.message));
const text = () => page.evaluate(() => document.body.innerText);

let token = null;
let quoteId = null;
try {
  // ── 1. the request
  console.log('1. somebody describes a job on a phone');
  await page.goto(`${base}/custom-quote?service=yard-deep-clean`, { waitUntil: 'networkidle' });
  check(/quoted by Josue himself/i.test(await text()), 'the page says what it is', 'hero');
  await page.locator('input[name=job_kinds][value=yard_cleanup]').check();
  await page.locator('input[name=job_kinds][value=haul_away]').check();
  await page.fill('#cq-description', 'Automated walk. The back yard is overgrown; clear it and haul the green waste. Not a real customer.');
  await page.locator('[data-photo-input]').setInputFiles('public/brand/mark-512.png');
  await page.locator('[data-photo-previews] img').first().waitFor({ timeout: 10000 });
  check(await page.locator('[data-photo-previews] img').count() === 1, 'the photo shows as a preview before sending');
  await page.locator('input[name=timing][value=month]').check();
  await page.fill('#cq-name', NAME);
  await page.fill('#cq-phone', PHONE);
  await page.fill('#cq-email', EMAIL);
  await page.fill('#cq-address', '1 Walk St');
  await page.fill('#cq-city', 'Ventura 93001');
  await page.screenshot({ path: `${SHOTS}/1-request.png`, fullPage: true });
  await page.locator('[data-submit]').click();
  await page.locator('[data-quote-request-done]').waitFor({ state: 'visible', timeout: 45000 });
  const doneText = await page.locator('[data-quote-request-done]').innerText();
  check(/Josue has it/.test(doneText) && /within one business day/.test(doneText), 'the confirmation says who reads it and by when');
  const href = await page.locator('[data-status-link]').getAttribute('href');
  token = href?.split('/').pop() ?? null;
  check(!!token && token.length >= 32, 'the confirmation carries a status link', href ?? 'none');
  await page.screenshot({ path: `${SHOTS}/2-sent.png`, fullPage: true });

  const { rows: [lead] } = await db.query(`select id, name, kind, job_kinds, service_slug from leads where request_token = $1`, [token]);
  const { rows: [{ n: photos }] } = await db.query(`select count(*)::int as n from lead_photos where lead_id = $1`, [lead?.id]);
  check(lead?.kind === 'custom' && photos === 1 && lead.service_slug === 'yard-deep-clean', 'the lead landed with its photo and the service it came from', `${lead?.kind}, ${photos} photo, ${lead?.service_slug}`);

  // ── 2. the status page before a quote — first with the connection dropped
  // Measured 2026-09-27: a network drop mid-walk showed the customer the browser's own words,
  // "Failed to fetch". The page must say something a person can act on, and Try again must work.
  await page.route('**/api/quote/view**', (r) => r.abort('internetdisconnected'));
  await page.goto(`${base}/quote/${token}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/check your connection/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  const offline = await text();
  check(/check your connection/i.test(offline) && !/Failed to fetch/i.test(offline), 'a dropped connection gets a sentence and a phone number, not the browser\'s words');
  await page.unroute('**/api/quote/view**');
  await page.getByRole('button', { name: /Try again/ }).click();
  await page.getByText(/Josue has it/).first().waitFor({ timeout: 15000 });
  check(true, 'Try again brings the page back once the connection is there');
  // Loaded, not merely present: an <img> whose URL 404s still counts as one element.
  await page.waitForFunction(() => { const i = document.querySelector('img[alt="Your photo"]'); return i && i.complete; }, null, { timeout: 15000 }).catch(() => {});
  const loaded = await page.evaluate(() => [...document.querySelectorAll('img[alt="Your photo"]')].map((i) => i.naturalWidth));
  check(loaded.length === 1 && loaded[0] > 0, 'the status page shows what they sent, and the photo actually loads', `naturalWidth ${loaded.join(',') || 'none'}`);

  // ── 3. Josue builds and sends it
  console.log('2. Josue prices it and sends it');
  const draft = await admin('quote-new', { method: 'POST', body: JSON.stringify({ lead_id: lead.id }) });
  quoteId = draft.quote.id;
  await admin(`quote/${quoteId}`, { method: 'PATCH', body: JSON.stringify({
    title: 'Back yard clear-out', message: 'Priced from your photo.', deposit_mode: 'percent', deposit_percent: 25,
    lines: [{ description: 'Clear and weed the back yard', amount_cents: 48_000 }, { description: 'Haul away green waste', amount_cents: 12_000 }, { description: 'Enzyme deodorizer', amount_cents: 6_000, optional: true }],
  }) });
  const sent = await admin(`quote/${quoteId}/send`, { method: 'POST' });
  check(sent.url.endsWith(`/quote/${token}`) && /^sms:/.test(sent.sms_href ?? ''), 'sending returns the link and a text from his phone');

  // ── 4. the customer decides
  console.log('3. the customer opens it, adds the extra, approves and pays the deposit');
  await page.goto(`${base}/quote/${token}`, { waitUntil: 'networkidle' });
  await page.locator('[data-quote-lines]').waitFor({ timeout: 15000 });
  const t0 = await page.locator('[data-quote-totals]').innerText();
  check(/\$600/.test(t0) && /\$150/.test(t0), 'the quote shows the total and the 25% deposit', t0.replace(/\s+/g, ' ').slice(0, 90));
  await page.getByLabel('Add Enzyme deodorizer').check();
  const t1 = await page.locator('[data-quote-totals]').innerText();
  check(/\$660/.test(t1) && /\$165/.test(t1), 'ticking the extra moves the total and the deposit', t1.replace(/\s+/g, ' ').slice(0, 90));
  check(/\$660/.test(await page.locator('[data-terms]').innerText()), 'the sentence being approved carries the new total');
  await page.fill('#q-sign', NAME);
  await page.screenshot({ path: `${SHOTS}/3-quote.png`, fullPage: true });
  await page.locator('[data-approve]').click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  check(true, 'approval goes to a Stripe Checkout');
  const back = await payOnPage(page, { name: NAME, leaveTo: new RegExp(`/quote/${token}`), screenshot: `${SHOTS}/checkout-fail.png` });
  check(back.includes(`/quote/${token}`), 'Stripe returns the customer to their quote');
  await page.waitForLoadState('networkidle');
  await page.getByText(/You're booked/).first().waitFor({ timeout: 20000 });
  check(true, "the page says they're booked");
  await page.screenshot({ path: `${SHOTS}/4-booked.png`, fullPage: true });
  const { rows: [dep] } = await db.query(
    `select p.amount_cents, p.platform_fee_cents from payments p join invoices i on i.id = p.invoice_id
      join quotes q on q.subscription_id = i.subscription_id where q.id = $1 and p.kind = 'deposit'`, [quoteId]);
  check(dep?.amount_cents === 16_500 && dep.platform_fee_cents === 1_320, 'the deposit is in the books with the 8% fee', JSON.stringify(dep ?? null));

  // ── 5. the balance
  console.log('4. the work is done');
  const bal = await admin(`quote/${quoteId}/complete`, { method: 'POST', body: JSON.stringify({ method: 'card' }) });
  check(bal.paid && bal.balance === 49_500, 'one tap charges the balance to the saved card', `${bal.balance}`);
  await page.goto(`${base}/quote/${token}`, { waitUntil: 'networkidle' });
  await page.getByText(/Paid in full/).first().waitFor({ timeout: 20000 });
  check(true, 'the customer\'s page says paid in full');
  await page.screenshot({ path: `${SHOTS}/5-paid.png`, fullPage: true });
  check(thrown.length === 0, 'no page threw', thrown.slice(0, 2).join(' | '));
} catch (e) {
  no('the walk ran to the end', String(e?.message ?? e).split('\n')[0].slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/failed.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  // ── cleanup, keyed on this run's stamp
  const { rows: leads } = await db.query(`select id, customer_id from leads where email = $1 or phone = $2`, [EMAIL, PHONE]);
  const leadIds = leads.map((l) => l.id);
  const { rows: qs } = leadIds.length ? await db.query(`select id, subscription_id, customer_id from quotes where lead_id = any($1::uuid[])`, [leadIds]) : { rows: [] };
  const subIds = qs.map((q) => q.subscription_id).filter(Boolean);
  const custIds = [...new Set([...qs.map((q) => q.customer_id), ...leads.map((l) => l.customer_id)].filter(Boolean))];
  await db.query('begin');
  try {
    if (subIds.length) {
      await db.query(`delete from invoice_lines where invoice_id in (select id from invoices where subscription_id = any($1::uuid[]))`, [subIds]);
      await db.query(`delete from payments where invoice_id in (select id from invoices where subscription_id = any($1::uuid[]))`, [subIds]);
      await db.query(`delete from invoices where subscription_id = any($1::uuid[])`, [subIds]);
    }
    if (custIds.length) await db.query(`delete from payments where customer_id = any($1::uuid[])`, [custIds]);
    if (leadIds.length) await db.query(`delete from quotes where lead_id = any($1::uuid[])`, [leadIds]);
    if (subIds.length) await db.query(`delete from subscriptions where id = any($1::uuid[])`, [subIds]);
    if (custIds.length) {
      await db.query(`delete from stripe_customers where customer_id = any($1::uuid[])`, [custIds]);
      await db.query(`delete from properties where customer_id = any($1::uuid[])`, [custIds]);
    }
    if (leadIds.length) await db.query(`delete from leads where id = any($1::uuid[])`, [leadIds]);
    if (custIds.length) await db.query(`delete from customers where id = any($1::uuid[])`, [custIds]);
    await db.query(`delete from outbox where created_at > now() - interval '1 hour' and (payload::text like $1 or payload::text like $2)`, [`%${STAMP}%`, `%${token ?? 'no-token'}%`]);
    await db.query(`delete from verification_codes where purpose = 'admin_login' and target_hash = $1`, [hmac(adminEmail)]);
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    no('cleanup', e.message);
  }
  await restoreDemo();
  const { rows: [demoNow] } = await db.query(`select value from settings where key = 'demo.address'`);
  check(JSON.stringify(demoNow?.value ?? null) === JSON.stringify(demoWas), 'the demo address is put back', String(demoNow?.value ?? 'none').replace(/^(.).*(@.*)$/, '$1…$2'));
  const after = await count();
  const moved = TABLES.filter((t) => after[t] !== before[t]).map((t) => `${t} ${before[t]}→${after[t]}`);
  check(moved.length === 0, 'every row the walk wrote is gone', moved.join(', ') || 'all tables as they were');
  const eventsAfter = (await db.query('select count(*)::int as n from events')).rows[0].n;
  console.log(`  note  events is append-only: ${eventsAfter - eventsBefore} audit row(s) for this walk's DEMO subjects stay, by design`);
  await db.end();
}
console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
