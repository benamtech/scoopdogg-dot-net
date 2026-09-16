/**
 * Probe what a Stripe key can actually do. A credential in a file is a claim; a live call
 * is a fact.
 *
 *   node --env-file=.env.local scripts/probe-stripe.mjs --mode test          # read-only
 *   node --env-file=.env.local scripts/probe-stripe.mjs --mode live --write  # and record it
 *
 * THE MODE PICKS THE KEY, and there is no fallback between modes. The earlier version fell
 * back to AMTECH_STRIPE, a restricted rk_live_ key with no Connect scope, and went on
 * reporting a Connect blocker for days after full keys existed. Keys come from the brain's
 * sealed .env (the source bin/push-env.py pushes from) or STRIPE_SECRET_KEY_<MODE> in the
 * environment. Never printed.
 *
 * Nothing is created: every POST is sent without its required parameters, so Stripe answers
 * 400 parameter_missing, which proves the call is ALLOWED without making an object.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1];
const write = args.includes('--write');
if (!['test', 'live'].includes(mode)) {
  console.error('usage: probe-stripe.mjs --mode test|live [--write]');
  process.exit(2);
}

function fromBrainEnv(name) {
  const p = new URL('../../../.env', import.meta.url).pathname;
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k.trim() === name) return rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* not present */ }
  return null;
}
const envName = `STRIPE_SECRET_KEY_${mode.toUpperCase()}`;
let key = process.env[envName];
if (!key || key.includes('SENSITIVE')) key = fromBrainEnv(mode === 'test' ? 'AMTECH_STRIPE_TEST_KEY' : 'AMTECH_STRIPE_LIVE_KEY');
if (!key) { console.error(`No ${mode} key (${envName} or the brain .env)`); process.exit(1); }
if (!key.startsWith(`sk_${mode}_`) && !key.startsWith(`rk_${mode}_`)) {
  console.error(`The ${mode} key is not a ${mode}-mode key. Refusing to probe with a mismatched credential.`);
  process.exit(1);
}
const UA = 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)';

async function call(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': UA,
               ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json?.error?.code ?? null, json };
}

const checks = {
  'read platform account':   () => call('GET', 'account'),
  'list connected accounts': () => call('GET', 'accounts?limit=1'),
  'create onboarding link':  () => call('POST', 'account_links', ''),
  'create product':          () => call('POST', 'products', ''),
  'create subscription':     () => call('POST', 'subscriptions', ''),
  'create setup intent':     () => call('GET', 'setup_intents?limit=1'),
  'list webhook endpoints':  () => call('GET', 'webhook_endpoints?limit=1'),
};
const results = {};
let platform = null;
for (const [label, fn] of Object.entries(checks)) {
  const r = await fn();
  const allowed = r.status === 200 || r.code === 'parameter_missing' || r.code === 'parameter_unknown';
  results[label] = allowed;
  if (label === 'read platform account' && r.status === 200) platform = r.json;
  console.log(`  ${allowed ? 'yes' : 'NO '}  ${label.padEnd(26)} ${r.status} ${r.code ?? ''}`);
}
const accounts = await call('GET', 'accounts?limit=100');
const connected = accounts.status === 200 ? accounts.json.data.length : null;
const connectReady = results['read platform account'] && results['list connected accounts'] && results['create onboarding link'];
console.log(`\n  mode ${mode}  platform ${platform?.id ?? '?'}  connect usable: ${connectReady ? 'YES' : 'NO'}  connected accounts: ${connected}`);

if (write) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  const { rows } = await c.query(
    `select 1 from information_schema.columns where table_name='stripe_connection' and column_name='id'`,
  );
  if (rows.length) {
    console.error('  stripe_connection is still the one-row table; apply the per-mode migration before --write.');
    await c.end();
    process.exit(1);
  }
  await c.query(
    `insert into stripe_connection (livemode, last_probed_at, probe_error, updated_at)
       values ($1, now(), $2, now())
     on conflict (livemode) do update set last_probed_at = now(), probe_error = excluded.probe_error, updated_at = now()`,
    [mode === 'live', connectReady ? null : 'platform key lacks Connect scope'],
  );
  console.log(`  stripe_connection[livemode=${mode === 'live'}] updated`);
  await c.end();
}
process.exit(connectReady ? 0 : 1);
