/**
 * What a customer is asked about, and — for a job that builds or installs something — the
 * California home-improvement contract the quote page becomes.
 *
 * THE NOTICES ARE THE STATUTE'S WORDS, copied from B&P §7159 as published at
 * leginfo.legislature.ca.gov on 2026-09-27. They are not paraphrased and must not be: §7159(d)–(e)
 * prescribes the headings and the text, and "substantially the following form" is the most
 * latitude it gives. If the statute changes, change the text here and nowhere else.
 *
 * WHAT THIS MODULE DOES NOT DO: decide whether a job is home improvement. That is the owner's one
 * switch on the quote (`is_improvement`), because "install turf" and "clean the turf" read alike
 * to a regex and are different contracts in law.
 */

import { IMPROVEMENT_DEPOSIT_CEILING_CENTS, money } from './quote-math.ts';

export const JOB_KINDS = [
  { id: 'yard_cleanup', label: 'Overgrown or neglected yard clean-up', improvement: false },
  { id: 'haul_away', label: 'Debris, junk or green waste haul-away', improvement: false },
  { id: 'turf', label: 'Artificial turf: install, repair or restore', improvement: true },
  { id: 'landscaping', label: 'Landscaping: planting, gravel, beds, irrigation', improvement: true },
  { id: 'pressure_washing', label: 'Pressure washing a large area', improvement: false },
  { id: 'property', label: 'Move-in, move-out or rental property clean-up', improvement: false },
  { id: 'pet_waste', label: 'Pet waste on a large property or kennel', improvement: false },
  { id: 'other', label: 'Something else', improvement: false },
] as const;

export type JobKind = typeof JOB_KINDS[number]['id'];
export const JOB_KIND_IDS = JOB_KINDS.map((k) => k.id) as readonly string[];
export const jobKindLabel = (id: string) => JOB_KINDS.find((k) => k.id === id)?.label ?? id;
/** A starting guess for the owner's switch — he can turn it either way. */
export const looksLikeImprovement = (kinds: string[]) => kinds.some((k) => JOB_KINDS.find((j) => j.id === k)?.improvement);

export type CglFact =
  | { mode: 'none' }
  | { mode: 'carries'; insurer: string; phone: string }
  | { mode: 'self' }
  | { mode: 'llc'; insurer: string; phone: string };

export type ContractFacts = {
  legalName: string | null;          // the name on the licence
  licenceNumber: string | null;
  licenceClass: string | null;
  mailingAddress: string | null;     // where a Notice of Cancellation is sent
  email: string | null;
  phone: string | null;
  cgl: CglFact | null;
  workersComp: 'exempt' | 'carries' | null;
};

/** What is still unknown before an install contract can be sent, as words the owner reads. */
export function contractGaps(f: ContractFacts): string[] {
  const gaps: string[] = [];
  if (!f.licenceNumber) gaps.push('the contractor licence number');
  if (!f.legalName) gaps.push('the name on the licence');
  if (!f.mailingAddress) gaps.push('a mailing address for cancellation notices');
  if (!f.email) gaps.push('a business email');
  if (!f.cgl) gaps.push('whether the business carries liability insurance');
  else if ((f.cgl.mode === 'carries' || f.cgl.mode === 'llc') && (!f.cgl.insurer || !f.cgl.phone)) gaps.push("the insurance company's name and phone number");
  if (!f.workersComp) gaps.push("whether the business has employees (workers' compensation)");
  return gaps;
}

const nameOr = (f: ContractFacts) => f.legalName || 'This contractor';

export function cglStatement(f: ContractFacts): string {
  const n = nameOr(f);
  switch (f.cgl?.mode) {
    case 'none': return `${n} does not carry commercial general liability insurance.`;
    case 'carries': return `${n} carries commercial general liability insurance written by ${f.cgl.insurer}. You may call ${f.cgl.insurer} at ${f.cgl.phone} to check the contractor’s insurance coverage.`;
    case 'self': return `${n} is self-insured.`;
    case 'llc': return `${n} is a limited liability company that carries liability insurance or maintains other security as required by law. You may call ${f.cgl.insurer} at ${f.cgl.phone} to check on the contractor’s insurance coverage or security.`;
    default: return '';
  }
}

export function workersCompStatement(f: ContractFacts): string {
  const n = nameOr(f);
  if (f.workersComp === 'exempt') return `${n} has no employees and is exempt from workers’ compensation requirements.`;
  if (f.workersComp === 'carries') return `${n} carries workers’ compensation insurance for all employees.`;
  return '';
}

export const ENTITLED_TO_COPY = 'You are entitled to a completely filled in copy of this agreement, signed by both you and the contractor, before any work may be started.';

/**
 * The figure is resolved from the constant the cap is ENFORCED with, not typed: the notice a buyer
 * reads and the deposit the code allows are then one number. It renders as the statute's own text.
 */
