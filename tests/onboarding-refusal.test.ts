// node --test tests/
// What Josue reads when Stripe refuses the Connect button. 2026-10-03: seven clicks, seven
// "Something went wrong", and the real reason sat in the function log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { onboardingRefusal } from '../server/lib/stripe-refusal.ts';

// The SDK's own error class, built the way the SDK builds it from a response.
const stripeError = (code: string, message: string) =>
  new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code, message } as never);

test("the platform's missing live Connect setup is named as AMTECH's, not his", () => {
  const r = onboardingRefusal(stripeError('account_create_activation_required',
    'Your account must be activated in order to create accounts. You can activate your accounts at https://dashboard.stripe.com/account/onboarding.'));
  assert.ok(r);
  assert.equal(r.code, 'account_create_activation_required');
  assert.match(r.error, /AMTECH/);
  // Stripe's sentence says "your account"; shown to Josue it points him at the wrong account.
  assert.doesNotMatch(r.error, /must be activated|dashboard\.stripe\.com/);
});

test('any other Stripe refusal reaches him in Stripe\'s words', () => {
  const r = onboardingRefusal(stripeError('email_invalid', 'Invalid email address: x'));
  assert.ok(r);
  assert.equal(r.status, 502);
  assert.equal(r.error, 'Stripe said: Invalid email address: x');
});

test('a fault that is not Stripe stays ours and is not dressed up as Stripe', () => {
  assert.equal(onboardingRefusal(new Error('connect ECONNREFUSED')), null);
  assert.equal(onboardingRefusal(undefined), null);
});
