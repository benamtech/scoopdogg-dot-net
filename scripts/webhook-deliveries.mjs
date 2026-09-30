/**
 * What Stripe tried to deliver to the Connect webhook and could not. Read-only.
 *
 *   node scripts/webhook-deliveries.mjs --mode live [--since 2026-09-23]
 *
 * WHY THIS EXISTS. On 2026-09-23 the live Connect endpoint was registered against
 * https://scoopdogg.net/api/stripe-webhook while production still ran `main`, which has no such
 * route: every event Stripe sent answered 404 until the merge. After the merge, each event Stripe
 * marked failed must be either resent or shown to have changed nothing. This lists them, for the
 * platform and for the connected account (Connect events live on the account, so a platform-only
 * read would report zero and be wrong).
 *
 * `delivery_success=false` is Stripe's own filter: events that failed to reach at least one
 * endpoint. Nothing here writes, and no key is printed.
 */
import path from 'node:path';
import { loadEnv } from './_env.mjs';
import { compileServer } from '../gates/_compile.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const mode = arg('--mode');
if (!['test', 'live'].includes(mode)) { console.error('usage: webhook-deliveries.mjs --mode test|live [--since YYYY-MM-DD]'); process.exit(2); }
const since = Math.floor(new Date(arg('--since', '2026-09-23')).getTime() / 1000);

loadEnv();
const build = compileServer();
const s = await import(path.join(build, 'server/lib/stripe.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));
try {
  const stripe = s.stripeFor(mode);
  const conn = await s.connection(mode);
  const scopes = [['platform', undefined], ...(conn?.account_id ? [[`account ${conn.account_id}`, conn.account_id]] : [])];
  let total = 0;
  for (const [label, account] of scopes) {
    const failed = [];
    for await (const e of stripe.events.list({ delivery_success: false, created: { gte: since }, limit: 100 }, account ? { stripeAccount: account } : undefined)) {
      failed.push(e);
    }
    total += failed.length;
    console.log(`\n  ${label}: ${failed.length} event(s) not delivered since ${new Date(since * 1000).toISOString().slice(0, 10)}`);
    const byType = new Map();
    for (const e of failed) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${t}`);
    for (const e of failed.slice(0, 40)) {
      console.log(`    ${e.id}  ${new Date(e.created * 1000).toISOString().slice(0, 16)}  ${e.type}  pending_webhooks=${e.pending_webhooks}`);
    }
  }
  console.log(`\n  total: ${total}`);
} finally {
  await db().end().catch(() => {});
}
