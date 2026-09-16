/**
 * Give a gate the environment it needs, however it was invoked.
 *
 * WHY. The gates are run two ways: by hand with `node --env-file=…`, and by the oracle in
 * client-portal-and-ai-employee-plans/finish/resolve.mjs, which runs each probe as a bare
 * command with no flags. A gate that only works under one of those is a gate that reports
 * "DATABASE_URL is not set — nothing was measured" to the oracle forever, which is an
 * honest answer to the wrong question. The environment is the gate's own dependency, so
 * the gate resolves it.
 *
 * RULE 12, AND WHY THIS SATISFIES IT. No value is returned upward, printed, logged or put
 * into an argument. Values go from the file straight into this process's own environment,
 * where the code that needs them already looks. The receipt is names, lengths and shapes.
 * This is the same deterministic-adapter pattern as
 * programs/dealing-with-emails/webhook/register-webhook.py, which cites the same rule.
 *
 * ORDER MATTERS AND IT IS THE OPPOSITE OF WHAT YOU EXPECT. .env.local is read first for
 * DATABASE_URL, then the brain's .env is allowed to OVERRIDE the mail credential, because
 * .env.local's RESEND_API_KEY is an 11-character placeholder. A gate running on the
 * placeholder watches every send fail and could call that "no leak" - the same shape as a
 * negative control that cannot go red.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Parse a KEY=VALUE file. Quotes stripped, comments and blanks ignored. */
function parse(file) {
  const out = new Map();
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out.set(k, v);
  }
  return out;
}

/** A Resend credential, or not. The prefix is the only reliable tell. */
export const isResendKey = (v) => typeof v === 'string' && v.startsWith('re_') && v.length >= 30;

/**
 * Fill in anything missing from .env.local, then let the brain's .env supply or replace
 * the mail credential. Returns a REDACTED receipt: names and shapes only.
 */
export function loadEnv({ root = process.cwd() } = {}) {
  const receipt = { files: [], database_url: 'absent', resend_key: 'absent' };

  const local = path.join(root, '.env.local');
  if (existsSync(local)) {
    receipt.files.push('.env.local');
    for (const [k, v] of parse(local)) if (!process.env[k]) process.env[k] = v;
  }

  // The brain's .env, two directories up from CLIENT-SITES/<repo>. It holds the real
  // sending credential; the client repo's copy is a placeholder.
  const brain = path.resolve(root, '..', '..', '.env');
  if (existsSync(brain)) {
    const vals = parse(brain);
    receipt.files.push('../../.env');
    for (const [k, v] of vals) {
      // Only the keys a gate legitimately needs, and only when what we have is not usable.
      if (k === 'RESEND_API_KEY' && !isResendKey(process.env.RESEND_API_KEY)) process.env[k] = v;
      if (k === 'DATABASE_URL' && !process.env.DATABASE_URL) process.env[k] = v;
      // Stripe: the brain names keys by owner (AMTECH_STRIPE_TEST_KEY), the server reads them by
      // mode (STRIPE_SECRET_KEY_TEST). The restricted AMTECH_STRIPE key is never mapped.
      if (k === 'AMTECH_STRIPE_TEST_KEY' && !process.env.STRIPE_SECRET_KEY_TEST) process.env.STRIPE_SECRET_KEY_TEST = v;
      if (k === 'AMTECH_STRIPE_LIVE_KEY' && !process.env.STRIPE_SECRET_KEY_LIVE) process.env.STRIPE_SECRET_KEY_LIVE = v;
    }
  }

  const db = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (db) {
    let host = 'unknown';
    try { host = new URL(db).host.split('.').slice(-3).join('.'); } catch { /* opaque */ }
    receipt.database_url = `present, host …${host}`;
  }
  const key = process.env.RESEND_API_KEY;
  receipt.resend_key = !key ? 'absent'
    : isResendKey(key) ? `present, ${key.length} chars, re_ prefix`
    : `present but NOT a Resend credential (${key.length} chars, no re_ prefix)`;

  receipt.stripe_test = process.env.STRIPE_SECRET_KEY_TEST?.startsWith('sk_test_') ? 'present, sk_test_' : 'absent';
  receipt.stripe_live = process.env.STRIPE_SECRET_KEY_LIVE?.startsWith('sk_live_') ? 'present, sk_live_' : 'absent';
  return receipt;
}
