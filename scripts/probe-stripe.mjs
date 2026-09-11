/**
 * Probe what the Stripe key can actually do, and write the answer into
 * stripe_connection. A credential in a file is a claim; a live call is a fact.
 *
 *   node --env-file=.env.local scripts/probe-stripe.mjs
 *
 * Never prints the key. Prints one line per capability and updates the database so the
 * admin and every money verb read a measured state rather than an assumption.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

// Vercel stores these as sensitive, so `vercel env pull` writes the literal string
// "[SENSITIVE]" rather than the value. That is correct - the value is readable at
// runtime and not on a laptop. For a local run, fall back to the brain's own .env,
// which is the sealed source bin/push-env.py pushes from. The value is never printed.
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
let key = process.env.STRIPE_SECRET_KEY;
if (!key || key.includes('SENSITIVE')) key = fromBrainEnv('AMTECH_STRIPE');
if (!key) { console.error('No Stripe key available (STRIPE_SECRET_KEY or AMTECH_STRIPE in brain/.env)'); process.exit(1); }
const UA = 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)';

async function call(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': UA,
               ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json?.error?.code ?? null, json };
}

const checks = {
  'read balance':                 () => call('GET', 'balance'),
  'read platform account':        () => call('GET', 'account'),
  'list connected accounts':      () => call('GET', 'accounts?limit=1'),
  'create onboarding link':       () => call('POST', 'account_links'),
  'read payment intents':         () => call('GET', 'payment_intents?limit=1'),
  'create payment intent':        () => call('POST', 'payment_intents'),
};
const results = {};
for (const [label, fn] of Object.entries(checks)) {
  const r = await fn();
  // 400 parameter_missing means the call was ALLOWED and merely incomplete.
  const allowed = r.status === 200 || r.code === 'parameter_missing';
  results[label] = allowed;
  console.log(`  ${allowed ? 'yes' : 'NO '}  ${label.padEnd(26)} ${r.status} ${r.code ?? ''}`);
}

const connectReady = results['read platform account'] && results['list connected accounts'] && results['create onboarding link'];
console.log(`\n  Stripe Connect usable: ${connectReady ? 'YES' : 'NO'}`);
if (!connectReady) {
  console.log('  The key authenticates but lacks Connect scope. In the Stripe dashboard,');
  console.log('  edit this restricted key and grant WRITE on Connect > Accounts, plus read');
  console.log('  on Account. Nothing else in the site is blocked by this.');
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query(
  `update stripe_connection set
     charges_enabled = $1, details_submitted = false,
     requirements_due = $2::jsonb, disabled_reason = $3,
     last_probed_at = now(), probe_error = $4, livemode = $5, updated_at = now()
   where id = true`,
  // charges_enabled must mean "we can charge a customer FOR SCOOP DOGG", which is a
  // Connect direct charge on his connected account. Being able to create a payment
  // intent on AMTECH's own platform account is not that. Setting this true because the
  // platform can take a payment is how a money verb ends up charging the wrong account.
  [connectReady && Boolean(results['create payment intent']),
   JSON.stringify(Object.entries(results).filter(([, v]) => !v).map(([k]) => k)),
   connectReady ? null : 'stripe_key_missing_connect_scope',
   connectReady ? null : 'Restricted key authenticates but has no Connect permissions',
   key.includes('_live_')]);
console.log('\n  stripe_connection updated from the probe');
await c.end();
