/**
 * Open every admin screen in a real browser, signed in, and watch it render.
 *
 *   vercel env run -- node gates/admin-browser.mjs <deployment-url>
 *
 * gates/admin-e2e.mjs proves the API. It cannot prove the screens: a `client:load`
 * island that throws on first render still serves the same server HTML, so `curl` and
 * an HTML-presence check both read it as fine and the owner sees a blank page. Five of
 * the six admin routes had only ever been checked that way.
 *
 * So: a browser, a `pageerror` listener attached BEFORE the first navigation, every
 * response watched for 5xx, and an assertion on text that only exists once signed in —
 * /Leads/i matches the login screen's own chrome and proves nothing.
 *
 * The six-digit code normally arrives by email. This mints one with the same HMAC the
 * server uses, exactly as admin-e2e.mjs does, completes the real flow over HTTP, and
 * hands the resulting session cookie to the browser.
 *
 * Secrets are read from the environment and used, never printed. Behind Vercel
 * Deployment Protection the run also needs VERCEL_OIDC_TOKEN, which `vercel env run`
 * supplies and which is only ever set as a request header.
 */
import pg from 'pg';
import { createHmac, randomInt } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';

import { loadEnv } from '../scripts/_env.mjs';
// The same loader every other gate uses, so this runs on its own as well as under
// `vercel env run`. It fills only what the environment does not already carry, and it reads the
// preview token from .env.oidc.local (see scripts/_env.mjs) — never printed, header only.
loadEnv();
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: admin-browser.mjs <deployment-url>'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed — npm i -D playwright'); process.exit(1); }

// Same fallback as gates/admin-e2e.mjs: `vercel env pull` writes [SENSITIVE] for secret
// values, so the recorded copy in the brain is the only local source.
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

const SHOTS = process.env.SHOT_DIR || 'output/admin-screens';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  ok    ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m)      => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

const authHeaders = process.env.VERCEL_OIDC_TOKEN
  ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN }
  : {};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await client.connect();

// A row the detail screens must be able to show. Reported, never assumed.
const probe = await client.query(
  `select id, name, email from leads where name ilike '%AMTECH%' order by created_at desc limit 1`);
const probeLead = probe.rows[0] || null;
probeLead ? ok('probe lead present', `${probeLead.name} (${probeLead.id})`)
          : no('probe lead present', "no lead matching 'AMTECH' — the lead detail screen has nothing to render");

// contact_messages is empty before cutover, so the message screens would render an
// empty state and prove nothing. Seed one row directly — NOT through /api/contact,
// which emails Josue — and delete it again at the end.
const existing = await client.query(`select id from contact_messages order by created_at desc limit 1`);
let firstMessage = existing.rows[0]?.id || null;
let seededMessage = null;
if (!firstMessage) {
  const seeded = await client.query(
    `insert into contact_messages (name, email, phone, subject, message, source_page)
     values ('AMTECH SITE TEST', 'ben@amtechai.com', '', 'AMTECH SITE TEST',
             'Seeded by gates/admin-browser.mjs to prove the message screens render. Deleted at the end of the run.',
             '/contact')
     returning id`);
  firstMessage = seededMessage = seeded.rows[0].id;
}
firstMessage ? ok('probe message present', `${firstMessage}${seededMessage ? ' (seeded for this run)' : ''}`)
             : no('probe message present', 'contact_messages is empty and could not be seeded');

const email = 'ben@amtechai.com';
const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
await client.query(
  `insert into verification_codes (target_hash, code_hash, purpose, expires_at)
   values ($1, $2, 'admin_login', now() + interval '10 minutes')`,
  [hmac(email.toLowerCase()), hmac(`${email.toLowerCase()}:${code}`)]);

