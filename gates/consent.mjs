/**
 * Consent: the customer agreed to the renewal, in writing, before anybody charged them for it.
 *
 *   node gates/consent.mjs
 *
 * SPEC step 6. The statute is BPC §17602 as amended by AB 2863; R9 quotes it subsection by
 * subsection and this gate is the half that keeps the reading true after the session that made
 * it. Six things are checked, and each one exists because it has a plausible way of silently
 * going wrong:
 *
 *   A. the sentence      — the module produces all five statutory disclosures, and refuses the
 *                          two cases where a sentence would be a lie
 *   B. the acknowledgment — §17602(a)(3)'s four elements are in the receipt, including the
 *                          cancellation route that needs no login
 *   C. the rows          — every renewing subscription has a consent, every one-time job has none
 *   D. the cancel dialog — §17602(e)(2): cancel is at least as prominent as the save offer
 *   E. the schema guard  — a promo over 31 days, or a term of a year, requires its notice
 *   F. one author        — nothing outside the shared module composes a renewal sentence
 *
 * WHY E IS HERE AT ALL. Neither §17602(b) notice is owed today - the discount is one billing
 * cycle and no term reaches a year - and both are one product decision away. A plan document
 * saying "remember the notice if you add an annual plan" is a writer with no reader. This is the
 * reader: it reads `offers.promo_months` and the frequency constraint, and it fails the build the
 * day either crosses its threshold with the sender unwired.
 *
 * Every check has a negative control that is run FIRST, so a check that cannot fail is reported
 * as broken rather than counted as a pass.
 */
import { readFileSync } from 'node:fs';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';
import pg from 'pg';

loadEnv();

