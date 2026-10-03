/**
 * What the owner reads when Stripe refuses to start onboarding. The button used to fall through
 * to the generic "Something went wrong" (2026-10-03: Josue clicked seven times in two minutes).
 *
 * Stripe's own words are the wrong words for one case. `account_create_activation_required`
 * says "Your account must be activated", and the account it means is the PLATFORM's, AMTECH's,
 * whose live Connect setup was never finished. Josue reading that would go looking in his own
 * Stripe for a fault that is not there. Any other Stripe refusal is passed through in Stripe's
 * words, because those are about what he is doing.
 */
export function onboardingRefusal(e: unknown): { status: number; error: string; code: string | null } | null {
  const err = e as { type?: string; code?: string; raw?: { code?: string }; message?: string };
  const code = err?.code ?? err?.raw?.code ?? null;
  // The second platform-side refusal, met the same evening: a live account link needs the
  // platform's Connect branding icon, set only in AMTECH's dashboard.
  const platformSide = code === 'account_create_activation_required' || /Connect branding settings/i.test(err?.message ?? '');
  if (platformSide) {
    return { status: 503, code: code ?? 'platform_connect_branding', error: "Stripe hasn't switched on payments for this site's platform yet. That part is on AMTECH's side, not yours, and AMTECH is fixing it. There is nothing for you to do; once it's sorted this button will take you straight to Stripe." };
  }
  if (typeof err?.type === 'string' && err.type.startsWith('Stripe')) {
    return { status: 502, code, error: `Stripe said: ${err.message ?? 'no reason given'}` };
  }
  return null;
}
