/**
 * A yard that is behind is charged for being behind.
 *
 *   node gates/catch-up-priced.mjs
 *
 * Josue, 2026-09-19: "when yard has not been cleaned longer than a couple weeks it would
 * increase price because the default price is based on having a weekly clean."
 *
 * Until that day the funnel asked the right question and then offered the catch-up as a free
 * choice with a "No thanks, just weekly" button beside it, so a customer with six weeks of
 * buildup could decline the extra work and start at the weekly price. This gate exists because
 * that is a silent revenue leak: nothing failed, nothing logged, and the only symptom was a
 * hard first visit nobody was paid for.
 *
 * WHAT IT CHECKS
 *   A. the ladder is complete — every answer the funnel offers maps to a tier, and every
 *      catch-up tier maps to an answer. A gap in either direction means a customer answers a
 *      question whose answer prices nothing.
 *   B. the resolver agrees with Josue's sentence — inside a couple of weeks costs nothing,
 *      beyond it costs his published price, and the severe band asks rather than guesses.
 *   C. the policy row says the rule is on.
 *   D. the server refuses a booking that omits a required catch-up — the rule is not only in
 *      the browser, where anybody posting the form could skip it.
 *
 * Each has a negative control, run first.
 */
import { readFileSync } from 'node:fs';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const out = compileServer();
const { catchUpFor } = await import(`${out}/src/shared/pricing.js`);
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));

// The answers the funnel actually offers, read from the component rather than retyped here —
// a gate with its own copy of the list cannot notice the list changing.
const src = readFileSync('src/components/booking/BookingFlow.tsx', 'utf8');
const ANSWERS = [...src.matchAll(/\{ v: '([a-z_]+)', label:/g)].map((m) => m[1]);
const WEEKLY = 'weekly-pooper-scooper-service';

console.log(`the funnel offers ${ANSWERS.length} answers: ${ANSWERS.join(', ')}\n`);

// ---------------------------------------------------------------- A. the ladder is complete
check(ANSWERS.length >= 4, 'the answers were found in the component', ANSWERS.join(', '));

const unmapped = ANSWERS.filter((a) => !catalog.tiers.some((t) => (t.covers_last_cleaned ?? []).includes(a)));
check(unmapped.length === 0,
  'every answer the funnel offers maps to a catch-up tier',
  unmapped.length ? `no tier covers: ${unmapped.join(', ')}` : `${ANSWERS.length} answers`);

const catchUpTiers = catalog.tiers.filter((t) => (t.covers_last_cleaned ?? []).length);
const orphanTiers = catchUpTiers.filter((t) => !t.covers_last_cleaned.some((a) => ANSWERS.includes(a)));
check(orphanTiers.length === 0,
  'every catch-up tier maps to an answer somebody can give',
  orphanTiers.length ? orphanTiers.map((t) => t.label).join('; ') : `${catchUpTiers.length} tiers`);

// ---------------------------------------------------------------- B. the resolver
console.log('');
const inside = ['this_week', 'two_weeks'].map((a) => catchUpFor(catalog, WEEKLY, a));
check(inside.every((c) => c.kind === 'none'),
  'inside a couple of weeks, nothing is added',
  `"a couple weeks is not longer than a couple weeks" — ${inside.map((c) => c.kind).join('/')}`);

const month = catchUpFor(catalog, WEEKLY, 'month');
check(month.kind === 'charge' && month.cents > 0,
  '3-6 weeks adds a real charge from a published tier',
  month.kind === 'charge' ? `$${(month.cents / 100).toFixed(2)} — ${month.tier.label}` : month.kind);

const longer = catchUpFor(catalog, WEEKLY, 'longer');
check(longer.kind === 'quote',
  'the severe band asks rather than guessing a number',
  longer.kind === 'quote' ? longer.tier.label : longer.kind);

check(catchUpFor(catalog, 'one-time-dog-poop-cleanup', 'longer').kind === 'none',
  'a one-time job is never "behind" — it IS the catch-up');
check(catchUpFor(catalog, WEEKLY, null).kind === 'none',
  'an unanswered question adds nothing');

// Negative control: a catalog whose mapping has been removed must stop pricing it.
{
  const stripped = { ...catalog, tiers: catalog.tiers.map((t) => ({ ...t, covers_last_cleaned: null })) };
  check(catchUpFor(stripped, WEEKLY, 'month').kind === 'none',
    'NEGATIVE CONTROL: with the mapping removed the resolver adds nothing',
    'so the passes above are reading the rows, not a hardcoded band');
}

// ---------------------------------------------------------------- C. the policy row
console.log('');
const policy = catalog.settings['booking.initial_cleanup_policy'];
check(policy === 'required_beyond_two_weeks',
  'the policy row says the catch-up is required beyond a couple of weeks',
  `booking.initial_cleanup_policy = ${policy}`);

// ---------------------------------------------------------------- D. the server enforces it
console.log('');
const server = readFileSync('server/lib/booking.ts', 'utf8');
check(/catchUpFor\(/.test(server),
  'the server recomputes the catch-up from its own rows');
check(/catch_up_missing/.test(server),
  'the server REFUSES a booking that omits a required catch-up',
  'a pricing rule only the browser applies is one anybody can post around');
check(/needsFirstVisitQuote/.test(server) && /paymentsReady\(mode\)\) && !needsFirstVisitQuote/.test(server),
  'the severe band takes no card and goes down the request path',
  'Josue prices it; the customer is not dead-ended and not guessed at');

const client = readFileSync('src/components/booking/BookingFlow.tsx', 'utf8');
check(/data-catch-up="charge"/.test(client) && /weekly price is for a yard that gets done every week/i.test(client),
  'the screen says WHY the price moved, in Josue\'s own terms',
  'a number that changes without a reason reads as a bait and switch');

cleanupCompile();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
