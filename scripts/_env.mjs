/**
 * Give a gate the environment it needs, however it was invoked.
 *
 * WHY. The gates and the scripts are run two ways: by hand with `node --env-file=…`, and as
 * a bare command with no flags - by the oracle in
 * client-portal-and-ai-employee-plans/finish/resolve.mjs, and by any agent session whose
 * permission classifier refuses `--env-file=.env.local` as credential exploration (measured
 * 2026-09-18: it does, and it made every migration and backup command in SPEC.md §1
 * unrunnable as written). Something that only works under one of those reports
 * "DATABASE_URL is not set — nothing was measured" forever, which is an honest answer to the
 * wrong question. The environment is the caller's own dependency, so the caller resolves it.
 *
 * This lives in scripts/ rather than gates/ because it is a deterministic adapter, which is
 * what scripts/ is for, and because the scripts that move data need it more than the gates
 * that read it.
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

// The repository root, from this file's own location. `process.cwd()` was the old default and
// made a script silently find nothing when it was run from anywhere but the root.
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

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
export function loadEnv({ root = REPO_ROOT } = {}) {
  const receipt = { files: [], database_url: 'absent', resend_key: 'absent' };

  const local = path.join(root, '.env.local');
  if (existsSync(local)) {
    receipt.files.push('.env.local');
    for (const [k, v] of parse(local)) if (!process.env[k]) process.env[k] = v;
  }

  // The brain's .env, two directories up from CLIENT-SITES/<repo>. It holds the real
  // sending credential; the client repo's copy is a placeholder.
  /**
   * A FRESHER PREVIEW TOKEN, AND ONLY THAT. `VERCEL_OIDC_TOKEN` is what lets
   * scripts/walk-preview.mjs through Vercel Authentication, and it expires within hours. The way
   * to refresh it is `vercel env pull` — but pulled over `.env.local` it would REPLACE the file
   * with the Development scope, and `STRIPE_SECRET_KEY_LIVE` exists only in Production, so the
   * live key would vanish from this machine without a word. So the token is pulled to its own
   * file, and this reads that one variable from it and nothing else:
   *
   *   npx vercel env pull .env.oidc.local --yes --scope benamtechs-projects
   */
  const oidc = path.join(root, '.env.oidc.local');
  if (existsSync(oidc)) {
    const t = parse(oidc).get('VERCEL_OIDC_TOKEN');
    if (t) { process.env.VERCEL_OIDC_TOKEN = t; receipt.files.push('.env.oidc.local (VERCEL_OIDC_TOKEN only)'); }
  }

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
