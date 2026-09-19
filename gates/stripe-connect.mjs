/**
 * Connecting and disconnecting are safe in the order they happen.
 *
 *   node gates/stripe-connect.mjs
 *
 * P18 §5. The gate P18 originally specified checked an OAuth `state` token — reusable, expiring,
 * bound to the admin session. THERE IS NO OAUTH HERE and there cannot be: Stripe's Accounts v2
 * documentation lists "Using OAuth to authenticate connected accounts" among the cases where you
 * must use Accounts v1, and v1 account creation is refused for this platform. So the three things
 * worth proving about the v2 path are different, and this is them:
 *
 *  1. ONBOARDING IS BEHIND A SESSION. The route that mints a Stripe onboarding link sits below
 *     api/admin.ts's session check, where everything after `getSession` lives. A link minted for
 *     an anonymous caller is an invitation to attach an account to somebody else's business.
 *
 *  2. THE FEE COMES OFF BEFORE WE STOP LOOKING. Stripe keeps collecting `application_fee_percent`
 *     after a disconnect (P17 §8), so `disconnect()` must clear it FIRST and must not record the
 *     revocation if clearing failed. Charging a client who has left is the worst thing this
 *     integration could do by accident, and it would do it quietly.
 *
 *  3. WE NEVER CLOSE THE CLIENT'S ACCOUNT. `/v2/core/accounts/:id/close` answers
 *     `stripe_loss_liable_cannot_be_deleted` for a full-dashboard account anyway, but the reason
 *     not to call it is simpler: it is his account, with his customers and his history in it.
 */
import { readFileSync } from 'node:fs';

const stripeTs = readFileSync('server/lib/stripe.ts', 'utf8');
const admin = readFileSync('api/admin.ts', 'utf8');
/** Comments explain why the OAuth path was rejected, so the remnant check reads CODE only. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

// 1. every payments route is below the session guard.
const guardAt = admin.indexOf('const session = await getSession(req)');
const routesBelowSession = (src) => {
  const at = src.indexOf('const session = await getSession(req)');
  if (at < 0) return false;
  return ['payments/onboard', 'payments/disconnect', 'payments/publish', 'customers/invite']
    .every((p) => { const i = src.indexOf(`'${p}'`); return i > at; });
};
routesBelowSession(admin)
  ? ok('onboarding, disconnect, publish and invite all sit behind a session', `guard at char ${guardAt}`)
  : no('onboarding, disconnect, publish and invite all sit behind a session');

// 2. the order inside disconnect(), read as positions in the function body.
const body = stripeTs.slice(stripeTs.indexOf('export async function disconnect('));
const fnEnd = body.indexOf('\n}\n');
const disconnectBody = body.slice(0, fnEnd);
const feeFirst = (src) => {
  const clear = src.indexOf('clearPlatformFee');
  const revoke = src.indexOf('revoked_at = now()');
  const refuse = src.indexOf('platform_fee_not_cleared');
  return clear >= 0 && revoke > clear && refuse > clear && refuse < revoke;
};
feeFirst(disconnectBody)
  ? ok('disconnect clears the fee first, and refuses to record a revocation if it could not')
  : no('disconnect clears the fee first, and refuses to record a revocation if it could not');

// 3. nothing closes or deletes the connected account.
const closesAccount = (src) => /accounts\.close|accounts\.del\(|\/close'/.test(src);
closesAccount(code(stripeTs)) ? no('the platform never closes the client\'s Stripe account')
                        : ok('the platform never closes the client\'s Stripe account');

// 4. no OAuth remnant. A half-removed mechanism is worse than either mechanism.
const oauthLeft = /connect\.stripe\.com\/oauth|stripe_oauth_states|oauth\/deauthorize/.test(code(stripeTs) + code(admin));
oauthLeft ? no('no OAuth remnants in the shipped path', 'P18 §1 was rewritten to Accounts v2')
          : ok('no OAuth remnants in the shipped path');

// The remnant check must still see a real one.
/connect\.stripe\.com\/oauth/.test(code("const u = 'https://connect.stripe.com/oauth/authorize';"))
  ? ok('negative control: a real OAuth call trips the remnant check')
  : no('negative control: a real OAuth call trips the remnant check', 'DETECTOR BLIND');

// ---- negative controls ---------------------------------------------------------------------
const brokenOrder = disconnectBody
  .replace('const fee = await clearPlatformFee', 'const later = 1; const fee = await clearPlatformFee')
  .split('\n');
const swapped = [...brokenOrder];
// move the revoke UPDATE above the clear call
const revokeLine = swapped.findIndex((l) => l.includes('revoked_at = now()'));
const clearLine = swapped.findIndex((l) => l.includes('clearPlatformFee'));
if (revokeLine > -1 && clearLine > -1) swapped.splice(clearLine, 0, ...swapped.splice(revokeLine, 1));
feeFirst(swapped.join('\n'))
  ? no('negative control: revoking before clearing must trip this gate', 'DETECTOR BLIND')
  : ok('negative control: revoking before clearing trips it');
closesAccount('await stripe.v2.core.accounts.close(id)')
  ? ok('negative control: a close() call trips it')
  : no('negative control: a close() call trips it', 'DETECTOR BLIND');
routesBelowSession(admin.replace("const session = await getSession(req)", "const zzz = 1; // moved"))
  ? no('negative control: a payments route above the session guard must trip it', 'DETECTOR BLIND')
  : ok('negative control: a payments route above the session guard trips it');

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
