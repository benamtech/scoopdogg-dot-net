/**
 * The Today screen's three taps, in a browser, against a real stop.
 *
 *   node gates/today-taps.mjs <deployment-url>
 *
 * gates/stop-recorder.mjs proves the verbs inside a rolled-back transaction, and
 * gates/admin-browser.mjs proves /admin/today renders. Neither has ever pressed a button:
 * "On my way", "I'm here", the photo, and "Mark done" had only been read, never tapped, so
 * the first person to find out whether they work would have been Josue in a yard.
 *
 * So this plants ONE stop for today, signs in the way admin-browser.mjs does, taps all three
 * in order with the photo between, and reads the visit back from the database — the clock must
 * be written in order and the visit completed. Then it deletes what it planted and counts every
 * table it could have written, before and after.
 *
 * RUN IT AGAINST A PREVIEW. Mark done notifies the customer; on a preview SD_FORCE_DEMO holds
 * every message, and the planted customer's address is @example.invalid besides. Against
 * production the notice would be queued for the owner and this gate deletes it, but a preview is
 * the place for it.
 *
 * WHAT IT CANNOT REMOVE: its `events` rows. `events` refuses DELETE at the database — it is the
 * tamper-evident spine — so, like gates/invite-flow.mjs, the run leaves its history and says how
 * many rows. They name a visit that no longer exists and no screen reads them.
 *
 * Marked as ours: the customer is `GATE today-taps <run>` at gate+today-<run>@example.invalid.
 * `subscriptions.source` allows only online/admin/import, so the name is the mark.
 */
import pg from 'pg';
import { createHmac, randomInt, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: today-taps.mjs <deployment-url>'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed — npm i -D playwright'); process.exit(1); }

// Same secret source as gates/admin-browser.mjs; used, never printed.
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
if (!secret) { console.error('no SESSION_SECRET available'); process.exit(1); }
const hmac = (v) => createHmac('sha256', secret).update(v).digest('hex');

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const authHeaders = process.env.VERCEL_OIDC_TOKEN
  ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN } : {};

// Every table the plant, the sign-in and the three taps can write.
const TABLES = ['customers', 'properties', 'subscriptions', 'visits', 'visit_photos', 'outbox', 'verification_codes', 'events'];

const db = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: true } });
await db.connect();
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) =>
  [t, (await db.query(`select count(*)::int n from ${t}`)).rows[0].n])));

const run = randomBytes(3).toString('hex');
const before = await counts();
const planted = {};
let codeId = null;
let browser = null;

