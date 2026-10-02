/**
 * The arithmetic of a custom quote, in one place — imported by the quote page the customer ticks
 * options on, the builder the owner prices from, and the server that charges. The same reason as
 * pricing.ts: the total a customer sees, the deposit the builder shows and the amount Stripe takes
 * cannot disagree if there is only one function that computes them.
 *
 * Pure. No database, no network, no Date.
 *
 * THE CALIFORNIA RULES, stated where they are enforced (R21 §1):
 *  - B&P §7159.5(a)(3): on a home-improvement contract the down payment may not exceed $1,000 or
 *    10% of the contract price, whichever is less. `improvementCapCents()`.
 *  - B&P §7159(a): the written-contract requirements apply when the aggregate price exceeds $500.
 *    `needsWrittenContract()`.
 *  - B&P §7048 (AB 2622, from 2025-01-01): work of $1,000 or more needs a contractor's licence.
 *    `needsLicence()`. Maintenance and clean-up are not "home improvement"; the owner's one switch
 *    on the quote (`isImprovement`) is what says which this is.
 */

export type QuoteLine = {
  id: string;
  description: string;
  detail?: string;
  amount_cents: number;
  optional: boolean;
};

export type DepositMode = 'percent' | 'fixed' | 'none';

export type DepositRule = {
  mode: DepositMode;
  percent?: number | null;        // for 'percent'
  fixedCents?: number | null;     // for 'fixed'
};

export const IMPROVEMENT_DEPOSIT_CEILING_CENTS = 100_000;   // $1,000
export const WRITTEN_CONTRACT_OVER_CENTS = 50_000;          // $500
export const LICENCE_AT_CENTS = 100_000;                     // $1,000

export function quoteTotals(lines: QuoteLine[], chosenOptionalIds: Iterable<string> = []) {
  const chosen = new Set(chosenOptionalIds);
  let required = 0;
  let optionalChosen = 0;
  let optionalAvailable = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.amount_cents) || l.amount_cents < 0) throw new Error(`bad amount on "${l.description}"`);
    if (!l.optional) required += l.amount_cents;
    else {
      optionalAvailable += l.amount_cents;
      if (chosen.has(l.id)) optionalChosen += l.amount_cents;
    }
  }
  return { required, optionalChosen, optionalAvailable, total: required + optionalChosen };
}

/** 10% of the price or $1,000, whichever is less. Integer cents, rounded down, as the database check computes it. */
export function improvementCapCents(totalCents: number): number {
  return Math.min(IMPROVEMENT_DEPOSIT_CEILING_CENTS, Math.floor(totalCents / 10));
}

/**
 * The deposit on a total, and whether the California cap cut it down.
 *
 * On a home-improvement job the owner's rule is still honoured when it is inside the cap, and cut
 * to the cap when it is not — never refused. Refusing would leave him with a quote he cannot send
 * over a number the site can compute for him.
 */
export function depositFor(totalCents: number, rule: DepositRule, isImprovement: boolean) {
  let asked = 0;
  if (rule.mode === 'percent') asked = Math.round(totalCents * Math.max(0, Math.min(100, Number(rule.percent ?? 0))) / 100);
  else if (rule.mode === 'fixed') asked = Math.max(0, Math.round(Number(rule.fixedCents ?? 0)));
  asked = Math.min(asked, totalCents);
  const cap = isImprovement ? improvementCapCents(totalCents) : null;
  const cents = cap === null ? asked : Math.min(asked, cap);
  return { cents, asked, capCents: cap, capped: cap !== null && asked > cap, balance: totalCents - cents };
}

export const needsWrittenContract = (isImprovement: boolean, totalCents: number) =>
  isImprovement && totalCents > WRITTEN_CONTRACT_OVER_CENTS;

export const needsLicence = (isImprovement: boolean, totalCents: number) =>
  isImprovement && totalCents >= LICENCE_AT_CENTS;

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * What a customer is agreeing to when they approve, as one sentence the server re-builds and
 * compares — the same pattern as the renewal consent. A browser that shows different terms from
 * the ones the server would charge on is refused, not trusted.
 */
export function acceptanceTerms(p: {
  businessName: string; number: number; totalCents: number; depositCents: number; isImprovement: boolean;
}): string {
  const balance = p.totalCents - p.depositCents;
  const pay = p.depositCents > 0
    ? `I pay a ${money(p.depositCents)} deposit now and the ${money(balance)} balance when the work is done`
    : `I pay ${money(p.totalCents)} when the work is done`;
  const tail = p.isImprovement
    ? ' I have read the contract terms and notices on this page, including my right to cancel.'
    : '';
  return `I approve ${p.businessName} quote #${p.number} for ${money(p.totalCents)}. ${pay}.${tail}`;
}