const verify = await fetch(`${base}/api/admin/login/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...authHeaders },
  body: JSON.stringify({ email, code }),
});
const cookies = verify.headers.getSetCookie?.() || [];
const session = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('sd_admin='));
let role = null;
try { role = (await verify.clone().json()).user?.role; } catch {}
verify.status === 200 && session
  ? ok('signed in over HTTP', `role=${role}`)
  : no('signed in over HTTP', `status=${verify.status}, cookie=${session ? 'set' : 'none'}`);

const browser = await chromium.launch();
/**
 * The protection header is added per request and only for the deployment's own origin.
 * Set as `extraHTTPHeaders` it also rides the Google Fonts requests, whose CORS
 * preflight rejects an unknown header — which then looks exactly like a page defect.
 */
const origin = new URL(base).origin;
async function newContext() {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (Object.keys(authHeaders).length) {
    await c.route('**/*', (route) => {
      const url = route.request().url();
      route.continue(url.startsWith(origin) ? { headers: { ...route.request().headers(), ...authHeaders } } : {});
    });
  }
  return c;
}
const ctx = await newContext();
const anon = await newContext();     // the control: same browser, no session cookie
if (session) {
  const i = session.indexOf('=');
  await ctx.addCookies([{
    name: session.slice(0, i), value: session.slice(i + 1),
    domain: new URL(base).hostname, path: '/', httpOnly: true, secure: true,
  }]);
}

/**
 * Each screen names text that can only have come from an authenticated read — a row out
 * of this database, not chrome. The login screen's own subtitle is "Leads, messages and
 * settings", so /Leads/i matches a signed-OUT page and proves nothing.
 *
 * Every needle is checked twice: it must be ABSENT without the session cookie and
 * PRESENT with it. That is the assertion falsifying itself on every run.
 */
const leadEmail = probeLead?.email || null;
const screens = [
  ['/admin',                          [/AMTECH SITE TEST/, /Recent Leads/],        'dashboard'],
  ['/admin/leads',                    [/AMTECH SITE TEST/],                        'leads list'],
  ['/admin/messages',                 [/AMTECH SITE TEST/],                        'messages list'],
  [`/admin/leads/${probeLead?.id}`,   [/AMTECH SITE TEST/, new RegExp(leadEmail ? leadEmail.replace(/[.+]/g, '\\$&') : 'never-matches')], 'lead detail'],
  [`/admin/messages/${firstMessage}`, [/AMTECH SITE TEST/, /Seeded by gates\/admin-browser\.mjs/], 'message detail'],
  // The four screens elevation-2026-09-16 changed, each with a needle that only an authenticated
  // read can produce. Every server feature on that branch shipped first with NO screen reading it,
  // so the screens are checked here in a browser, signed in — not assumed from a green typecheck.
  ['/admin/today',    [/No stop has been timed yet|stops? timed so far/],                      'today — the stop clock'],
  ['/admin/growth',   [/Where the next customer should come from/,
                       /Where visitors came from|left out of these numbers/],               'growth — channels and our own visits'],
  ['/admin/payments', [/Live payments/, /Monthly plans/],                                     'payments'],
  ['/admin/team',     [/\(you\)/, new RegExp(email.replace(/[.+]/g, '\\$&'))],              'team'],
];

async function visit(context, route, shot) {
  const page = await context.newPage();
  const thrown = [], consoleErrors = [], serverErrors = [];
  page.on('pageerror', (e) => thrown.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (shot) await page.screenshot({ path: shot, fullPage: true });

  // innerText, not a Playwright text matcher: a rendered <noscript> panel reads as
  // absent to a matcher and the screen looks fine while showing nothing.
  const text = await page.evaluate(() => document.body.innerText);
  const url = page.url();
  await page.close();
  return { text, url, thrown, consoleErrors, serverErrors };
}

for (const [route, needles, label] of screens) {
  if (/\/(null|undefined)$/.test(route)) { no(label, `no row id available for ${route}`); continue; }

  const control = await visit(anon, route, null);
  const leaked = needles.filter((re) => re.test(control.text));
  leaked.length
    ? no(`${label} — signed out`, `${route} shows signed-in data without a session: ${leaked.join(', ')}`)
    : ok(`${label} — signed out`, `${route} → ${new URL(control.url).pathname}, none of the needles present`);

  const shot = `${SHOTS}/${route.replace(/^\//, '').replace(/\//g, '_')}.png`;
  const r = await visit(ctx, route, shot);
  const missing = needles.filter((re) => !re.test(r.text));

  const problems = [];
  if (r.thrown.length) problems.push(`threw: ${r.thrown[0]}`);
  if (r.consoleErrors.length) problems.push(`console: ${r.consoleErrors[0]}`);
  if (r.serverErrors.length) problems.push(`5xx: ${r.serverErrors[0]}`);
  if (missing.length) problems.push(`signed-in data absent: ${missing.join(', ')}`);
  if (r.text.trim().length < 80) problems.push(`only ${r.text.trim().length} chars of visible text`);

  problems.length ? no(label, `${route} — ${problems.join('; ')}`)
                  : ok(label, `${route} — ${r.text.trim().length} chars, no console error, ${shot}`);
}

await browser.close();

// End the session this run opened. A check that leaves a live superadmin session behind
// every time it runs is a check with a side effect.
if (session) {
  const out = await fetch(`${base}/api/admin/logout`, { method: 'POST', headers: { Cookie: session, ...authHeaders } });
  const still = await fetch(`${base}/api/admin/leads`, { headers: { Cookie: session, ...authHeaders } });
  out.status === 200 && still.status === 401
    ? ok('session closed', 'logout 200, the cookie is then refused 401')
    : no('session closed', `logout=${out.status}, reuse=${still.status}`);
}

await client.query("delete from verification_codes where purpose = 'admin_login'");
if (seededMessage) {
  await client.query('delete from contact_messages where id = $1', [seededMessage]);
  const { rows } = await client.query('select count(*)::int n from contact_messages where id = $1', [seededMessage]);
  rows[0].n === 0 ? ok('seeded message removed', seededMessage)
                  : no('seeded message removed', `${seededMessage} is still there`);
}
await client.end();
console.log(`\n══ ${pass} passed, ${fail} failed ══\n`);
process.exit(fail ? 1 : 0);
