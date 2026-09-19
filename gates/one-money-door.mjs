/**
 * M15: there is ONE door to money.
 *
 *   node gates/one-money-door.mjs
 *
 * notify.ts earned this pattern first — it is *"the ONE place this codebase talks to the mail
 * provider"* — and the reason given there is the reason here: *"a demo check added to one of them
 * is absent from the other two, and the fourth one somebody writes next month forgets it
 * entirely."* Every word of that is true of a platform fee, except that a forgotten fee is not a
 * bug anybody sees. It is money that quietly does not arrive, found on a statement months later.
 *
 * IT COUNTS DOORS, NOT PARAMETERS, and that is the whole design. A gate that greps for
 * `application_fee_percent` passes the moment somebody writes `...feeParams` or moves the value
 * into a variable; a gate that greps for `checkout.sessions.create` cannot be talked out of it.
 * The cost is that the door must be called by its name: `const { sessions } = stripe.checkout`
 * and then `sessions.create(...)` would slip past. Nothing in this repository does that, and a
 * reviewer who sees it written that way now knows why not to.
 *
 * NEGATIVE CONTROL: a planted second door must trip the detector. A regex that matches nothing
 * passes a repository with no Stripe in it at all.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DOOR = /\b(?:checkout\.sessions|paymentIntents|charges|refunds|invoices|invoiceItems|subscriptions|subscriptionItems)\.create\b/;
const DOOR_G = new RegExp(DOOR.source, 'g');

const walk = (d) => (existsSync(d)
  ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; })
  : []);

// Two exclusions, both of which are the detector rather than a hole in it:
//   .gate-build  a compiled copy of server/ that other gates import, so money.ts would count twice
//   this file    it names every door in a regex and in its own negative control
const SELF = path.relative(process.cwd(), new URL(import.meta.url).pathname);
const FILES = ['api', 'server', 'scripts', 'src', 'gates']
  .flatMap(walk)
  .filter((f) => /\.(ts|tsx|mjs|js|astro)$/.test(f) && !f.startsWith('.gate-build') && f !== SELF);

const doors = FILES.filter((f) => DOOR.test(readFileSync(f, 'utf8')));
const EXPECTED = 'server/lib/money.ts';

for (const f of doors) {
  const hits = [...readFileSync(f, 'utf8').matchAll(DOOR_G)].map((m) => m[0]);
  console.log(`  ${f === EXPECTED ? 'door' : 'EXTRA'}  ${f} — ${[...new Set(hits)].join(', ')}`);
}

const control = DOOR.test('await stripe.paymentIntents.create({ amount: 100 });');
console.log(`  negative control: ${control ? 'a planted second door trips it' : 'DETECTOR BLIND'}`);
console.log(`  scanned ${FILES.length} files`);

const ok = control && doors.length === 1 && doors[0] === EXPECTED;
console.log(ok ? `PASS 1 door (${EXPECTED})` : `FAIL ${doors.length} door(s); exactly one is allowed and it is ${EXPECTED}`);
process.exit(ok ? 0 : 1);
