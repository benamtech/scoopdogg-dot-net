/**
 * The catch-up rule has TWO doors, and this is the one nobody had looked at.
 *
 *   node gates/catch-up-on-resume.mjs
 *
 * `gates/catch-up-priced.mjs` proves the rule at booking, where the customer answers "When was
 * the yard last cleaned?". This proves it on the account screen, where nobody answers anything:
 * the customer pauses the plan for four weeks and the system already knows how far behind the
 * yard will be when they come back.
 *
 * Both faults this gate pins were live on 2026-09-19 and neither failed anything:
 *
 *   1. A four-week pause is the offer the CANCEL dialog makes to save a customer. Four weeks is
 *      inside Josue's own "Heavy buildup (3-6 weeks)" band. The plan resumed at the weekly price
 *      and the hardest visit of the year was unpaid — reached through a button AMTECH built.
 *   2. `pausePlan` handed Stripe `pause_collection.resumes_at`. Stripe's documentation: "A Unix
 *      timestamp after which the subscription resumes collecting payments" — it resumes on its
 *      own. Nothing here moved the row off 'paused': no cron in vercel.json, and the
 *      `customer.subscription.updated` handler only touches `payment_state = 'trialing'`. So the
 *      card was charged, no visits existed, and the screen still read "No charges while paused."
 *
 * WHAT IT CHECKS
 *   A. weeks map to the same bands the answers do, and the boundary is Josue's sentence.
 *   B. the resolver prices a pause from the rows, with a negative control.
 *   C. Stripe is never handed a resume date this system cannot honour.
 *   D. the pause is frozen onto the subscription, and cleared when it comes back.
 *   E. the screen states the consequence next to the button that offers it.
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
const { catchUpForWeeks, lastCleanedForWeeks, LAST_CLEANED } = await import(`${out}/src/shared/pricing.js`);
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'));
const WEEKLY = 'weekly-pooper-scooper-service';

// ------------------------------------------------------- A. weeks land on the right band
console.log('weeks -> band');
const band = (w) => lastCleanedForWeeks(w);
check(band(0) === 'this_week' && band(1) === 'this_week', 'a yard done this week is this_week', `0w=${band(0)} 1w=${band(1)}`);
check(band(2) === 'two_weeks', 'two weeks is still "a couple of weeks"', 'Josue said "longer than a couple weeks"');
check(band(3) === 'month' && band(6) === 'month', '3 to 6 weeks is the heavy band', `3w=${band(3)} 6w=${band(6)}`);
check(band(7) === 'longer' && band(12) === 'longer', 'beyond six weeks is severe', `7w=${band(7)} 12w=${band(12)}`);
check(LAST_CLEANED.map((b) => b.key).join(',') === 'this_week,two_weeks,month,longer',
  'the ladder has one author and the pause path reads it', LAST_CLEANED.map((b) => b.key).join(', '));

// ------------------------------------------------------- B. the resolver prices a pause
console.log('');
const two = catchUpForWeeks(catalog, WEEKLY, 2);
check(two.kind === 'none', 'a two-week pause costs nothing to come back from',
  'the plain "Pause 2 weeks" button stays free, which is what makes it a real offer');

const four = catchUpForWeeks(catalog, WEEKLY, 4);
check(four.kind === 'charge' && four.cents > 0,
  'the four-week SAVE OFFER carries Josue\'s published catch-up',
  four.kind === 'charge' ? `${four.tier.label} — ${four.cents} cents` : four.kind);

const twelve = catchUpForWeeks(catalog, WEEKLY, 12);
check(twelve.kind === 'quote', 'the longest pause asks Josue rather than guessing a number',
  twelve.kind === 'quote' ? twelve.tier.label : twelve.kind);

check(catchUpForWeeks(catalog, 'weekly-turf-maintenance', 4).kind === 'none',
  'the rule stays on the service Josue described and does not spread',
  'his catch-up ladder is dog waste; turf and yard maintenance are an open question for him');

{
  const stripped = { ...catalog, tiers: catalog.tiers.map((t) => ({ ...t, covers_last_cleaned: null })) };
  check(catchUpForWeeks(stripped, WEEKLY, 4).kind === 'none',
    'NEGATIVE CONTROL: with the mapping removed a four-week pause prices nothing',
    'so the pass above is reading Josue\'s rows, not a band written into this gate');
}

// ------------------------------------------------------- C. one clock, and it is ours
console.log('');
const account = readFileSync('server/lib/account.ts', 'utf8');
const pauseCall = account.slice(account.indexOf('export async function pausePlan'), account.indexOf('async function applyResume'));
check(!/resumes_at/.test(pauseCall),
  'Stripe is NOT handed a resume date',
  'it would resume collecting on its own while this database still said paused');
check(/pause_collection: \{ behavior: 'void' \}/.test(pauseCall),
  'Stripe is paused indefinitely, so only this system decides when the plan comes back');
check(/export async function expireDuePauses/.test(account),
  'something honours paused_until, because no cron does');
const admin = readFileSync('api/admin.ts', 'utf8');
check(/expireDuePauses\(\)/.test(admin) && /await expireDuePauses\(customerId\)/.test(account),
  'both the customer page and the owner board bring a due pause back',
  'whichever of the two looks first');
check(!/crons/.test(readFileSync('vercel.json', 'utf8')),
  'and this is still true: there IS no scheduler on this project',
  'the day one is added, expireDuePauses() is what it should call');

// ------------------------------------------------------- D. frozen at pause, cleared on resume
console.log('');
check(/resume_catch_up_tier_id = \$3, resume_catch_up_cents = \$4/.test(account),
  'what the customer was shown is frozen onto the subscription',
  'a price edit later cannot change a promise already made to somebody');
check(/resume_catch_up_tier_id = null, resume_catch_up_cents = null/.test(account),
  'and cleared when the plan comes back, so it cannot be owed twice');
check(/subscription\.resume_catch_up_owed/.test(account),
  'the debt is an event, so it is on the record and not only in an email');
// The negative half looks for a CALL, not a mention: account.ts names chargeSavedCard() in a
// comment as the door to use the day charging it automatically is decided.
check(/await notifyOwnerOfCatchUp\(/.test(account) && !/await chargeSavedCard\(/.test(account),
  'Josue is TOLD and no card is charged off-session',
  'he is paid cash and Venmo today; charging it automatically is its own decision');

const migration = readFileSync('migrations/027_a_pause_is_the_other_door.sql', 'utf8');
check(/check \(resume_catch_up_cents is null or resume_catch_up_tier_id is not null\)/.test(migration),
  'the database refuses a price with no tier behind it');

// ------------------------------------------------------- E. the screen says it first
console.log('');
const app = readFileSync('src/components/account/AccountApp.tsx', 'utf8');
check(/const pauseNote =/.test(app) && /pause_options/.test(app),
  'the sentence is derived from the server\'s numbers, not typed into the component');
// lastIndexOf, because the comment above the dialog names `data-save-offer` too — and a gate
// that reads a comment instead of the markup is the failure it exists to catch.
const saveOffer = app.slice(app.lastIndexOf('data-save-offer'), app.lastIndexOf('data-save-offer') + 700);
check(/data-pause-note=\{4\}/.test(saveOffer),
  'the four-week SAVE OFFER states its own consequence',
  'offering a pause as the cheaper alternative to cancelling while hiding what it costs is the shape step 6 exists to stop');
check(/data-resume-catch-up/.test(app),
  'a paused plan shows what its first visit back carries');
check(/Your weekly price does not change/.test(app),
  'and says the weekly price is unaffected, because that is the customer\'s real fear');

cleanupCompile();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