export const DOWNPAYMENT_NOTICE = `THE DOWNPAYMENT MAY NOT EXCEED ${money(IMPROVEMENT_DEPOSIT_CEILING_CENTS)} OR 10 PERCENT OF THE CONTRACT PRICE, WHICHEVER IS LESS.`;

export const PROGRESS_PAYMENTS_NOTICE = 'The schedule of progress payments must specifically describe each phase of work, including the type and amount of work or services scheduled to be supplied in each phase, along with the amount of each proposed progress payment. IT IS AGAINST THE LAW FOR A CONTRACTOR TO COLLECT PAYMENT FOR WORK NOT YET COMPLETED, OR FOR MATERIALS NOT YET DELIVERED. HOWEVER, A CONTRACTOR MAY REQUIRE A DOWNPAYMENT.';

export const EXTRA_WORK_NOTE = 'Extra Work and Change Orders become part of the contract once the order is prepared in writing and signed by the parties prior to the commencement of work covered by the new change order. The order must describe the scope of the extra work or change, the cost to be added or subtracted from the contract, and the effect the order will have on the schedule of progress payments.';

/** §7159(e)(3): the buyer's side of extra work, in plain statements as the subdivision lists them. */
export const EXTRA_WORK_BUYER_NOTICE = [
  'You may not require the contractor to perform extra or change-order work without providing written authorization prior to the commencement of work covered by the new change order.',
  'Extra work or a change order is not enforceable against you unless the change order also identifies all of the following in writing prior to the commencement of work covered by the new change order: the scope of work encompassed by the order; the amount to be added or subtracted from the contract; and the effect the order will make in the progress payments or the completion date.',
  'The contractor’s failure to comply with these requirements does not preclude the recovery of compensation for work performed based upon legal or equitable remedies designed to prevent unjust enrichment.',
];

/** §7159(c)(4). */
export const LIEN_RELEASE_STATEMENT = 'Upon satisfactory payment being made for any portion of the work performed, the contractor, prior to any further payment being made, shall furnish to the person contracting for the home improvement work a full and unconditional release from any potential lien claimant claim or mechanics lien authorized pursuant to Sections 8400 and 8404 of the Civil Code for that portion of the work for which payment has been made.';

/** §7159(c)(6). */
export const BOND_NOTICE = 'You, the owner or tenant, have the right to require the contractor to have a performance and payment bond.';

export const MECHANICS_LIEN_WARNING = [
  'MECHANICS LIEN WARNING:',
  'Anyone who helps improve your property, but who is not paid, may record what is called a mechanics lien on your property. A mechanics lien is a claim, like a mortgage or home equity loan, made against your property and recorded with the county recorder.',
  'Even if you pay your contractor in full, unpaid subcontractors, suppliers, and laborers who helped to improve your property may record mechanics liens and sue you in court to foreclose the lien. If a court finds the lien is valid, you could be forced to pay twice or have a court officer sell your home to pay the lien. Liens can also affect your credit.',
  'To preserve their right to record a lien, each subcontractor and material supplier must provide you with a document called a ‘Preliminary Notice.’ This notice is not a lien. The purpose of the notice is to let you know that the person who sends you the notice has the right to record a lien on your property if they are not paid.',
  'BE CAREFUL. The Preliminary Notice can be sent up to 20 days after the subcontractor starts work or the supplier provides material. This can be a big problem if you pay your contractor before you have received the Preliminary Notices.',
  'You will not get Preliminary Notices from your prime contractor or from laborers who work on your project. The law assumes that you already know they are improving your property.',
  'PROTECT YOURSELF FROM LIENS. You can protect yourself from liens by getting a list from your contractor of all the subcontractors and material suppliers that work on your project. Find out from your contractor when these subcontractors started work and when these suppliers delivered goods or materials. Then wait 20 days, paying attention to the Preliminary Notices you receive.',
  'PAY WITH JOINT CHECKS. One way to protect yourself is to pay with a joint check. When your contractor tells you it is time to pay for the work of a subcontractor or supplier who has provided you with a Preliminary Notice, write a joint check payable to both the contractor and the subcontractor or material supplier.',
  'For other ways to prevent liens, visit CSLB’s internet website at www.cslb.ca.gov or call CSLB at 800-321-CSLB (2752).',
  'REMEMBER, IF YOU DO NOTHING, YOU RISK HAVING A LIEN PLACED ON YOUR HOME. This can mean that you may have to pay twice, or face the forced sale of your home to pay what you owe.',
];

export const CSLB_NOTICE = [
  'Information about the Contractors State License Board (CSLB): CSLB is the state consumer protection agency that licenses and regulates construction contractors.',
  'Contact CSLB for information about the licensed contractor you are considering, including information about disclosable complaints, disciplinary actions, and civil judgments that are reported to CSLB.',
  'Use only licensed contractors. If you file a complaint against a licensed contractor within the legal deadline (usually four years), CSLB has authority to investigate the complaint. If you use an unlicensed contractor, CSLB may not be able to help you resolve your complaint. Your only remedy may be in civil court, and you may be liable for damages arising out of any injuries to the unlicensed contractor or the unlicensed contractor’s employees.',
  'For more information:',
  'Visit CSLB’s internet website at www.cslb.ca.gov',
  'Call CSLB at 800-321-CSLB (2752)',
  'Write CSLB at P.O. Box 26000, Sacramento, CA 95826.',
];

