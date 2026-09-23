/**
 * Is promoting this branch to production a no-op for AMTECH?
 *
 *   node gates/promotion-ready.mjs          # the whole contract
 *   node gates/promotion-ready.mjs --owner  # print only what is left for the owner
 *
 * THE QUESTION THIS ANSWERS, in Ben's words: "when we promote it to production we don't have to
 * do anything on our end besides Josue connecting his Stripe account." That is a promise with a
 * lot of moving parts behind it, and every part of it has a failure mode where the site looks
 * fine and takes no money. This is the list, checked rather than remembered.
 *
 * WHY IT IS NOT IN `npm run gates`. The default suite answers "is the code right". This answers
 * "is the deployment ready", which is a different question about a different object and can be
 * legitimately red for days while the code is green — migrations written but not yet applied, a
 * webhook not yet registered. `gates/deployed.mjs` is in the same class and lives the same way,
 * behind `npm run gates:promotion`. A red here is a TASK LIST, not a broken build.
 *
 * WHAT IT WILL NOT DO: pass by lowering the bar. Every check names the thing that would be
 * broken for a customer if it were skipped.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const owner = [];
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  TODO  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const one = async (q, v) => (await c.query(q, v)).rows[0];

try {
  // ---- A. the repository and the database it will run against agree ------------------------
  console.log('A. the database is where the code expects it');
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await c.query('select name from _migrations')).rows.map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f));
  check(pending.length === 0,
    'every migration in the repository is applied to this database',
    pending.length
      ? `${pending.length} pending: ${pending.join(', ')} — run: node scripts/run-migrations.mjs`
      : `${files.length} migrations`);

  /**
   * DOWN MIGRATIONS, AS A RATCHET RATHER THAN AN ABSOLUTE. 001-010 predate the convention: they
   * are the original schema and reverting 001 means dropping the database, which is not a
   * migration, it is a decision. Everything from 011 on has one and must keep having one, so the
   * rule is "no NEW migration lands without its revert" and the ten are named rather than
   * excluded silently.
   */
  const CONVENTION_FROM = 11;
  const numbered = (f) => Number(f.slice(0, 3));
  const noDown = files.filter((f) => numbered(f) >= CONVENTION_FROM
    && !existsSync(`migrations/down/${f.replace('.sql', '.down.sql')}`));
  const legacy = files.filter((f) => numbered(f) < CONVENTION_FROM);
  check(noDown.length === 0, `every migration from ${String(CONVENTION_FROM).padStart(3, '0')} on can be reverted`,
    noDown.length ? noDown.join(', ') : `${files.length - legacy.length} reversible; ${legacy.length} original-schema migrations predate the convention`);

  // A schema change that ships without its reader is the shape this project keeps paying for.
  for (const [table, column, why] of [
    ['area_postal_codes', 'populated_lat', 'density.ts ranks cities on the polygon centre without it — 93001 sits in the ocean'],
    ['funnel_sessions', 'source', "the growth board counts AMTECH's own gate runs as the client's funnel without it"],
    ['visits', 'arrived_at', 'no visit duration can be recorded without it, so the price ladder stays circular'],
  ]) {
    const n = (await one(`select count(*)::int n from information_schema.columns where table_name=$1 and column_name=$2`, [table, column])).n;
    check(n === 1, `${table}.${column} exists`, n === 1 ? '' : why);
  }

  // ---- B. money: what a customer meets on the day it goes live ------------------------------
  console.log('\nB. the money path');
  const conn = await one(`select account_id, card_payments_status, revoked_at from stripe_connection where livemode = true`);
  const connected = Boolean(conn?.account_id) && !conn?.revoked_at;

  if (!connected) {
    ok('the live Stripe account is not connected yet — and that is the owner\'s step, not ours',
      'server/lib/stripe.ts publishPricesWhenReady() publishes the price list the moment it is');
    owner.push('Josue connects Stripe: /admin -> Payments -> Connect. Everything after it is automatic.');
  } else {
    const gap = await one(
      `select count(*)::int n from packages p where p.status = 'active'
        and not exists (select 1 from stripe_prices sp where sp.package_id = p.id
                        and sp.version = p.version and sp.livemode = true and sp.account_id = $1)`,
      [conn.account_id]);
    check(gap.n === 0, 'every active package has a live Stripe price',
      gap.n ? `${gap.n} package(s) unpublished — a customer reaching checkout gets an error` : conn.account_id);
    check(conn.card_payments_status === 'active', 'the live account can take a card',
      `card_payments is ${conn.card_payments_status ?? 'unread'}`);
  }

  /**
   * THE PUBLISH HAS TWO TRIGGERS AND NEITHER IS A HUMAN. Checked in the source, because the
   * whole promise ("nothing on our end") rests on this not being a button somebody remembers.
   */
  const stripeTs = readFileSync('server/lib/stripe.ts', 'utf8');
  const webhookTs = readFileSync('api/stripe-webhook.ts', 'utf8');
  const adminTs = readFileSync('api/admin.ts', 'utf8');
  check(/export async function publishPricesWhenReady/.test(stripeTs), 'the automatic publisher exists');
  check(/publishPricesWhenReady\(mode, 'webhook:account\.updated'\)/.test(webhookTs),
    "Stripe's account.updated publishes the prices", 'trigger 1');
  check(/publishPricesWhenReady\(m, 'admin:payments'\)/.test(adminTs),
    'and so does opening the Payments screen, which is where onboarding returns him', 'trigger 2 — not dependent on a webhook');

  // ---- C. the webhook: registered, and matching what the code handles -----------------------
  console.log('\nC. the webhook');
  const out = compileServer();
  const { CARD_EVENTS } = await import(`${process.cwd()}/${out}/server/lib/cards.js`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
  const register = readFileSync('scripts/register-webhook.mjs', 'utf8');
  const registered = [...register.slice(register.indexOf('const EVENTS = ['), register.indexOf('];', register.indexOf('const EVENTS = [')))
    .matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]);
  const handled = [...new Set([...webhookTs.matchAll(/event\.type === '([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]))];
  check([...handled, ...CARD_EVENTS].every((e) => registered.includes(e)),
    'every event the code handles is one the endpoint subscribes to',
    `${registered.length} subscribed, ${handled.length + CARD_EVENTS.length} handled`);

  /**
   * THE ENDPOINT EXISTS IN STRIPE, not just in our script's list.
   *
   * `scripts/register-webhook.mjs` holds the events we intend to subscribe to, and the check
   * above resolves the handler against that list — but both halves can agree perfectly while no
   * endpoint has ever been created, which is exactly the state this project was in on
   * 2026-09-23: eleven events named in two files and zero endpoints registered. So this asks
   * Stripe.
   */
  const PROD_URL = 'https://scoopdogg.net/api/stripe-webhook';
  for (const m of ['live', 'test']) {
    const key = m === 'live' ? process.env.STRIPE_SECRET_KEY_LIVE : process.env.STRIPE_SECRET_KEY_TEST;
    if (!key) { no(`the ${m} webhook endpoint is registered`, `no STRIPE_SECRET_KEY_${m.toUpperCase()} in this environment to ask with`); continue; }
    const r = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)' },
    }).then((x) => x.json()).catch((e) => ({ error: { message: String(e.message) } }));
    if (r.error) { no(`the ${m} webhook endpoint is registered`, r.error.message); continue; }
    const ep = (r.data ?? []).find((e) => e.url === PROD_URL);
    const missing = ep ? [...handled, ...CARD_EVENTS].filter((e) => !ep.enabled_events.includes(e) && !ep.enabled_events.includes('*')) : null;
    // A Connect endpoint carries the platform's Connect application id. An account-level
    // endpoint (application: null) receives the PLATFORM's own events and none of the connected
    // account's — which is every event that matters here.
    const isConnect = ep && typeof ep.application === 'string' && ep.application.startsWith('ca_');
    check(Boolean(ep) && ep.status === 'enabled' && missing.length === 0 && isConnect,
      `the ${m} webhook endpoint is registered at ${PROD_URL}`,
      !ep ? `no endpoint for that URL — run: node scripts/register-webhook.mjs --mode ${m} --apply`
        : ep.status !== 'enabled' ? `it exists but is ${ep.status}`
          : missing.length ? `missing ${missing.join(', ')} — re-run register-webhook.mjs --mode ${m} --apply`
            : !isConnect ? 'it is an account-level endpoint, not a Connect one — it will receive none of the connected account\'s events'
            : `${ep.id}, ${ep.enabled_events.length} events, connect=${typeof ep.application === 'string' && ep.application.startsWith('ca_')}`);
    if (!ep) owner.push(`AMTECH: register the ${m} webhook — node scripts/register-webhook.mjs --mode ${m} --apply`);
  }

  /**
   * DELIVERY IS NOT OURS TO CAUSE. `connect: true` means the endpoint receives events from
   * CONNECTED accounts, and there is no live connected account until Josue finishes onboarding —
   * so an empty `stripe_events` is the correct state today and failing on it would make this
   * gate permanently red for a reason nobody here can fix. It is reported, and it is the first
   * thing to look at the moment he connects.
   */
  const events = await one(`select count(*)::int n from stripe_events`);
  if (events.n > 0) {
    ok('Stripe events are arriving', `${events.n} recorded`);
  } else if (connected) {
    no('Stripe events are arriving', 'an account is connected and nothing has ever been delivered — check the endpoint');
  } else {
    ok('no Stripe event has arrived, which is correct with no connected account',
      'connect: true delivers connected-account events, and there is no live account yet');
    owner.push('The moment Josue connects: `select count(*) from stripe_events` should stop being 0. '
      + 'If it stays 0, the endpoint is registered against the wrong account or URL.');
  }

  // ---- D. what the site says about itself ---------------------------------------------------
  console.log('\nD. the site in production');
  const demo = await one(`select value #>> '{}' as v from settings where key = 'demo.mode'`);
  check(demo?.v === 'false', 'demo mode is off', `demo.mode = ${demo?.v}`);

  const reviews = await one(`select (select value::int from settings where key='reviews.google_count') as google,
                                    (select count(*)::int from reviews) as quoted`);
  check(reviews.google !== null && Number(reviews.google) >= Number(reviews.quoted),
    'the published review count is the Google count, not the curated one',
    reviews.google === null ? 'reviews.google_count is unset — the site will say "18 reviews on this page"'
      : `${reviews.google} on Google, ${reviews.quoted} quoted`);

  const ours = await one(`select count(*)::int n from information_schema.columns where table_name='funnel_sessions' and column_name='source'`);
  if (ours.n === 1) {
    const board = await one(`select count(*) filter (where source is null or source not in ('gate','gate-retro'))::int as real,
                                    count(*) filter (where source in ('gate','gate-retro'))::int as ours from funnel_sessions`);
    ok("the owner's funnel numbers exclude AMTECH's own runs", `${board.real} real sessions, ${board.ours} of ours filtered out`);
  } else {
    no("the owner's funnel numbers exclude AMTECH's own runs", 'migration 033 is not applied — all 25 sessions read as customers');
  }

  // ---- E. the environment, named in one place ------------------------------------------------
  console.log('\nE. the environment');
  /**
   * Every variable the shipped code reads, and which Vercel scope must carry it. Listed here so
   * that adding a `process.env.X` with no home is a red line rather than a 500 on the first
   * request that needs it. Checked against the tree, not against memory.
   */
  const REQUIRED = {
    DATABASE_URL: 'Production, Preview, Development',
    SESSION_SECRET: 'Production, Preview, Development',
    RESEND_API_KEY: 'Production, Preview, Development',
    STRIPE_SECRET_KEY_LIVE: 'Production',
    STRIPE_SECRET_KEY_TEST: 'Production, Preview, Development',
    STRIPE_WEBHOOK_SECRET_LIVE: 'Production',
    STRIPE_WEBHOOK_SECRET_TEST: 'Production, Preview, Development',
    POSTGRES_URL: 'Production, Preview, Development (fallback for DATABASE_URL)',
    PUBLIC_SITE_URL: 'optional — falls back to the canonical host',
    SD_FORCE_DEMO: 'Preview only — it is what makes a preview safe to click through',
    SD_DEMO_ADDRESS: 'optional — demo.address covers it',
  };
  const readInCode = [...new Set([...readFileSync('server/lib/db.ts', 'utf8')
    .concat(['server', 'api', 'src'].flatMap((d) => '').join(''))
    .matchAll(/process\.env\.([A-Z_0-9]+)/g)].map((m) => m[1]))];
  const allCode = ['server', 'api', 'src'].flatMap(function walk(d) {
    return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${d}/${e.name}`) : (/\.(ts|tsx|astro|mjs)$/.test(e.name) ? [readFileSync(`${d}/${e.name}`, 'utf8')] : []));
  }).join('\n');
  const used = [...new Set([...allCode.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map((m) => m[1]))].sort();
  const unlisted = used.filter((v) => !(v in REQUIRED));
  check(unlisted.length === 0, 'every environment variable the code reads is named in this gate',
    unlisted.length ? `${unlisted.join(', ')} — add it here with the scope it needs, or stop reading it` : `${used.length} variables`);
  console.log('    variables and the scope each needs:');
  for (const v of used) console.log(`      ${v.padEnd(28)} ${REQUIRED[v]}`);
  console.log('    verify with: npx vercel env ls --scope benamtechs-projects');

  // ---- what is left for a human --------------------------------------------------------------
  if (owner.length) {
    console.log('\nleft for the owner, and only the owner:');
    for (const o of owner) console.log(`  - ${o}`);
  }
} catch (e) {
  no('the gate ran to the end', String(e.message ?? e));
} finally {
  await c.end().catch(() => {});
  cleanupCompile();
}

console.log(`\nRESULT: ${pass} ready, ${fail} still to do`);
console.log(fail === 0
  ? 'Promotion is a no-op for AMTECH. Josue connects Stripe and the rest is automatic.'
  : 'Promotion is NOT yet a no-op. The TODO lines above are the list.');
process.exit(fail === 0 ? 0 : 1);
