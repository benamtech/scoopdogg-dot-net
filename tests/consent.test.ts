// node --test tests/
//
// The consent sentence, and the cases where getting it wrong would be a false statement rather
// than a typo. BPC §17602; R9 quotes each subsection these check.
//
// gates/consent.mjs checks the same module against the real database and the real components.
// These are here for the part that needs no database: the exact words, and the refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renewalTerms, acknowledgmentHtml, type ConsentInput } from '../src/shared/consent.ts';

const base: ConsentInput = {
  lane: 'prepay',
  monthlyCents: 12000,
  firstChargeCents: 12000,
  firstChargeOn: null,
  packageName: 'Weekly scooping · 2 dogs',
  priceMayChange: false,
  cancelEmail: 'josue@scoopdogg.net',
  businessName: 'Scoop Dogg',
};

test('the sentence carries the monthly amount and how to get out', () => {
  const t = renewalTerms(base);
  assert.equal(t.sentence, 'I agree my plan renews at $120 a month until I cancel. I can cancel anytime in my account.');
});

test('all five §17602(a)(2) disclosures are produced, every time', () => {
  for (const input of [base, { ...base, priceMayChange: true }, { ...base, lane: 'payafter' as const, firstChargeOn: '2026-10-02' }]) {
    const cites = renewalTerms(input).disclosures.map((d) => d.cite);
    for (const required of ['a2A', 'a2B', 'a2C', 'a2D', 'a2E']) assert.ok(cites.includes(required), `${required} missing`);
  }
});

test('§17602(a)(1): a discounted first month explains the price that follows it', () => {
  const t = renewalTerms({ ...base, firstChargeCents: 6000 });
  const trial = t.disclosures.find((d) => d.cite === 'a1trial');
  assert.ok(trial, 'no explanation of the post-promotional price');
  assert.match(trial!.text, /\$60 today/);
  assert.match(trial!.text, /\$120 a month/);
});

test('an undiscounted first month produces no promotional explanation', () => {
  // The clause is conditional. A page that says "after that the price is $120" when $120 is what
  // was just charged reads as a warning about nothing.
  assert.equal(renewalTerms(base).disclosures.some((d) => d.cite === 'a1trial'), false);
});

test('lane B names the date, the amount, and the year', () => {
  const t = renewalTerms({ ...base, lane: 'payafter', firstChargeCents: 12000, firstChargeOn: '2026-10-02' });
  assert.match(t.sentence, /Friday, October 2, 2026/);
  assert.match(t.sentence, /card is saved today/);
  // The year matters because this string is retained for three years, not read on Tuesday.
  assert.match(t.sentence, /2026/);
});

test('lane B without a date is refused, not softened to "later"', () => {
  assert.throws(() => renewalTerms({ ...base, lane: 'payafter', firstChargeOn: null }), /never "later"/);
});

test('a one-time job is refused: §17601 does not reach something that never renews', () => {
  assert.throws(
    () => renewalTerms({ ...base, lane: 'onetime' as unknown as ConsentInput['lane'] }),
    /does not renew/);
});

test('§17602(a)(2)(C): a from-priced package says the amount may change, and only then', () => {
  const fixed = renewalTerms(base);
  const floor = renewalTerms({ ...base, priceMayChange: true });
  assert.doesNotMatch(fixed.sentence, /may change/);
  assert.match(floor.sentence, /may change/);
  // And the disclosure names the notice window, so the promise is a specific one.
  assert.match(floor.disclosures.find((d) => d.cite === 'a2C')!.text, /at least 7 days before/);
  assert.match(fixed.disclosures.find((d) => d.cite === 'a2C')!.text, /does not change unless you change your plan/);
});

test('the cancellation disclosure names the email route, from the row it was given', () => {
  const t = renewalTerms({ ...base, cancelEmail: 'somebody@example.test' });
  assert.match(t.disclosures.find((d) => d.cite === 'a2B')!.text, /somebody@example\.test/);
});

test('§17602(a)(3): the acknowledgment carries the agreed sentence, the policy and how to cancel', () => {
  const t = renewalTerms(base);
  const html = acknowledgmentHtml({
    agreedSentence: t.sentence, cancelEmail: 'josue@scoopdogg.net', phone: '(805) 869-8070', site: 'https://scoopdogg.net',
  });
  assert.ok(html.includes(t.sentence), 'the agreed sentence is not restated');
  assert.match(html, /no notice period/);
  assert.match(html, /https:\/\/scoopdogg\.net\/account/);
  assert.match(html, /mailto:josue@scoopdogg\.net/);
  assert.match(html, /do not need to sign in/);
});

test('the acknowledgment invents no route it was not given', () => {
  const html = acknowledgmentHtml({ agreedSentence: null, cancelEmail: '', phone: '', site: 'https://x.test' });
  assert.doesNotMatch(html, /mailto:/);
  assert.doesNotMatch(html, /data-ack-agreed/);
});
