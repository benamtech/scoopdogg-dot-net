/**
 * Connecting and disconnecting are safe in the order they happen.
 *
 *   node gates/stripe-connect.mjs
 *
 * P18 §5 specified an OAuth `state` token — expiring, bound to the admin session. From 2026-09-19
 * to 2026-10-03 there was no OAuth here, and this gate forbade it. It is back because Josue already
 * has a Stripe account, and hosted onboarding can only ever make a new one
 * (server/lib/stripe-oauth.ts). So the state token is checked again, with what a callback must do:
 *
 *  1. CONNECTING IS BEHIND A SESSION. The route that mints Stripe's link, and the callback that
 *     lands an account, sit below api/admin.ts's session check. Either one open to an anonymous
 *     caller is an invitation to attach an account to somebody else's business.
 *
 *  4. THE CALLBACK TRUSTS NOTHING IT DID NOT SIGN. It verifies the state (signed, this session,
 *     not expired) before it trades the code; and `connectWithCode()` refuses a code from the other
 *     mode, and refuses to replace a different account that can already charge, BEFORE it writes.
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
  return ['payments/onboard', 'payments/oauth-callback', 'payments/disconnect', 'payments/publish', 'customers/invite']
    .every((p) => { const i = src.indexOf(`'${p}'`); return i > at; });
};
routesBelowSession(admin)
  ? ok('connect, its callback, disconnect, publish and invite all sit behind a session', `guard at char ${guardAt}`)
  : no('connect, its callback, disconnect, publish and invite all sit behind a session');

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

// 4. the callback verifies before it trades, and the trade checks before it writes.
const callback = (src) => { const at = src.indexOf("'payments/oauth-callback'"); return at < 0 ? '' : src.slice(at, src.indexOf("if (path === '", at + 30)); };
const verifiesFirst = (src) => { const v = src.indexOf('verifyConnectState('), x = src.indexOf('connectWithCode('); return v >= 0 && x > v; };
const connectFn = stripeTs.slice(stripeTs.indexOf('export async function connectWithCode('));
const connectBody = connectFn.slice(0, connectFn.indexOf('\n}\n'));
const checksBeforeWrite = (src) => {
  const write = src.indexOf('insert into stripe_connection');
  const mode = src.indexOf("'mismatch'", src.indexOf('livemode'));
  const occupied = src.indexOf("'occupied'", src.indexOf('charges_enabled'));
  return write > 0 && mode > 0 && occupied > 0 && mode < write && occupied < write;
};
verifiesFirst(callback(code(admin)))
  ? ok('the OAuth callback verifies the signed state before it trades the code')
  : no('the OAuth callback verifies the signed state before it trades the code');
checksBeforeWrite(connectBody)
  ? ok('connectWithCode refuses the wrong mode and a working different account before it writes')
  : no('connectWithCode refuses the wrong mode and a working different account before it writes');
/createConnectedAccount\(/.test(code(admin))
  ? no('the button makes no account of its own', 'connecting is Stripe\'s page now; a second path would be a half mechanism')
  : ok('the button makes no account of its own');

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
verifiesFirst(callback(code(admin)).replace('verifyConnectState(', 'trustState('))
  ? no('negative control: a callback that never verifies must trip it', 'DETECTOR BLIND')
  : ok('negative control: a callback that never verifies trips it');
checksBeforeWrite(connectBody.replace("'mismatch'", "'ignored'"))
  ? no('negative control: dropping the mode check must trip it', 'DETECTOR BLIND')
  : ok('negative control: dropping the mode check trips it');
routesBelowSession(admin.replace("const session = await getSession(req)", "const zzz = 1; // moved"))
  ? no('negative control: a payments route above the session guard must trip it', 'DETECTOR BLIND')
  : ok('negative control: a payments route above the session guard trips it');

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
