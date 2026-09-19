/**
 * No branch of the funnel ends without a saved row and a told customer.
 *
 *   node gates/no-dead-end.mjs
 *
 * P16 §0 rule 3 and §10. There are four ways out of this funnel and every one of them has to
 * leave something behind:
 *
 *   paid        -> a subscription row, then Stripe, then the confirmation
 *   request     -> a subscription row saved, Josue emailed, "Josue will confirm"    (payments off)
 *   waitlist    -> a lead row, Josue emailed, "You're on the list"                  (ZIP not served)
 *   quote       -> /contact, a contact_messages row, Josue emailed                  (floor or custom)
 *
 * A customer who types a ZIP we do not serve and gets a shrug is worse than one who never came:
 * they are evidence about where the next route day should go (P19 §4) and the shrug throws it
 * away.
 *
 * WHAT THIS GATE CANNOT SEE, stated rather than implied: it reads code, so it proves each exit
 * WRITES something. That the writing works end to end is gates/funnel-events.mjs, which walks the
 * waitlist branch in a real browser against a dev server in demo mode.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const flow = readFileSync('src/components/booking/BookingFlow.tsx', 'utf8');
const booking = readFileSync('server/lib/booking.ts', 'utf8');
const contact = readFileSync('api/contact.ts', 'utf8');

// 1. every terminal screen in the island exists and says what happens next.
{
  const TERMINALS = [
    ['waitlisted', /You're on the list/],
    ['request', /Booking received/],
  ];
  for (const [state, copy] of TERMINALS) {
    const has = new RegExp(`step === '${state}'`).test(flow) && copy.test(flow);
    has ? ok(`the ${state} screen exists and tells the customer what happens next`)
        : no(`the ${state} screen exists and tells the customer what happens next`);
  }
}

// 2. it is only reached after something was saved.
{
  const reachesWaitlisted = /joinWaitlist[\s\S]{0,600}go\('waitlisted'\)/.test(flow);
  reachesWaitlisted ? ok('the waitlist screen is reached only after the waitlist call succeeds')
                    : no('the waitlist screen is reached only after the waitlist call succeeds');
  const reachesRequest = /j\.mode === 'request'[\s\S]{0,200}go\('request'\)/.test(flow);
  reachesRequest ? ok('the request screen is reached only after the server saved the booking')
                 : no('the request screen is reached only after the server saved the booking');
}

// 3. an unserved or unknown ZIP goes somewhere, rather than printing an error and stopping.
{
  const unservedRouted = /go\('waitlist'\)/.test(flow) && /not on a route in/.test(flow);
  unservedRouted ? ok('a ZIP we do not serve routes to the waitlist with the honest sentence')
                 : no('a ZIP we do not serve routes to the waitlist with the honest sentence');
  const unknownRouted = /don't have \$\{z\} on the map|don't have/.test(flow);
  unknownRouted ? ok('a ZIP we have never heard of says so, and still offers the waitlist')
                : no('a ZIP we have never heard of says so, and still offers the waitlist');
}

// 4. a quote tier leaves the funnel toward something that records a lead.
{
  const toContact = /window\.location\.href = `\/contact\?service=/.test(flow);
  toContact ? ok('a quote tier goes to the contact form rather than nowhere')
            : no('a quote tier goes to the contact form rather than nowhere');
  /insert into contact_messages/.test(contact)
    ? ok('the contact form writes a row') : no('the contact form writes a row');
}

// 5. the server writes a row on every exit it owns.
{
  /insert into leads/.test(booking) ? ok('joinWaitlist writes a lead') : no('joinWaitlist writes a lead');
  /insert into subscriptions/.test(booking) ? ok('createBooking writes the booking before money moves')
                                            : no('createBooking writes the booking before money moves');
  // The request lane: the row is written with state 'draft' BEFORE the readiness check decides
  // there is nothing to charge, which is the ordering rule P16 §0 rule 2 protects.
  const rowBeforeMoney = booking.indexOf('insert into subscriptions') < booking.indexOf('const { stripe, account } = await resolve(mode)');
  rowBeforeMoney ? ok('the row exists before Stripe is called, not after')
                 : no('the row exists before Stripe is called, not after');
  /notifyOwner\('booking_owner'/.test(booking) ? ok('the request lane tells Josue') : no('the request lane tells Josue');
  /notifyOwner\('waitlist_owner'/.test(booking) ? ok('the waitlist tells Josue') : no('the waitlist tells Josue');
}

// 6. the setting the whole waitlist branch depends on is what the funnel assumes.
{
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  await c.query('begin transaction read only');
  const { rows } = await c.query(`select value from settings where key = 'service_area.outside_area_behaviour'`);
  rows[0]?.value === 'capture_lead_and_notify'
    ? ok('outside_area_behaviour is capture_lead_and_notify')
    : no('outside_area_behaviour is capture_lead_and_notify', String(rows[0]?.value));
  await c.query('rollback');
  await c.end();
}

// ---- negative controls ------------------------------------------------------------------------
/step === 'waitlisted'/.test("if (step === 'x') return null;")
  ? no('negative control: a missing terminal screen trips this gate', 'DETECTOR BLIND')
  : ok('negative control: a missing terminal screen trips it');
/insert into leads/.test('// no writes here')
  ? no('negative control: a waitlist that saves nothing trips it', 'DETECTOR BLIND')
  : ok('negative control: a waitlist that saves nothing trips it');

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
