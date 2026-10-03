/**
 * Will "Connect Stripe" open Stripe's sign-in page, or an error? Read-only.
 *
 *   node scripts/probe-oauth.mjs            # both modes
 *   node scripts/probe-oauth.mjs --mode live
 *
 * Loads Stripe's own authorize page with exactly the link the Payments button builds
 * (server/lib/stripe-oauth.ts) and reads what Stripe answers. Nothing is connected or created, and
 * no key is used: the authorize page is public, and a browser would see the same answer.
 *
 * The two platform settings it reads (Settings > Connect > Onboarding options > OAuth) cannot be
 * read through the API. Measured 2026-10-03 before they were set, Stripe answered HTTP 400 with
 * "Standard OAuth is disabled for this Stripe Connect integration" for every redirect_uri, our
 * callback and a bogus one alike. So a 400 naming the redirect means OAuth is on and the callback is
 * not registered, and a page that is not an error means the button will work.
 */
import { authorizeUrl } from '../server/lib/stripe-oauth.ts';

const only = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : null;
const BASE = 'https://scoopdogg.net';
let bad = 0;
for (const mode of ['live', 'test']) {
  if (only && only !== mode) continue;
  const url = authorizeUrl(mode, { state: 'probe-only', base: BASE });
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) scoopdogg-probe' } });
  const text = await res.text();
  let error = null;
  try { error = JSON.parse(text)?.error?.message ?? JSON.parse(text)?.error_description ?? null; } catch { /* a page, not JSON */ }
  if (!error && res.status >= 400) error = `HTTP ${res.status}`;
  if (error) bad++;
  console.log(`  ${error ? 'NO ' : 'yes'}  ${mode.padEnd(4)}  ${error ?? `Stripe's sign-in page opens (HTTP ${res.status})`}`);
}
if (bad) console.log('\n  Fix in the Stripe dashboard: Settings > Connect > Onboarding options > OAuth.\n  Turn OAuth on, and add the redirect URI https://scoopdogg.net/api/admin/payments/oauth-callback');
process.exit(bad ? 1 : 0);
