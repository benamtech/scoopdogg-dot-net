/**
 * The admin never says "connected" while Stripe says otherwise, and never hides a requirement.
 *
 *   node gates/connection-truth.mjs
 *
 * P18 §1.3 and money hypershape M16. This is the failure that does not announce itself: an
 * account whose card_payments capability lapses, or whose owner never finished a document, keeps
 * a green badge on a screen nobody re-reads while every booking silently falls back to the
 * request lane - or worse, doesn't.
 *
 * THE CHECK IS STRUCTURAL, NOT A SCREENSHOT. Three things have to be true in the shipped source:
 *   1. `probeAccount` computes readiness from what Stripe answered, not from a stored boolean.
 *   2. the badge that reads "Connected" is reachable ONLY through that readiness.
 *   3. a non-empty requirements list is rendered, in Stripe's own words.
 *
 * Each one is then MUTATION-TESTED in this process: the same analysis is run over a copy of the
 * file with the property broken, and the gate fails if the analysis still passes. A structural
 * check nobody has watched go red is a check that might be reading the wrong line.
 */
import { readFileSync } from 'node:fs';

const stripeTs = readFileSync('server/lib/stripe.ts', 'utf8');
const screen = readFileSync('src/pages_react/admin/AdminPaymentsPage.tsx', 'utf8');
const adminApi = readFileSync('api/admin.ts', 'utf8');
const booking = readFileSync('server/lib/booking.ts', 'utf8');
const trigger = readFileSync('migrations/037_a_readiness_belongs_to_one_account.sql', 'utf8');

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

// 1. readiness is Stripe's answer.
const readyFromStripe = (src) =>
  /const ready = card === 'active'/.test(src) && /requirements_status = \$3, charges_enabled = \$4/.test(src);

// 2. the word Connected is guarded by it. The badge is a ternary chain; the label must sit on
//    the `s.ready` arm and nothing earlier may reach it.
const connectedGuarded = (src) => {
  const line = src.split('\n').find((l) => l.includes("label: 'Connected'"));
  if (!line) return false;
  return /s\.ready \?/.test(line);
};

// 3. requirements are rendered rather than summarised away.
const requirementsShown = (src) => /requirement_entries/.test(src) && /due\.map\(/.test(src);
const requirementsServed = (src) => /requirementsOf\(m\)/.test(src) && /requirement_entries/.test(src);

// ---- 4-6: the three ways a reading goes STALE rather than wrong -----------------------------
// Added 2026-09-26, after a chargeable account was stored as charges_enabled=false and every
// booking fell to the request lane with no error anywhere. Checks 1-3 were green throughout:
// they ask whether readiness is COMPUTED from Stripe's answer, and it was. They cannot ask
// whether the answer still describes the account the row points at, or how old it is. These do.

// 4. A read that did not answer must not be written down as an answer. The `source === 'none'`
//    branch must exist AND its update must not touch the readiness columns.
const unansweredNotWritten = (src) => {
  const i = src.indexOf("if (source === 'none')");
  if (i < 0) return false;
  const branch = src.slice(i, src.indexOf('return', src.indexOf('await db().query', i)));
  return /last_probed_at = now\(\)/.test(branch) && !/charges_enabled\s*=/.test(branch) && !/card_payments_status\s*=/.test(branch);
};

// 5. An empty v2 body must reach the v1 read, not just a thrown error. The fallback has to be
//    guarded by the VALUE being null, not by a catch block.
const emptyReadFallsBack = (src) => /if \(card === null\) \{/.test(src) && /stripe\.accounts\.retrieve\(conn\.account_id\)/.test(src);

// 6. The money path must not believe a stored 'active' of unbounded age.
const moneyPathChecksAge = (src) => /card_payments_status === 'active' && probeIsFresh\(conn\)/.test(src);

// 7. The schema forgets a reading when the account changes, so no code path can inherit one.
const schemaForgetsOnAccountChange = (sql) =>
  /new\.account_id is distinct from old\.account_id/.test(sql) && /new\.last_probed_at\s*:=\s*null/.test(sql);

const checks = [
  ['readiness comes from Stripe, not a stored boolean', readyFromStripe(stripeTs)],
  ['"Connected" is reachable only through s.ready', connectedGuarded(screen)],
  ['the API asks Stripe what it still wants', requirementsServed(adminApi)],
  ['the screen prints every requirement Stripe named', requirementsShown(screen)],
  ['a probe that got no answer writes no verdict', unansweredNotWritten(stripeTs)],
  ['an empty v2 body falls back to the v1 read, not only an error', emptyReadFallsBack(stripeTs)],
  ['the money path re-asks rather than trusting an old reading', moneyPathChecksAge(booking)],
  ['changing the account forgets its reading, in the schema', schemaForgetsOnAccountChange(trigger)],
];
for (const [name, good] of checks) good ? ok(name) : no(name);

// ---- negative controls: break each property and require the detector to notice -------------
const controls = [
  ['readiness', readyFromStripe(stripeTs.replace("const ready = card === 'active'", 'const ready = true;// '))],
  ['guarded badge', connectedGuarded(screen.replace("s.ready ? { label: 'Connected'", "true ? { label: 'Connected'"))],
  ['requirements rendered', requirementsShown(screen.replace('due.map(', 'due.slice(0,0).forEach('))],
  // The mutation is the exact bug that shipped: an unanswered probe writing a verdict anyway.
  ['unanswered write', unansweredNotWritten(stripeTs.replace(
    'update stripe_connection set last_probed_at = now(), probe_error = $2, updated_at = now()',
    'update stripe_connection set charges_enabled = false, last_probed_at = now(), probe_error = $2, updated_at = now()'))],
  ['empty-body fallback', emptyReadFallsBack(stripeTs.replace('if (card === null) {', 'if (false) {'))],
  ['money-path freshness', moneyPathChecksAge(booking.replace(
    "card_payments_status === 'active' && probeIsFresh(conn)", "card_payments_status === 'active'"))],
  ['schema forgetting', schemaForgetsOnAccountChange(trigger.replace('new.last_probed_at       := null;', ''))],
];
for (const [what, stillPasses] of controls) {
  stillPasses ? no(`negative control: a broken ${what} must trip this gate`, 'DETECTOR BLIND')
              : ok(`negative control: a broken ${what} trips it`);
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