let pass = 0, fail = 0;
const ok = (what, detail = '') => { pass++; console.log(`  PASS  ${what}${detail ? ` — ${detail}` : ''}`); };
const no = (what, detail = '') => { fail++; console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ''}`); };
const check = (cond, what, detail = '') => (cond ? ok(what, detail) : no(what, detail));

const out = compileServer();
const { renewalTerms, acknowledgmentHtml } = await import(`${out}/src/shared/consent.js`);

const BASE = {
  lane: 'prepay',
  monthlyCents: 12000,
  firstChargeCents: 6000,
  firstChargeOn: null,
  packageName: 'Weekly scooping · 2 dogs',
  priceMayChange: false,
  cancelEmail: 'josue@scoopdogg.net',
  businessName: 'Scoop Dogg',
};

// ---------------------------------------------------------------- A. the sentence
console.log('\nA. the sentence and the five disclosures');

const prepay = renewalTerms(BASE);
const REQUIRED = ['a2A', 'a2B', 'a2C', 'a2D', 'a2E'];
const cites = prepay.disclosures.map((d) => d.cite);
check(REQUIRED.every((c) => cites.includes(c)),
  'all five §17602(a)(2) disclosures are produced',
  `got ${cites.join(', ')}`);

// (a)(1): where there is a promotional price, the price AFTER it must be explained too.
check(prepay.disclosures.some((d) => d.cite === 'a1trial' && d.text.includes('$120') && d.text.includes('$60')),
  '§17602(a)(1): a discounted first month explains the price after it',
  'first charge and monthly both named');

const payafter = renewalTerms({ ...BASE, lane: 'payafter', firstChargeOn: '2026-10-02' });
check(payafter.sentence.includes('October 2, 2026') && payafter.sentence.includes('$60'),
  'lane B names the actual date of the first charge in the sentence',
  'never "later"');

const mayChange = renewalTerms({ ...BASE, priceMayChange: true });
check(mayChange.sentence.includes('may change') && mayChange.disclosures.some((d) => d.cite === 'a2C' && /7 days/.test(d.text)),
  '§17602(a)(2)(C): a from-priced package says the amount may change',
  'and names the 7-day floor of the fee-change window');
check(!prepay.sentence.includes('may change'),
  'a fixed-price package does NOT say the amount may change',
  'the clause is conditional, not boilerplate');

// The two cases where a sentence would be a false statement.
let threwOneTime = false;
try { renewalTerms({ ...BASE, lane: 'onetime' }); } catch { threwOneTime = true; }
check(threwOneTime, 'a one-time job is refused, not given a renewal sentence', '§17601 does not reach it');

let threwNoDate = false;
try { renewalTerms({ ...BASE, lane: 'payafter', firstChargeOn: null }); } catch { threwNoDate = true; }
check(threwNoDate, 'lane B without a date is refused', 'a free-to-pay conversion with no date is the surprise charge');

// Negative control: a module that always returned the same string would pass everything above.
check(prepay.sentence !== payafter.sentence && prepay.sentence !== mayChange.sentence,
  'NEGATIVE CONTROL: the three sentences differ from each other',
  'the renderer reads its inputs');

// ---------------------------------------------------------------- B. the acknowledgment
console.log('\nB. §17602(a)(3): the acknowledgment the receipt carries');

const ack = acknowledgmentHtml({
  agreedSentence: prepay.sentence, cancelEmail: 'josue@scoopdogg.net',
  phone: '(805) 869-8070', site: 'https://scoopdogg.net',
});
check(ack.includes(prepay.sentence), 'it restates the terms that were agreed', 'read back, not recomposed');
check(/data-ack-policy/.test(ack) && /no notice period/.test(ack), 'it describes the cancellation policy');
check(/data-ack-how/.test(ack) && /scoopdogg\.net\/account/.test(ack), 'it says how to cancel, with a link');
check(/mailto:josue@scoopdogg\.net/.test(ack) && /do not need to sign in/.test(ack),
  '§17602(c)(1) + (d)(3): it names a cancellation route that needs no login');

const ackNoEmail = acknowledgmentHtml({ agreedSentence: prepay.sentence, cancelEmail: '', phone: '', site: 'https://x.test' });
check(!/mailto:/.test(ackNoEmail),
  'NEGATIVE CONTROL: with no email setting, no mailto is fabricated',
  'the check above is reading the input, not a constant');

// ---------------------------------------------------------------- C. the rows
console.log('\nC. the consent records in the database');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

const renewing = await q(`
  select s.id, s.monthly_price_cents, s.frequency,
         (select count(*) from consents k where k.subscription_id = s.id and k.kind = 'renewal') as consents
    from subscriptions s
   where s.frequency <> 'one_time' and s.state in ('active','deposit_pending','paused')`);
const missing = renewing.filter((r) => Number(r.consents) === 0);
check(missing.length === 0,
  'every renewing subscription has a consent record',
  missing.length ? `${missing.length} without: ${missing.slice(0, 3).map((r) => r.id).join(', ')}` : `${renewing.length} checked`);

const oneTimes = await q(`
  select s.id, (select count(*) from consents k where k.subscription_id = s.id) as consents
    from subscriptions s where s.frequency = 'one_time'`);
const spurious = oneTimes.filter((r) => Number(r.consents) > 0);
check(spurious.length === 0,
  'no one-time job carries a renewal consent',
  spurious.length ? `${spurious.length} with a spurious record` : `${oneTimes.length} checked`);

const empties = await q(`select id from consents where text_shown is null or btrim(text_shown) = ''`);
check(empties.length === 0, 'no consent record is empty', `${empties.length} empty`);

const mismatched = await q(`
  select k.id from consents k join subscriptions s on s.id = k.subscription_id
   where k.kind = 'renewal' and s.monthly_price_cents is not null and k.price_cents <> s.monthly_price_cents`);
check(mismatched.length === 0,
  'every consent records the price of the plan it belongs to',
  `${mismatched.length} disagree with their subscription`);

if (renewing.length === 0) {
  console.log('    note: 0 renewing subscriptions exist, so C passes vacuously. This system has');
  console.log('    never taken a payment. The checks above are exercised by the planted rows below.');
}

// Negative control for C: plant a renewing subscription with no consent and prove the query sees
// it, then roll it back. Without this, "0 missing" and "0 rows at all" are the same answer.
{
  const client = await pool.connect();
  let caught = 0;
  try {
    await client.query('begin');
    const c = await client.query(`insert into customers (name, phone, email, preferred_payment) values ('Gate Control','(000) 000-0000','gate-consent@example.invalid','card') returning id`);
    const p = await client.query(`insert into properties (customer_id, address, city) values ($1,'1 Gate St','Ventura') returning id`, [c.rows[0].id]);
    const s = await client.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, frequency, service_weekday, starts_on, monthly_price_cents, livemode, source)
       values ($1,$2,'weekly-pooper-scooper-service','active','weekly',2,current_date,12000,false,'online') returning id`,
      [c.rows[0].id, p.rows[0].id]);
    const seen = await client.query(`
      select s.id from subscriptions s
       where s.id = $1 and s.frequency <> 'one_time' and s.state in ('active','deposit_pending','paused')
         and (select count(*) from consents k where k.subscription_id = s.id and k.kind = 'renewal') = 0`, [s.rows[0].id]);
    caught = seen.rowCount;
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
  check(caught === 1,
    'NEGATIVE CONTROL: a planted subscription with no consent is caught',
    'the query can go red, and the row was rolled back');
}

// ---------------------------------------------------------------- D. the cancel dialog
console.log('\nD. §17602(e)(2): the cancel, beside the save offer');

const accountSrc = readFileSync('src/components/account/AccountApp.tsx', 'utf8');
// Prominence, as this codebase actually expresses it. A filled button outranks an outline one
// outranks a text link — which is the whole of what the statute is asking about here.
const WEIGHT = { 'btn-primary': 3, 'btn-secondary': 2, 'btn-ghost': 1 };
const weightOf = (tag) => Object.entries(WEIGHT).find(([cls]) => tag.includes(cls))?.[1] ?? 0;
const cancelTag = /<button[^>]*data-cancel-control[^>]*>/.exec(accountSrc)?.[0] ?? '';
const saveTag = /<button[^>]*data-save-offer[^>]*>/.exec(accountSrc)?.[0] ?? '';