try {
  console.log(`A. plant one stop for today (run ${run})`);
  planted.customer = (await db.query(
    `insert into customers (name, email, phone) values ($1, $2, '8055550003') returning id`,
    [`GATE today-taps ${run}`, `gate+today-${run}@example.invalid`])).rows[0].id;
  planted.property = (await db.query(
    `insert into properties (customer_id, address, city, postal_code) values ($1, $2, 'Ventura', '93001') returning id`,
    [planted.customer, `${run} Gate Way`])).rows[0].id;
  planted.subscription = (await db.query(
    `insert into subscriptions (customer_id, property_id, service_slug, state, monthly_price_cents, source)
     values ($1, $2, 'weekly-pooper-scooper-service', 'active', 10000, 'admin') returning id`,
    [planted.customer, planted.property])).rows[0].id;
  planted.visit = (await db.query(
    `insert into visits (subscription_id, property_id, scheduled_for) values ($1, $2, current_date) returning id`,
    [planted.subscription, planted.property])).rows[0].id;
  ok('a stop is on today’s route', planted.visit);

  console.log('\nB. sign in');
  const email = 'ben@amtechai.com';
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  codeId = (await db.query(
    `insert into verification_codes (target_hash, code_hash, purpose, expires_at)
     values ($1, $2, 'admin_login', now() + interval '10 minutes') returning id`,
    [hmac(email), hmac(`${email}:${code}`)])).rows[0].id;
  const verify = await fetch(`${base}/api/admin/login/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ email, code }),
  });
  const session = (verify.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('sd_admin='));
  check(verify.status === 200 && !!session, 'signed in over HTTP', `status=${verify.status}`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const origin = new URL(base).origin;
  if (Object.keys(authHeaders).length) {
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      route.continue(url.startsWith(origin) ? { headers: { ...route.request().headers(), ...authHeaders } } : {});
    });
  }
  const i = session.indexOf('=');
  await ctx.addCookies([{ name: session.slice(0, i), value: session.slice(i + 1), domain: new URL(base).hostname, path: '/', httpOnly: true, secure: true }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));

  console.log('\nC. the three taps, on a phone-sized screen');
  await page.goto(`${base}/admin/today`, { waitUntil: 'networkidle' });
  const card = page.locator('li, article, section, div').filter({ hasText: `${run} Gate Way` }).filter({ has: page.getByRole('button', { name: 'Mark done' }) }).last();
  await card.waitFor({ timeout: 20000 });
  ok('the planted stop is on the screen', `${run} Gate Way`);

  const tap = async (label, apiPath) => {
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(apiPath) && r.request().method() === 'POST', { timeout: 20000 }),
      card.getByRole('button', { name: label }).click(),
    ]);
    check(resp.status() === 200, `"${label}" is accepted`, `POST ${apiPath} -> ${resp.status()}`);
  };
  await tap('On my way', 'visits/en-route');
  await tap("I'm here", 'visits/arrived');

  // The photo is required (visit.require_completion_photo), so it is taken exactly as Josue takes
  // one: through the file input, resized in the browser, uploaded before Mark done.
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 60 });
  const [up] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('visits/photo') && r.request().method() === 'POST', { timeout: 30000 }),
    page.locator(`#photo-${planted.visit}`).setInputFiles({ name: 'yard.jpg', mimeType: 'image/jpeg', buffer: jpeg }),
  ]);
  check(up.status() === 200, 'the photo uploads', `POST visits/photo -> ${up.status()}`);
  // click() waits for Mark done to become enabled, which it does once the photo is listed.
  await tap('Mark done', 'visits/complete');
  check(errors.length === 0, 'no script error on the page', errors.slice(0, 2).join(' | ') || 'none');

  console.log('\nD. what the database now says');
  const { rows: [v] } = await db.query(
    `select state, en_route_at, arrived_at, completed_at, cardinality(photo_urls) as photos from visits where id = $1`, [planted.visit]);
  check(v.state === 'completed', 'the visit is completed', v.state);
  check(!!v.en_route_at && !!v.arrived_at && !!v.completed_at, 'all three times are written',
    `en_route ${v.en_route_at?.toISOString?.()}, arrived ${v.arrived_at?.toISOString?.()}, completed ${v.completed_at?.toISOString?.()}`);
  check(v.en_route_at <= v.arrived_at && v.arrived_at <= v.completed_at, 'and in order');
  const { rows: [ph] } = await db.query(`select count(*)::int n from visit_photos where visit_id = $1`, [planted.visit]);
  check(ph.n === 1 && v.photos === 1, 'with its photo stored and attached', `${ph.n} stored, ${v.photos} on the visit`);
} catch (e) {
  no('the walk ran to the end', String(e.message ?? e).slice(0, 300));
} finally {
  await browser?.close().catch(() => {});
  console.log('\nE. remove what was planted, and count both sides');
  const ids = [planted.visit, planted.subscription, planted.customer, planted.property].filter(Boolean);
  // The owner-facing notice Mark done queued names the visit, subscription or customer.
  if (ids.length) {
    await db.query(`delete from outbox where payload::text ~ $1`, [ids.join('|')]).catch((e) => no('outbox cleanup', e.message));
  }
  if (planted.visit) await db.query(`delete from visit_photos where visit_id = $1`, [planted.visit]).catch(() => {});
  if (planted.visit) await db.query(`delete from visits where id = $1`, [planted.visit]).catch((e) => no('visit cleanup', e.message));
  if (planted.subscription) await db.query(`delete from subscriptions where id = $1`, [planted.subscription]).catch((e) => no('subscription cleanup', e.message));
  if (planted.property) await db.query(`delete from properties where id = $1`, [planted.property]).catch((e) => no('property cleanup', e.message));
  if (planted.customer) await db.query(`delete from customers where id = $1`, [planted.customer]).catch((e) => no('customer cleanup', e.message));
  if (codeId) await db.query(`delete from verification_codes where id = $1`, [codeId]).catch(() => {});

  const after = await counts();
  for (const t of TABLES.filter((t) => t !== 'events')) {
    check(after[t] === before[t], `${t}: ${before[t]} before, ${after[t]} after`);
  }
  const { rows: [ev] } = await db.query(`select count(*)::int n from events where subject_id = any($1::uuid[])`, [ids]);
  console.log(`  NOTE  events: ${before.events} before, ${after.events} after — ${ev.n} rows about the planted stop stay, because events refuses DELETE`);
  await db.end().catch(() => {});
}

console.log(`\n${fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`}`);
process.exit(fail ? 1 : 0);