/** §7159(e)(6)(B). "three"/"third" become "five"/"fifth" for a buyer who is a senior citizen. */
export function rightToCancel(senior: boolean): { heading: string; paragraphs: string[] } {
  const n = senior ? 'five' : 'three';
  const nth = senior ? 'fifth' : 'third';
  const N = senior ? 'Five' : 'Three';
  return {
    heading: `${N}-Day Right to Cancel`,
    paragraphs: [
      `You, the buyer, have the right to cancel this contract within ${n} business days. You may cancel by emailing, mailing, faxing, or delivering a written notice to the contractor at the contractor’s place of business by midnight of the ${nth} business day after you received a signed and dated copy of the contract that includes this notice. Include your name, your address, and the date you received the signed copy of the contract and this notice.`,
      'If you cancel, the contractor must return to you anything you paid within 10 days of receiving the notice of cancellation. For your part, you must make available to the contractor at your residence, in substantially as good condition as you received them, goods delivered to you under this contract or sale. Or, you may, if you wish, comply with the contractor’s instructions on how to return the goods at the contractor’s expense and risk. If you do make the goods available to the contractor and the contractor does not pick them up within 20 days of the date of your notice of cancellation, you may keep them without any further obligation. If you fail to make the goods available to the contractor, or if you agree to return the goods to the contractor and fail to do so, then you remain liable for performance of all obligations under the contract.',
    ],
  };
}

/** §7159(e)(6)(C)(vi): the Notice of Cancellation form. */
export function noticeOfCancellation(p: { senior: boolean; transactionDate: string; sellerName: string; sellerAddress: string; sellerEmail: string; lastDay: string }): string[] {
  const n = p.senior ? 'five' : 'three';
  return [
    'Notice of Cancellation',
    p.transactionDate,
    `You may cancel this transaction, without any penalty or obligation, within ${n} business days from the above date.`,
    'If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within 10 days following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be canceled.',
    'If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller’s expense and risk.',
    'If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to the seller, or if you agree to return the goods to the seller and fail to do so, then you remain liable for performance of all obligations under the contract.',
    `To cancel this transaction, email, mail, or deliver a signed and dated copy of this cancellation notice, or any other written notice, to ${p.sellerName} at ${p.sellerAddress} (email ${p.sellerEmail}) not later than midnight of ${p.lastDay}.`,
    'I hereby cancel this transaction. (Date) (Buyer’s signature)',
  ];
}

/**
 * The last day to cancel: midnight of the Nth business day after the buyer receives the signed
 * copy.
 *
 * THIS DATE MAY ONLY EVER ERR LATE. A date earlier than the law's would understate the buyer's
 * right on the page that states it. So it skips Saturdays, Sundays and every federal holiday
 * (observed dates included) — a superset of the days California's definition skips — which can
 * only move the date later than the statutory one, never earlier. Honouring a cancellation a day
 * longer than required costs nothing; printing a day too few is a defective notice.
 */
export function cancelBy(fromIsoDate: string, businessDays: number): string {
  const d = new Date(`${fromIsoDate}T12:00:00Z`);
  let left = businessDays;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !federalHolidays(d.getUTCFullYear()).has(d.toISOString().slice(0, 10))) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** US federal holidays for a year, as ISO dates, with Saturday/Sunday holidays observed Friday/Monday. */
export function federalHolidays(year: number): Set<string> {
  const iso = (m: number, day: number) => new Date(Date.UTC(year, m, day)).toISOString().slice(0, 10);
  const nth = (m: number, weekday: number, n: number) => {
    const first = new Date(Date.UTC(year, m, 1)).getUTCDay();
    return iso(m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  };
  const last = (m: number, weekday: number) => {
    const end = new Date(Date.UTC(year, m + 1, 0));
    return iso(m, end.getUTCDate() - ((end.getUTCDay() - weekday + 7) % 7));
  };
  const observed = (m: number, day: number) => {
    const wd = new Date(Date.UTC(year, m, day)).getUTCDay();
    return [iso(m, day), wd === 6 ? iso(m, day - 1) : wd === 0 ? iso(m, day + 1) : iso(m, day)];
  };
  return new Set([
    ...observed(0, 1), nth(0, 1, 3), nth(1, 1, 3), last(4, 1), ...observed(5, 19), ...observed(6, 4),
    nth(8, 1, 1), nth(9, 1, 2), ...observed(10, 11), nth(10, 4, 4), ...observed(11, 25),
  ]);
}