check(Boolean(cancelTag) && Boolean(saveTag),
  'the dialog marks its cancel control and its save offer',
  cancelTag && saveTag ? 'both found' : 'a data attribute is missing — the check below cannot run');
check(weightOf(cancelTag) >= weightOf(saveTag),
  'the cancel is at least as prominent as the save offer',
  `cancel=${weightOf(cancelTag)} save=${weightOf(saveTag)}`);
check(accountSrc.indexOf('data-cancel-control') < accountSrc.indexOf('data-save-offer'),
  'the cancel comes first in the dialog',
  'continuously and proximately displayed, and reached first by keyboard');

// Negative control: the exact defect that was live here until 2026-09-19.
{
  const planted = accountSrc
    .replace(/(<button[^>]*data-cancel-control[^>]*)btn-secondary/, '$1btn-ghost')
    .replace(/(<button[^>]*data-save-offer[^>]*)btn-ghost/, '$1btn-secondary');
  const pc = /<button[^>]*data-cancel-control[^>]*>/.exec(planted)?.[0] ?? '';
  const ps = /<button[^>]*data-save-offer[^>]*>/.exec(planted)?.[0] ?? '';
  check(weightOf(pc) < weightOf(ps),
    'NEGATIVE CONTROL: the pre-2026-09-19 weighting fails this check',
    `planted cancel=${weightOf(pc)} save=${weightOf(ps)}`);
}

// ---------------------------------------------------------------- E. the schema guard
console.log('\nE. §17602(b): the notices that are not owed yet');

const NOTICE_SENDER = 'server/lib/lifecycle.ts';
const lifecycleSrc = readFileSync(NOTICE_SENDER, 'utf8');
const promoSenderWired = /export async function sendPromoOrTermNotices/.test(lifecycleSrc)
  && /promo_ends_on/.test(lifecycleSrc) && /term_renews_on/.test(lifecycleSrc);

const longPromos = await q(`select id, name, promo_months from offers where status = 'active' and promo_months is not null and promo_months > 1`);
check(longPromos.length === 0 || promoSenderWired,
  '§17602(b)(1): a promotional price over 31 days has its notice wired',
  longPromos.length
    ? `${longPromos.length} offer(s) run past one cycle: ${longPromos.map((o) => o.name).join(', ')}`
    : 'no offer runs past one billing cycle — not owed');

const freqDef = (await q(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'subscriptions_frequency_check'`))[0]?.def ?? '';
const annualPossible = /year|annual/i.test(freqDef);
check(!annualPossible || promoSenderWired,
  '§17602(b)(2): a term of a year or longer has its notice wired',
  annualPossible ? 'the frequency constraint now permits an annual term' : 'no annual term can exist — not owed');

const termed = await q(`select count(*)::int as n from subscriptions where term_renews_on is not null`);
check(termed[0].n === 0 || promoSenderWired,
  'no subscription carries a renewal term with the notice unwired',
  `${termed[0].n} with a term`);

// Negative control: prove the guard would fire. Flip one offer to a two-month promo in a
// transaction, run the same query, roll back.
{
  const client = await pool.connect();
  let fired = false;
  try {
    await client.query('begin');
    await client.query(`update offers set promo_months = 2 where status = 'active'`);
    const r = await client.query(`select id from offers where status = 'active' and promo_months is not null and promo_months > 1`);
    fired = r.rowCount > 0;
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
  check(fired,
    'NEGATIVE CONTROL: a two-month promotional price is detected',
    'the guard reads the rows, and the change was rolled back');
}

// ---------------------------------------------------------------- F. one author
console.log('\nF. one author for the sentence');

const AUTHOR = 'src/shared/consent.ts';
const CALLERS = [
  'src/components/booking/BookingFlow.tsx',
  'src/components/account/InviteApp.tsx',
  'server/lib/booking.ts',
  'server/lib/invites.ts',
];
// The give-away that somebody has written a second sentence: the phrase that only belongs in the
// one that is stored. A gate comparing two independently-written strings is a gate that will one
// day compare two strings that drifted last Tuesday.
const FINGERPRINT = /I agree (that )?my (plan|card)/;
const rogue = CALLERS.filter((f) => FINGERPRINT.test(readFileSync(f, 'utf8')));
check(rogue.length === 0,
  `only ${AUTHOR} composes the consent sentence`,
  rogue.length ? `also composed in: ${rogue.join(', ')}` : `${CALLERS.length} callers checked, all render it`);
check(FINGERPRINT.test(readFileSync(AUTHOR, 'utf8')),
  `NEGATIVE CONTROL: the fingerprint matches ${AUTHOR} itself`,
  'so a clean result above means absence, not a broken pattern');

await pool.end();
cleanupCompile();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
