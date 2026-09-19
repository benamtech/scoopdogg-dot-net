/**
 * No credential ever reaches a browser.
 *
 *   node gates/no-secret-in-admin.mjs        # source + any built pages present
 *
 * P18 §5. Two different mistakes, both of which have shipped in this repository's predecessor:
 * a key pasted into a file, and a key read from the environment into something that gets sent to
 * a client. The old Scoop Dogg admin queried Supabase directly with an anon key that shipped in
 * the bundle and could read every lead - 24 rows of names, phones and addresses over HTTP 200.
 * That is the failure this gate exists for.
 *
 * It scans, in order: everything that ships to a browser (src/, and dist/ when it has been
 * built), then the server files for a literal key, and finally checks that no admin response
 * body is built from a STRIPE_SECRET / SESSION_SECRET / RESEND / webhook value. Rule 12 in the
 * brain says no secret value enters a model's context; this is the same rule pointed at the
 * customer's browser.
 */
import { readFileSync, globSync, existsSync } from 'node:fs';

const KEY = /\b(sk_(live|test)_[A-Za-z0-9]{6,}|rk_(live|test)_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{6,}|re_[A-Za-z0-9]{20,})\b/;
const SECRET_ENV = /process\.env\.(STRIPE_SECRET_KEY\w*|SESSION_SECRET|RESEND_API_KEY|STRIPE_WEBHOOK_SECRET\w*|DATABASE_URL|POSTGRES_URL)/g;

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

// 1. nothing that ships to a browser contains a key-shaped string.
{
  const browser = [...globSync('src/**/*.{ts,tsx,astro,js,css}'), ...(existsSync('dist') ? globSync('dist/**/*.{html,js,css,txt,xml}') : [])];
  const hits = browser.filter((f) => KEY.test(readFileSync(f, 'utf8')));
  hits.length ? no('no key-shaped string in anything a browser receives', `${hits.length}: ${hits.slice(0, 3)}`)
              : ok('no key-shaped string in anything a browser receives', `${browser.length} files`);
}

// 2. no literal key anywhere in the server either - a key in a file is a key in git.
//
// THE ONE EXEMPTION, and it is deliberately narrow: a line carrying the words "negative control"
// is a planted string proving this detector can go red, and the file below is full of them. The
// exemption is one visible phrase rather than a filename, so a real key would have to be written
// on a line that claims to be a control - which is the sort of thing a reader notices.
const withoutControls = (src) => src.split('\n').filter((l) => !l.includes('negative control')).join('\n');
{
  const server = [...globSync('api/**/*.ts'), ...globSync('server/**/*.ts'), ...globSync('scripts/**/*.mjs'), ...globSync('gates/**/*.mjs')];
  // A prefix CHECK (`key.startsWith('sk_test_')`) is not a key: it has no key MATERIAL after the
  // prefix, so KEY's {6,} tail is what separates the two without needing a list of exceptions.
  const real = server.filter((f) => KEY.test(withoutControls(readFileSync(f, 'utf8'))));
  real.length ? no('no literal credential in the repository', `${real.slice(0, 3)}`)
              : ok('no literal credential in the repository', `${server.length} files`);
}

// 3. the admin's responses are built from rows, never from a secret-bearing variable.
{
  const admin = readFileSync('api/admin.ts', 'utf8');
  const uses = [...admin.matchAll(SECRET_ENV)].map((m) => m[1]);
  uses.length ? no('api/admin.ts reads no secret from the environment at all', uses.join(', '))
              : ok('api/admin.ts reads no secret from the environment at all');
}

// 4. the connection the admin DOES surface is an account id, which is not a secret.
{
  const stripeTs = readFileSync('server/lib/stripe.ts', 'utf8');
  /select livemode, account_id/.test(stripeTs)
    ? ok('the connection row the admin reads carries acct_ and no token')
    : no('the connection row the admin reads carries acct_ and no token');
}

// ---- negative controls ----------------------------------------------------------------------
KEY.test('const k = "sk_live_51JxAbCdEfGhIjKl";') ? ok('negative control: a planted live key trips it')
  : no('negative control: a planted live key trips it', 'DETECTOR BLIND');
KEY.test('const k = "whsec_abc123def456";') ? ok('negative control: a planted webhook secret trips it')
  : no('negative control: a planted webhook secret trips it', 'DETECTOR BLIND');
SECRET_ENV.test('process.env.SESSION_SECRET') ? ok('negative control: a secret read from the environment trips it')
  : no('negative control: a secret read from the environment trips it', 'DETECTOR BLIND');

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
