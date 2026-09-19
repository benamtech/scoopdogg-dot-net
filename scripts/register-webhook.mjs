/**
 * Create (or re-point) the Connect webhook endpoint, and put its signing secret on Vercel.
 *
 *   node scripts/register-webhook.mjs --mode test [--url https://scoopdogg.net/api/stripe-webhook]
 *   node scripts/register-webhook.mjs --mode test --apply
 *
 * P17 §11 and P18 §1.7: this is an API call, not a dashboard chore, and it is the last thing
 * standing between `api/stripe-webhook.ts` and the events it already knows how to handle.
 *
 * `connect: true` is the whole point. Without it the endpoint receives events from the PLATFORM
 * account only, and every event that matters here - a customer paying a connected account, an
 * account's capabilities changing, a trial ending - happens on the connected account.
 *
 * RULE 12. The signing secret is returned by Stripe, piped straight into `vercel env add` through
 * a child process's stdin, and never printed, logged, stored in a file or returned upward. The
 * receipt is `whsec_` plus a length.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const mode = arg('--mode');
const apply = process.argv.includes('--apply');
const SCOPE = 'benamtechs-projects';
if (!['test', 'live'].includes(mode)) { console.error('usage: register-webhook.mjs --mode test|live [--url ...] [--apply]'); process.exit(2); }
const url = arg('--url', 'https://scoopdogg.net/api/stripe-webhook');

// P16 §9, P17 §11 and P18 §1: exactly what api/stripe-webhook.ts handles, and nothing else. An
// endpoint subscribed to events nobody handles is a retry queue filling up with 200s.
const EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'account.updated',
];

function fromBrainEnv(name) {
  const p = new URL('../../../.env', import.meta.url).pathname;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}
const key = process.env[`STRIPE_SECRET_KEY_${mode.toUpperCase()}`]
  || fromBrainEnv(mode === 'live' ? 'AMTECH_STRIPE_LIVE_KEY' : 'AMTECH_STRIPE_TEST_KEY');
if (!key?.startsWith(`sk_${mode}_`)) { console.error(`no usable sk_${mode}_ key`); process.exit(1); }

const stripe = async (path, body) => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)',
               ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const existing = await stripe('webhook_endpoints?limit=100');
if (existing.status !== 200) { console.error(`  cannot list endpoints: ${existing.status} ${existing.json?.error?.message ?? ''}`); process.exit(1); }
const match = (existing.json.data ?? []).find((e) => e.url === url);
console.log(`  mode ${mode}  ${existing.json.data?.length ?? 0} endpoint(s) on the platform`);
for (const e of existing.json.data ?? []) {
  console.log(`    ${e.status.padEnd(8)} connect=${String(e.application === null && e.metadata?.connect !== 'false')}  ${e.url}  (${e.enabled_events.length} events)`);
}

if (match) {
  const missing = EVENTS.filter((ev) => !match.enabled_events.includes(ev) && !match.enabled_events.includes('*'));
  console.log(`\n  an endpoint for this URL already exists: ${match.id}`);
  console.log(`  missing events: ${missing.length ? missing.join(', ') : 'none'}`);
  if (!missing.length) { console.log('\n  nothing to do.'); process.exit(0); }
  if (!apply) { console.log('\n  dry run — re-run with --apply to add them'); process.exit(0); }
  const body = new URLSearchParams();
  EVENTS.forEach((ev, i) => body.append(`enabled_events[${i}]`, ev));
  const r = await stripe(`webhook_endpoints/${match.id}`, body);
  console.log(r.status === 200 ? `  updated ${match.id} to ${EVENTS.length} events` : `  FAILED ${r.status} ${r.json?.error?.message ?? ''}`);
  process.exit(r.status === 200 ? 0 : 1);
}

if (!apply) {
  console.log(`\n  WOULD CREATE  ${url}\n    connect: true\n    events: ${EVENTS.join(', ')}`);
  console.log('\n  dry run — re-run with --apply');
  process.exit(0);
}

const body = new URLSearchParams({ url, connect: 'true', description: 'Scoop Dogg site — connected account events' });
EVENTS.forEach((ev, i) => body.append(`enabled_events[${i}]`, ev));
const created = await stripe('webhook_endpoints', body);
if (created.status !== 200) { console.error(`  FAILED ${created.status} ${created.json?.error?.message ?? ''}`); process.exit(1); }
const secret = created.json.secret;
console.log(`  created ${created.json.id} for ${url}`);
console.log(`  signing secret: ${secret ? `whsec_… ${secret.length} chars` : 'NOT RETURNED'}`);

// Straight into Vercel, through stdin. The value is in this process and nowhere else.
const name = `STRIPE_WEBHOOK_SECRET_${mode.toUpperCase()}`;
for (const target of ['production', 'preview', 'development']) {
  const r = await new Promise((resolve) => {
    const p = spawn('npx', ['vercel', 'env', 'add', name, target, '--scope', SCOPE], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.stdin.write(`${secret}\n`); p.stdin.end();
    p.on('close', (code) => resolve({ code, err }));
  });
  const ok = r.code === 0 || /already exists/i.test(r.err);
  console.log(`    ${name} ${target}: ${ok ? 'set' : `FAILED — ${(r.err || '').split('\n').find((l) => l.trim())}`}`);
}
console.log('\n  A deployment must be rebuilt to pick up the secret.');
