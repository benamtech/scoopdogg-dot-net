// node --test tests/
// "Connect with Stripe": the state token that binds Stripe's callback to the sign-in that asked,
// and the link that lets Josue sign in to the Stripe account he already has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectState, verifyConnectState, authorizeUrl, oauthAvailable, CLIENT_IDS, REDIRECT_PATH, STATE_TTL_MS } from '../server/lib/stripe-oauth.ts';

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

test('a state comes back as the mode it was minted for, for the same session', () => {
  assert.equal(verifyConnectState(connectState('sess-1', 'live', SECRET, NOW), 'sess-1', SECRET, NOW + 1000), 'live');
  assert.equal(verifyConnectState(connectState('sess-1', 'test', SECRET, NOW), 'sess-1', SECRET, NOW), 'test');
});

test('another sign-in cannot use it', () => {
  assert.equal(verifyConnectState(connectState('sess-1', 'live', SECRET, NOW), 'sess-2', SECRET, NOW), null);
});

test('it expires after fifteen minutes', () => {
  const s = connectState('sess-1', 'live', SECRET, NOW);
  assert.equal(verifyConnectState(s, 'sess-1', SECRET, NOW + STATE_TTL_MS - 1), 'live');
  assert.equal(verifyConnectState(s, 'sess-1', SECRET, NOW + STATE_TTL_MS + 1), null);
});

test('test cannot be flipped to live, and a forged or mangled state is refused', () => {
  const s = connectState('sess-1', 'test', SECRET, NOW);
  const [body, mac] = s.split('.');
  const flipped = Buffer.from(Buffer.from(body, 'base64url').toString().replace('"test"', '"live"')).toString('base64url');
  assert.equal(verifyConnectState(`${flipped}.${mac}`, 'sess-1', SECRET, NOW), null);
  assert.equal(verifyConnectState(connectState('sess-1', 'live', 'another-secret', NOW), 'sess-1', SECRET, NOW), null);
  for (const bad of ['', 'x', `${body}.`, `${body}.${mac}.extra`, '..']) assert.equal(verifyConnectState(bad, 'sess-1', SECRET, NOW), null, bad);
});

test("the link is Stripe's OAuth page for this mode, opening on sign-in, returning to our callback", () => {
  const u = new URL(authorizeUrl('live', { state: 'st', base: 'https://scoopdogg.net', email: 'j@example.com', businessName: 'Scoop Dogg' }));
  assert.equal(u.origin + u.pathname, 'https://connect.stripe.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), CLIENT_IDS.live);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'read_write');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.equal(u.searchParams.get('redirect_uri'), `https://scoopdogg.net${REDIRECT_PATH}`);
  assert.equal(u.searchParams.get('stripe_landing'), 'login');
  assert.equal(u.searchParams.get('stripe_user[email]'), 'j@example.com');
  assert.equal(new URL(authorizeUrl('test', { state: 'st', base: 'https://x.test' })).searchParams.get('client_id'), CLIENT_IDS.test);
  assert.notEqual(CLIENT_IDS.live, CLIENT_IDS.test);
});

// What Stripe answered on 2026-10-03 with the platform's OAuth switch off, and a page when it is on.
const answering = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;

test("OAuth is unavailable when Stripe answers its JSON error, and available when it serves the page", async () => {
  const off = await oauthAvailable('live', 'https://scoopdogg.net', answering(400,
    '{"error":{"message":"Standard OAuth is disabled for this Stripe Connect integration."}}'));
  assert.equal(off.ok, false);
  assert.match(off.reason ?? '', /Standard OAuth is disabled/);
  assert.deepEqual(await oauthAvailable('live', 'https://scoopdogg.net', answering(200, '<html>Sign in to Stripe</html>')), { ok: true, reason: null });
});

test('an unreachable Stripe counts as unavailable, so the button still opens hosted onboarding', async () => {
  const down = await oauthAvailable('live', 'https://x.test', (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch);
  assert.equal(down.ok, false);
  assert.equal((await oauthAvailable('live', 'https://x.test', answering(503, 'busy'))).ok, false);
});
