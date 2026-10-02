/**
 * Put the secrets the production check needs into GitHub Actions, without anyone seeing them.
 *
 *   node scripts/push-ci-secrets.mjs
 *
 * Each value is read into this process by scripts/_env.mjs and piped to `gh secret set` on stdin.
 * Nothing is printed except the name and a shape receipt (length and prefix check), the same rule
 * as scripts/register-webhook.mjs and bin/push-env.py (rule 12). Re-run it after rotating any key.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadEnv } from './_env.mjs';

loadEnv();
const REPO = 'benamtech/scoopdogg-dot-net';
const brain = (name) => {
  try {
    for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k.trim() === name) return rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
};
const session = process.env.SESSION_SECRET && !process.env.SESSION_SECRET.includes('SENSITIVE')
  ? process.env.SESSION_SECRET : brain('SCOOPDOGG_SESSION_SECRET');
const SECRETS = {
  DATABASE_URL: [process.env.DATABASE_URL, (v) => /^postgres(ql)?:\/\//.test(v)],
  STRIPE_SECRET_KEY_LIVE: [process.env.STRIPE_SECRET_KEY_LIVE, (v) => v.startsWith('sk_live_')],
  STRIPE_SECRET_KEY_TEST: [process.env.STRIPE_SECRET_KEY_TEST, (v) => v.startsWith('sk_test_')],
  RESEND_API_KEY: [process.env.RESEND_API_KEY, (v) => v.startsWith('re_') && v.length >= 30],
  SESSION_SECRET: [session, (v) => v.length >= 16],
};
let bad = 0;
for (const [name, [value, shape]] of Object.entries(SECRETS)) {
  if (!value || !shape(value)) { console.log(`  SKIP  ${name}: missing or the wrong shape — not pushed`); bad++; continue; }
  execFileSync('gh', ['secret', 'set', name, '--repo', REPO], { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
  console.log(`  set   ${name}  (${value.length} chars, shape ok)`);
}
process.exit(bad ? 1 : 0);
