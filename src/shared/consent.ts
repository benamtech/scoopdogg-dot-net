/**
 * consent.ts — the words the customer agrees to, rendered in ONE place.
 *
 * California's Automatic Renewal Law (BPC §17602, as amended by AB 2863, in force 2025-07-01)
 * requires the renewal terms to be disclosed clearly and conspicuously **in visual proximity to
 * the request for consent**, and requires "express affirmative consent to the automatic renewal
 * or continuous service offer terms" — §17602(a)(4), which is the clause AB 2863 added and which
 * a pay button does not satisfy. §17602(a)(6) then requires us to keep verification of that
 * consent for three years, or one year past termination, whichever is longer.
 *
 * R9 is the reading, subsection by subsection. This file is the consequence.
 *
 * WHY IT LIVES IN `src/shared/` AND NOT IN `server/lib/`.
 * The stored record has to match what was on the screen. `gates/consent.mjs` checks that byte for
 * byte, but a gate that compares two independently-written strings is a gate that will one day
 * compare two independently-written strings that drifted last Tuesday. So the browser
 * (`BookingFlow.tsx`) and the server (`server/lib/booking.ts`) call the SAME function with the
 * same rows, and the gate's job drops from "are these two authors agreeing" to "did anyone
 * reintroduce a second author". `src/shared/pricing.ts` is here for exactly the same reason and
 * says so.
 *
 * NOTHING HERE IS TYPED. Every amount comes from a package row, every contact detail from a
 * settings row. A price in this file would be a fourth place a price lives, and there are three
 * too many already (`gates/price-four-places.mjs`).
 *
 * A ONE-TIME JOB HAS NO CONSENT. §17601 defines "automatic renewal" and "continuous service" as
 * things that renew or continue; a single yard cleanup does neither, so the article does not
 * reach it. Rendering a renewal sentence over a one-time job would not be caution — it would be
 * a false statement about what the customer is agreeing to. `renewalTerms()` refuses that case
 * rather than producing a harmless-looking sentence for it.
 */
// `.ts`, deliberately, and gates/_compile.mjs says why: this module is loaded three ways and
// each resolver wants something different. Node's own type-stripper (`node --test tests/*.ts`)
// resolves the literal specifier and will NOT rewrite `.js` to `.ts`; Vite resolves either;
// the serverless compile rewrites `.ts` to `.js` on the way out. What has to be true for the
// last of those is `rewriteRelativeImportExtensions` in tsconfig.json - it was missing until
// 2026-09-19, so the emitted consent.js kept this specifier verbatim and every function that
// imported it exited 1 on Vercel. gates/build-gates.mjs pins the pair.
import { formatCents } from './pricing.ts';

export type ConsentLane = 'prepay' | 'payafter';

/** Everything the sentence needs, all of it read from rows by the caller. */
export type ConsentInput = {
  lane: ConsentLane;
  /** The package's recurring monthly price, in cents. Not the first charge. */
  monthlyCents: number;
  /** What is actually taken on day one: monthly less any offer, plus one-off extras. */
  firstChargeCents: number;
  /** ISO date of the first charge. Lane B only, and lane B must have it — never "later". */
  firstChargeOn: string | null;
  /** The plan's own name, as the customer saw it on the price step. */
  packageName: string;
  /**
   * True when the package's tier is published as a floor ("From $70/visit"). §17602(a)(2)(C)
   * requires us to say that the amount may change where that is the case, and it is the answer
   * to the question left open on 2026-09-19 about the $300 small-yard plan. See R9 §7.
   */
  priceMayChange: boolean;
  /** `business.email` — the cancellation route that needs no login, §17602(c)(1). */
  cancelEmail: string;
  /** `business.name`. */
  businessName: string;
};

export type Disclosure = {
  /** The statutory subparagraph this line exists to satisfy. Rendered as a data attribute so a
   *  gate can check all five are present without matching on prose. */
  cite: 'a2A' | 'a2B' | 'a2C' | 'a2D' | 'a2E' | 'a1trial';
  text: string;
};

export type RenewalTerms = {
  /** The five (six on lane B) disclosures, in the order they are shown. */
  disclosures: Disclosure[];
  /** The single sentence stored in `consents.text_shown`, byte for byte. */
  sentence: string;
  /** The label beside the checkbox. Short, because the sentence is the agreement. */
  checkboxLabel: string;
};

/**
 * THE YEAR IS IN IT, which the rest of the site's dates are not.
 *
 * Everywhere else "Friday, October 2" is the friendlier form and it is right, because the reader
 * is looking at a booking a few days away. This string is different: it is stored verbatim in
 * `consents.text_shown` and restated in an acknowledgment the customer is meant to keep for as
 * long as we keep the record — three years, or one past termination. A date with no year is fine
 * to read on Tuesday and ambiguous to read in 2029.
 */
const niceDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

const money = (cents: number) => formatCents(cents, { forceDecimals: cents % 100 !== 0 });

/**
 * The renewal terms and the consent sentence for one booking.
 *
 * Throws on a one-time job rather than returning null: a caller that reaches here with a
 * non-renewing purchase has a bug, and a null would let it render an empty box and carry on.
 */
