/**
 * Ask the mail provider what became of every message we accepted but never resolved.
 *
 *   node --env-file=.env.local --env-file=../../.env scripts/reconcile-deliveries.mjs
 *
 * Both env files, in that order: .env.local has this project's DATABASE_URL and a
 * placeholder RESEND_API_KEY, so the real sending credential has to come after it to win.
 *
 * This is the other half of server/lib/notify.ts. A 200 from the provider means the message
 * was ACCEPTED, so notify.ts only ever writes `delivering`. The terminal state - delivered,
 * or failed with a bounce or a complaint - is an observed fact, and this is what observes
 * it. Until the site is on Vercel and this can be a cron, it is a command somebody runs.
 *
 * Safe to run at any time, as often as you like. It only ever looks at rows that are still
 * unresolved, and applying the same event twice leaves the same row.
 */
import { compileServer, cleanupCompile } from '../gates/_compile.mjs';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const key = process.env.RESEND_API_KEY || '';
if (!key.startsWith('re_')) {
  console.error('RESEND_API_KEY is not a Resend credential (no re_ prefix), so delivery state ' +
                'cannot be read. Re-run with --env-file=../../.env after .env.local.');
  console.error('Refusing rather than reporting every message unresolved — an unreadable ' +
                'provider is not an undelivered message.');
  process.exit(1);
}

try {
  compileServer();
  const { reconcileOutbox } = await import(`../.gate-build/server/lib/delivery.js?t=${Date.now()}`);
  const report = await reconcileOutbox(200);
  for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(18)} ${v}`);
  if (report.unreadable) {
    console.log(`  ${report.unreadable} row(s) could not be read from the provider — ` +
                `unknown, not undelivered. Run again.`);
  }
} finally {
  cleanupCompile();
}
process.exit(0);
