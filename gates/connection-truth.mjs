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

const checks = [
  ['readiness comes from Stripe, not a stored boolean', readyFromStripe(stripeTs)],
  ['"Connected" is reachable only through s.ready', connectedGuarded(screen)],
  ['the API asks Stripe what it still wants', requirementsServed(adminApi)],
  ['the screen prints every requirement Stripe named', requirementsShown(screen)],
];
for (const [name, good] of checks) good ? ok(name) : no(name);

// ---- negative controls: break each property and require the detector to notice -------------
const controls = [
  ['readiness', readyFromStripe(stripeTs.replace("const ready = card === 'active'", 'const ready = true;// '))],
  ['guarded badge', connectedGuarded(screen.replace("s.ready ? { label: 'Connected'", "true ? { label: 'Connected'"))],
  ['requirements rendered', requirementsShown(screen.replace('due.map(', 'due.slice(0,0).forEach('))],
];
for (const [what, stillPasses] of controls) {
  stillPasses ? no(`negative control: a broken ${what} must trip this gate`, 'DETECTOR BLIND')
              : ok(`negative control: a broken ${what} trips it`);
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