export function renewalTerms(input: ConsentInput): RenewalTerms {
  if (input.lane !== 'prepay' && input.lane !== 'payafter') {
    throw new Error(`renewalTerms: ${String(input.lane)} does not renew — §17602 does not reach it`);
  }
  if (input.lane === 'payafter' && !input.firstChargeOn) {
    throw new Error('renewalTerms: lane B must carry the date of the first charge, never "later"');
  }

  const monthly = money(input.monthlyCents);
  const first = money(input.firstChargeCents);
  const discounted = input.firstChargeCents !== input.monthlyCents;

  const disclosures: Disclosure[] = [];

  // §17602(a)(1), second sentence: where the offer includes a trial or a promotional price, the
  // price charged AFTER it has to be explained just as clearly. Lane B is a free-to-pay
  // conversion — the case AB 2863 added — and a half-off first month is a promotional price.
  if (input.lane === 'payafter') {
    disclosures.push({
      cite: 'a1trial',
      text: `Nothing is charged today. Your card is saved, and your first payment of ${first} is on ` +
            `${niceDate(input.firstChargeOn!)} — the day after your first visit.`,
    });
  } else if (discounted) {
    disclosures.push({
      cite: 'a1trial',
      text: `You pay ${first} today for your first month. After that the price is ${monthly} a month.`,
    });
  }

  // (A) That the agreement will continue until the consumer cancels.
  disclosures.push({
    cite: 'a2A',
    text: `Your ${input.packageName} plan continues every month until you cancel it.`,
  });

  // (B) A description of the cancellation policy.
  disclosures.push({
    cite: 'a2B',
    text: `Cancel anytime from your account, or by emailing ${input.cancelEmail}. ` +
          `There is no notice period and no cancellation fee, and cancelling takes effect at the ` +
          `end of the month you have already paid for.`,
  });

  // (C) The recurring charges, the frequency, and — where it is true — that the amount may change.
  disclosures.push({
    cite: 'a2C',
    text: `${monthly} a month, charged on the same day each month` +
      (input.priceMayChange
        ? `. This is the published price for the size you chose, and it is a starting price: if ` +
          `your yard needs more time than it covers, ${input.businessName} will tell you at least ` +
          `7 days before the amount changes, and you can cancel instead.`
        : `. The amount does not change unless you change your plan.`),
  });

  // (D) The length of the term, or that the service is continuous.
  disclosures.push({
    cite: 'a2D',
    text: 'There is no fixed term. The service is continuous and runs month to month.',
  });

  // (E) The minimum purchase obligation, if any.
  disclosures.push({
    cite: 'a2E',
    text: 'No minimum number of visits, and no contract.',
  });

  // The sentence itself. One sentence of agreement, one of how to get out — and on lane B the
  // date, because a free-to-pay conversion where the customer cannot say when the money moves is
  // the exact thing the amendment was written about.
  const renews = input.priceMayChange
    ? `renews at ${monthly} a month, which may change if my yard needs more time, until I cancel`
    : `renews at ${monthly} a month until I cancel`;

  const sentence = input.lane === 'payafter'
    ? `I agree that my card is saved today, that my first payment of ${first} is on ` +
      `${niceDate(input.firstChargeOn!)}, and that my plan then ${renews}. ` +
      `I can cancel anytime in my account.`
    : `I agree my plan ${renews}. I can cancel anytime in my account.`;

  return {
    disclosures,
    sentence,
    checkboxLabel: 'I agree to the renewal terms above',
  };
}

/**
 * The acknowledgment §17602(a)(3) requires: the renewal terms, the cancellation policy and how
 * to cancel, "in a manner that is capable of being retained by the consumer". The booking
 * receipt renders this block.
 *
 * IT TAKES THE AGREED SENTENCE RATHER THAN RE-DERIVING IT. The caller reads `text_shown` back
 * out of `consents` and passes it here, so the acknowledgment restates what was actually
 * accepted. Rebuilding the sentence at send time would let a price that moved in between
 * produce an acknowledgment of terms nobody agreed to, which is worse than sending none.
 *
 * IT IS A FUNCTION AND NOT A TEMPLATE LITERAL INSIDE THE EMAIL so that `gates/consent.mjs` can
 * call it with planted inputs and assert on the four required elements, instead of grepping a
 * 40-line HTML string for prose.
 */
export function acknowledgmentHtml(p: {
  /** `consents.text_shown`, verbatim. Null only if the record could not be read. */
  agreedSentence: string | null;
  /** §17602(c)(1): the cancellation route that does not require signing in. */
  cancelEmail: string;
  phone: string;
  /** Absolute site URL, so the link works in a mail client. */
  site: string;
}): string {
  const { agreedSentence, cancelEmail, phone, site } = p;
  return `
      <div style="border:1px solid #C9DDD0;background:#F3F7F4;border-radius:12px;padding:16px 18px;margin:24px 0" data-acknowledgment>
        <p style="font-size:15px;font-weight:600;color:#0F2A1F;margin:0 0 10px">Your plan, and how to cancel it</p>
        ${agreedSentence ? `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;color:#1A1A1A" data-ack-agreed>${agreedSentence}</p>` : ''}
        <p style="font-size:15px;line-height:1.6;margin:0 0 10px;color:#1A1A1A" data-ack-policy>
          Your plan continues every month until you cancel it. There is no notice period and no
          cancellation fee, and cancelling takes effect at the end of the month you have already
          paid for.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:0;color:#1A1A1A" data-ack-how>
          <strong>To cancel:</strong> use the Cancel button in
          <a href="${site}/account" style="color:#24593F">your account</a>,
          or simply reply to this email${cancelEmail ? ` or write to <a href="mailto:${cancelEmail}" style="color:#24593F">${cancelEmail}</a>` : ''}${phone ? `. You can also call ${phone}` : ''}.
          You do not need to sign in to cancel by email.
        </p>
      </div>`;
}
