/**
 * QUESTION PAGES — one question, one page, the direct answer in the first sentence.
 *
 * Ben, 2026-09-16: "targeting-specific-questions-across-dozens-or-hundreds of landing pages
 * instead of the old-school 2010s blog post and keyword style seo". The evidence and the limits
 * are in client-portal-and-ai-employee-plans/research/R6-DESIGN-MONEY-AND-AI-SEARCH.md §C:
 *
 *   - AI Mode fans a question out into about a dozen sub-searches (C3), so a precise page per
 *     facet is retrievable where a blog post is not.
 *   - Google names "many pages ... without adding value" as scaled content abuse (C1), so every
 *     page here must say something only Scoop Dogg can say. Concretely: every answer is BUILT
 *     from the catalog rows (prices, packages, offers, settings, service rows), and each page
 *     declares the facts it used. gates/question-pages.mjs re-resolves those facts against
 *     content/catalog.json, checks each one is visible on the page, and fails a page whose text
 *     is too close to its nearest sibling.
 *   - So the number of pages is set by the number of true facts, not by a target (C4). A
 *     question is only emitted when the rows it needs exist — switch an offer off, or leave a
 *     city's service days empty, and the pages that depend on them are simply not built.
 *
 * Nothing here is typed as a number. If you find yourself writing "$" followed by a digit in
 * this file, the answer is wrong the day the price changes.
 */
import {
  services, serviceBySlug, packagesForService, tiersFor, formatCents, formatTierPrice, offers, headlineOffer,
  markets, areas, reviews, trust, growth, setting, hasSetting, business, regionSentence,
} from './catalog';
import type { Package, Tier } from '../shared/pricing';

export type Topic = 'Cost' | 'Plans and billing' | 'Visits' | 'Turf and odor' | 'Choosing a service' | 'About Scoop Dogg';
export const TOPICS: Topic[] = ['Cost', 'Plans and billing', 'Visits', 'Turf and odor', 'Choosing a service', 'About Scoop Dogg'];

/** A catalog value the page relies on. `key` is resolved independently by the gate. */
export type Fact = { key: string; value: string | number | boolean; shown: string };

export type Block =
  | { kind: 'table'; title: string; head: string[]; rows: string[][] }
  | { kind: 'list'; title: string; items: string[] }
  | { kind: 'steps'; title: string; items: { t: string; d: string }[] }
  | { kind: 'links'; title: string; items: { href: string; label: string; note?: string }[] };

export type Question = {
  slug: string;
  q: string;
  topic: Topic;
  /** The direct answer. First sentence answers the question; no preamble. Plain text. */
  answer: string;
  /** One more paragraph of specifics, optional. Plain text. */
  more?: string;
  facts: Fact[];
  blocks: Block[];
  /** Where the page sends someone who is ready: the booking flow, or a quote for one-time work. */
  action: { href: string; label: string; service?: string };
  /** The service page this question belongs to, for the breadcrumb and a link. */
  service?: string;
  /** Words that pick a relevant review to quote as evidence. */
  reviewWords?: string[];
  related?: string[];
};

const SCOOP = 'weekly-pooper-scooper-service';
const per = (p: Package) => Math.round(p.monthly_price_cents / p.visits_per_month / 100) * 100;
const money = (c: number) => formatCents(c, { forceDecimals: c % 100 !== 0 });
const f = (key: string, value: Fact['value'], shown: string): Fact => ({ key, value, shown });
/** A settings fact: `setting:` when a row holds it, `default:` when the page used a code fallback
 *  (an assumption on Ben's veto list), so the gate can tell a verified fact from a default. */
const sf = (key: string, value: Fact['value'], shown: string): Fact => f(`${hasSetting(key) ? 'setting' : 'default'}:${key}`, value, shown);
const pkgFact = (p: Package) => f(`package:${p.slug}.monthly_price_cents`, p.monthly_price_cents, formatCents(p.monthly_price_cents));
const tierFact = (t: Tier) => f(`tier:${t.id}.price_cents`, t.price_cents ?? 'quote', formatTierPrice(t));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const slugify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const firstMonth = (p: Package, pct: number) => p.monthly_price_cents - Math.round((p.monthly_price_cents * pct) / 100);

function scoopingQuestions(): Question[] {
  const pk = packagesForService(SCOOP);
  const svc = serviceBySlug(SCOOP);
  if (!pk.length || !svc) return [];
  const lo = pk[0];
  const hi = pk[pk.length - 1];
  const offer = headlineOffer;
  const out: Question[] = [];

  out.push({
    slug: 'how-much-does-weekly-dog-poop-pickup-cost',
    q: 'How much does weekly dog poop pickup cost?',
    topic: 'Cost',
    answer: `Weekly dog poop pickup from Scoop Dogg costs ${formatCents(lo.monthly_price_cents)} a month for ${lo.short_label.toLowerCase()}, up to ${formatCents(hi.monthly_price_cents)} a month for ${hi.short_label.toLowerCase()}. That is about ${formatCents(per(lo))} to ${formatCents(per(hi))} a visit, on the same day every week.`,
    more: `${svc.price_basis === 'dogs' ? 'The price depends on how many dogs you have, not on the size of your yard. ' : ''}${offer ? `${offer.name}, and there` : 'There'} is no contract or sign-up fee.`,
    facts: [...pk.map(pkgFact), ...(offer ? [f(`offer:${offer.id}.value`, offer.value, offer.name)] : [])],
    blocks: [
      { kind: 'table', title: 'Weekly scooping, by number of dogs', head: ['Dogs', 'Per month', 'About per visit', ...(offer ? ['First month'] : [])],
        rows: pk.map((p) => [p.short_label, formatCents(p.monthly_price_cents), formatCents(per(p)), ...(offer ? [money(firstMonth(p, offer.value))] : [])]) },
      { kind: 'list', title: 'Every visit includes', items: svc.what_includes ?? [] },
    ],
    action: { href: `/book?service=${SCOOP}`, label: 'See my price', service: SCOOP },
    service: SCOOP,
    reviewWords: ['price', 'affordable'],
  });

  if (offer) {
    const turfOffer = offers.find((o) => o.status === 'active' && o.id !== offer.id && (o.requires_slugs ?? []).includes(SCOOP));
    const turf = turfOffer ? packagesForService(turfOffer.applies_to_slugs[0]) : [];
    out.push({
      slug: 'is-there-a-discount-on-the-first-month',
      q: 'Is there a discount on the first month?',
      topic: 'Plans and billing',
      answer: `Yes. ${offer.name} on weekly scooping, so your first payment is ${money(firstMonth(lo, offer.value))} instead of ${formatCents(lo.monthly_price_cents)} for ${lo.short_label.toLowerCase()}. After that, your plan renews at the regular monthly price.`,
      more: turfOffer && turf.length ? `Adding weekly turf maintenance to your scooping? Its first month is ${turfOffer.value === 50 ? 'half off' : `${turfOffer.value}% off`} too: ${money(firstMonth(turf[0], turfOffer.value))} on a ${turf[0].short_label.toLowerCase()}, then ${formatCents(turf[0].monthly_price_cents)} a month.` : undefined,
      facts: [f(`offer:${offer.id}.value`, offer.value, offer.name), ...pk.map(pkgFact), ...(turfOffer && turf.length ? [f(`offer:${turfOffer.id}.value`, turfOffer.value, turfOffer.value === 50 ? 'half off' : `${turfOffer.value}% off`), pkgFact(turf[0])] : [])],
      blocks: [
        { kind: 'table', title: 'Your first month on weekly scooping', head: ['Dogs', 'First month', 'Then each month'], rows: pk.map((p) => [p.short_label, money(firstMonth(p, offer.value)), formatCents(p.monthly_price_cents)]) },
      ],
      action: { href: `/book?service=${SCOOP}`, label: 'Claim my first month', service: SCOOP },
      service: SCOOP,
    });
  }

  const factor = setting<string>('billing.monthly_factor', '52/12');
  const weekly = tiersFor(SCOOP).filter((t) => t.price_cents !== null);
  if (weekly.length && factor === '52/12') {
    out.push({
      slug: 'is-a-monthly-plan-more-expensive-than-paying-per-visit',
      q: 'Is a monthly plan more expensive than paying per visit?',
      topic: 'Plans and billing',
      answer: `No, it is the same money. Your monthly price is the weekly price times 52 weeks, divided by 12 months: ${formatTierPrice(weekly[0])} a week for ${lower(weekly[0].label)} becomes ${formatCents(lo.monthly_price_cents)} a month.`,
      more: 'Months with five visits are already averaged in, so you pay one steady amount instead of a bill that changes month to month.',
      facts: [sf('billing.monthly_factor', factor, '52'), ...weekly.map(tierFact), ...pk.map(pkgFact)],
      blocks: [
        { kind: 'table', title: 'Weekly price and monthly price', head: ['Dogs', 'Per week', 'Per month (× 52 ÷ 12)'],
          rows: pk.map((p) => { const t = weekly.find((w) => w.id === p.tier_id); return [p.short_label, t ? formatTierPrice(t) : '—', formatCents(p.monthly_price_cents)]; }) },
      ],
      action: { href: `/book?service=${SCOOP}`, label: 'See my price', service: SCOOP },
      service: SCOOP,
    });
  }

  if ((svc.what_includes ?? []).length) {
    out.push({
      slug: 'what-happens-on-a-weekly-poop-scooping-visit',
      q: 'What happens on a weekly poop scooping visit?',
      topic: 'Visits',
      answer: `We walk your whole yard on your set day, pick up every pile, and take the waste away with us. In detail: ${list((svc.what_includes ?? []).map(lower))}.`,
      facts: [f(`service:${SCOOP}.what_includes`, (svc.what_includes ?? []).length, (svc.what_includes ?? [])[0])],
      blocks: [
        { kind: 'steps', title: 'A visit, start to finish', items: (svc.what_includes ?? []).map((w, i) => ({ t: `Step ${i + 1}`, d: w })) },
      ],
      action: { href: `/book?service=${SCOOP}`, label: 'See my price', service: SCOOP },
      service: SCOOP,
      reviewWords: ['thorough', 'corners', 'clean'],
    });
  }

  const includes = svc.what_includes ?? [];
  const removal = includes.find((w) => /double-bag/i.test(w) && /remov/i.test(w));
  if (removal) {
    out.push({
      slug: 'where-does-the-dog-poop-go-after-you-pick-it-up',
      q: 'Where does the dog poop go after you pick it up?',
      topic: 'Visits',
      answer: 'It leaves with us. On every visit the waste is double-bagged and taken off your property, so none of it ends up in your trash can.',
      more: 'If you ever scoop between visits, our disposal guide explains the local rules for pet waste.',
      facts: [f(`service:${SCOOP}.what_includes`, includes.length, removal)],
      blocks: [
        { kind: 'list', title: 'Every visit includes', items: includes },
        { kind: 'links', title: 'Read more', items: [{ href: '/resources/dog-waste-disposal-rules-ventura-county', label: 'Dog waste disposal rules in Ventura County' }, { href: `/services/${SCOOP}`, label: svc.name }] },
      ],
      action: { href: `/book?service=${SCOOP}`, label: 'See my price', service: SCOOP },
      service: SCOOP,
    });
  }

  return out;
}

function policyQuestions(): Question[] {
  const out: Question[] = [];
  const start = setting<number>('schedule.new_customer_start_days', 3);
  const windowDays = setting<number>('booking.start_window_days', 14);
  const windowHours = setting<number>('schedule.visit_window_hours', 4);
  const dayStart = setting<string>('schedule.day_start', '07:00');
  const dayEnd = setting<string>('schedule.day_end', '17:00');
  const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`; };
  const pauseMax = setting<number>('subscription.pause_max_weeks', 12);

  out.push({
    slug: 'do-i-need-to-be-home-for-dog-poop-pickup',
    q: 'Do I need to be home for dog poop pickup?',
    topic: 'Visits',
    answer: `No. We come on your set day within a ${windowHours}-hour window between ${clock(dayStart)} and ${clock(dayEnd)}, let ourselves into the yard, and close the gate behind us.`,
    more: 'When you book, add your gate code or access notes. Most customers are at work when we visit.',
    facts: [sf('schedule.visit_window_hours', windowHours, `${windowHours}-hour`), sf('schedule.day_start', dayStart, clock(dayStart)), sf('schedule.day_end', dayEnd, clock(dayEnd))],
    blocks: [
      { kind: 'steps', title: 'Before your first visit', items: [
        { t: 'Tell us how to get in', d: 'Add a gate code or access notes when you book. You can change them later from your account.' },
        { t: 'Let us know about your dogs', d: 'If your dogs are out during the day, say so in your notes.' },
        { t: 'Carry on with your day', d: `We visit within the ${windowHours}-hour window and close the gate when we leave.` },
      ] },
    ],
    action: { href: '/book', label: 'See my price' },
    reviewWords: ['reliable', 'shows up', 'on time'],
  });

  out.push({
    slug: 'how-soon-can-weekly-dog-poop-pickup-start',
    q: 'How soon can weekly dog poop pickup start?',
    topic: 'Visits',
    answer: `Usually within ${start} days. When you book, you choose a start day from the next ${windowDays} days on your city's route, and that becomes your day every week.`,
    facts: [sf('schedule.new_customer_start_days', start, `${start} days`), sf('booking.start_window_days', windowDays, `${windowDays} days`)],
    blocks: [
      { kind: 'steps', title: 'From booking to your first visit', items: [
        { t: 'Enter your address', d: 'We check it is on one of our routes.' },
        { t: 'See your price and pick a day', d: `Choose a start day as soon as ${start} days from now.` },
        { t: 'Pay your first month', d: 'By card, Apple Pay or Google Pay.' },
      ] },
    ],
    action: { href: '/book', label: 'Pick my start day' },
  });

  out.push({
    slug: 'can-i-pause-my-dog-poop-pickup-while-on-vacation',
    q: 'Can I pause my dog poop pickup while I am on vacation?',
    topic: 'Plans and billing',
    answer: `Yes. Pause your plan from your account for up to ${pauseMax} weeks, and you are not charged while it is paused. It picks up again on its own when the pause ends.`,
    more: 'Just away for one week? You can skip a single visit instead, and undo the skip if your plans change.',
    facts: [sf('subscription.pause_max_weeks', pauseMax, `${pauseMax} weeks`)],
    blocks: [
      { kind: 'steps', title: 'Pausing, in your account', items: [
        { t: 'Sign in', d: 'With the email you booked with. We send a six-digit code; there is no password.' },
        { t: 'Choose Pause', d: `Pick how long, up to ${pauseMax} weeks.` },
        { t: 'Back early?', d: 'Choose Resume now and your visits are back on.' },
      ] },
    ],
    action: { href: '/account', label: 'Sign in to my account' },
  });

  out.push({
    slug: 'how-do-i-cancel-weekly-dog-poop-pickup',
    q: 'How do I cancel weekly dog poop pickup?',
    topic: 'Plans and billing',
    answer: 'Cancel from your account in two taps. There is no contract, no cancellation fee and nobody to call. Your visits continue until the end of the month you have already paid for.',
    more: 'Changed your mind before the month ends? Choose Keep my plan and nothing changes.',
    facts: [sf('subscription.cancel_notice_hours', setting<number>('subscription.cancel_notice_hours', 0), 'two taps')],
    blocks: [
      { kind: 'steps', title: 'Cancelling', items: [
        { t: 'Sign in to your account', d: 'With the email you booked with. We send a six-digit code.' },
        { t: 'Choose Cancel plan', d: 'We offer a pause instead, in case that suits you better. Choose Cancel my plan and it is done.' },
        { t: 'Visits run to the end of your paid month', d: 'You are not charged again.' },
      ] },
    ],
    action: { href: '/account', label: 'Sign in to my account' },
  });

  const cardRequired = setting<boolean>('booking.card_required', true);
  out.push({
    slug: 'how-and-when-do-i-pay-for-dog-poop-pickup',
    q: 'How and when do I pay for dog poop pickup?',
    topic: 'Plans and billing',
    answer: `You pay your first month online when you book${headlineOffer ? ` (${headlineOffer.name.toLowerCase()} on weekly scooping)` : ''}, then your plan renews each month on the same card. Payments are processed by Stripe; you can use a card, Apple Pay or Google Pay.`,
    more: 'Your account shows the next payment date and every receipt, and you can update your card there.',
    facts: [sf('booking.card_required', cardRequired, 'card'), ...(headlineOffer ? [f(`offer:${headlineOffer.id}.value`, headlineOffer.value, headlineOffer.name.toLowerCase())] : [])],
    blocks: [
      { kind: 'list', title: 'In your account', items: ['Your plan and its monthly price', 'Every payment, with a receipt under Cards & receipts', 'Update your card any time'] },
    ],
    action: { href: '/book', label: 'See my price' },
  });

  if (trust.guarantee) {
    const [head, ...rest] = trust.guarantee.split(':');
    out.push({
      slug: 'what-happens-if-you-miss-a-spot',
      q: 'What happens if you miss a spot?',
      topic: 'Visits',
      answer: rest.length ? rest.join(':').trim().replace(/^./, (c) => c.toUpperCase()) : trust.guarantee,
      more: `That is our ${head.toLowerCase()}, and it applies to every visit.`,
      facts: [sf('trust.guarantee_text', trust.guarantee, head)],
      blocks: [
        { kind: 'steps', title: head, items: [
          { t: 'Tell us', d: `Call or text ${business.phone} with your address and what was missed.` },
          { t: 'We come back', d: 'And clean up what was missed, at no charge.' },
        ] },
      ],
      action: { href: '/book', label: 'See my price' },
      reviewWords: ['never cuts corners', 'thorough', 'above and beyond'],
    });
  }

  if (trust.insured) {
    out.push({
      slug: 'is-scoop-dogg-insured',
      q: 'Is Scoop Dogg insured?',
      topic: 'About Scoop Dogg',
      answer: `Yes. Scoop Dogg is fully insured${trust.backgroundChecked ? ', and everyone who comes to your yard is background-checked' : ''}. It is a locally owned business run by its owner, Josue.`,
      facts: [sf('trust.insured_confirmed', true, 'insured'), ...(trust.backgroundChecked ? [sf('trust.background_checked_confirmed', true, 'background-checked')] : [])],
      blocks: [
        { kind: 'links', title: 'More about us', items: [{ href: '/about', label: 'About Josue and Scoop Dogg' }, { href: '/reviews', label: `All ${reviews.length} reviews` }] },
      ],
      action: { href: '/book', label: 'See my price' },
      reviewWords: ['kind', 'safe', 'trust', 'dependable'],
    });
  }

  const allAreas = markets().flatMap((m) => m.areas);
  if (allAreas.length) {
    out.push({
      slug: 'which-cities-does-scoop-dogg-serve',
      q: 'Which cities does Scoop Dogg serve?',
      topic: 'About Scoop Dogg',
      answer: `Scoop Dogg serves ${allAreas.length} cities across ${regionSentence()}: ${list(allAreas.map((a) => a.name))}.`,
      more: setting<string>('service_area.outside_area_behaviour', '') === 'capture_lead_and_notify' ? 'If your address is not on a route yet, enter it anyway: we keep it and let you know when a route reaches you.' : undefined,
      facts: [f('areas:count', areas.length, String(allAreas.length)), sf('service_area.outside_area_behaviour', setting<string>('service_area.outside_area_behaviour', ''), 'enter it anyway')],
      blocks: markets().map((m) => ({ kind: 'links' as const, title: m.label.replace(/^the /, 'The '), items: m.areas.map((a) => ({ href: `/areas/${a.slug}`, label: a.name })) })),
      action: { href: '/book', label: 'Check my address' },
    });
  }

  if (growth.commercial) {
    out.push({
      slug: 'do-you-clean-up-dog-waste-for-hoas-and-apartments',
      q: 'Do you clean up dog waste for HOAs and apartments?',
      topic: 'About Scoop Dogg',
      answer: 'Yes. Scoop Dogg services HOA common areas, apartment dog runs and pet relief areas, property managers and pet businesses on a set weekly schedule, with one monthly invoice.',
      more: 'Commercial work is quoted per property. Tell us the property and how often you need service, and we reply within one business day.',
      facts: [sf('growth.commercial_enabled', true, 'HOA')],
      blocks: [
        { kind: 'list', title: 'Properties we take on', items: ['HOA greenbelts, walking paths and dog areas', 'Apartment dog runs, courtyards and pet relief areas', 'Portfolios for property managers, on one invoice', 'Daycares, boarding and training yards'] },
      ],
      action: { href: '/commercial', label: 'Get a property quote' },
    });
  }

  return out;
}

/** One cost question per service other than weekly scooping, built from its own tiers and packages. */
function serviceCostQuestions(): Question[] {
  const phrasing: Record<string, { q: string; slug: string; topic: Topic; words?: string[] }> = {
    'one-time-dog-poop-cleanup': { q: 'How much does it cost to clean up a yard that has not been scooped in weeks?', slug: 'how-much-does-a-one-time-yard-cleanup-cost', topic: 'Cost', words: ['mess', 'huskies'] },
    'artificial-turf-deodorizing': { q: 'How much does artificial turf deodorizing cost?', slug: 'how-much-does-artificial-turf-deodorizing-cost', topic: 'Turf and odor', words: ['turf', 'deodoriz'] },
    'yard-deep-clean': { q: 'How much does a turf deep clean cost?', slug: 'how-much-does-a-turf-deep-clean-cost', topic: 'Turf and odor', words: ['sanitized', 'astro turf'] },
    'weekly-turf-maintenance': { q: 'How much does weekly artificial turf maintenance cost?', slug: 'how-much-does-weekly-turf-maintenance-cost', topic: 'Turf and odor', words: ['turf'] },
    'weekly-yard-maintenance': { q: 'How much does weekly yard maintenance cost?', slug: 'how-much-does-weekly-yard-maintenance-cost', topic: 'Cost', words: ['landscap', 'backyard'] },
    'kitty-litter-exchange': { q: 'How much does a litter box cleaning service cost?', slug: 'how-much-does-litter-box-cleaning-cost', topic: 'Cost' },
    'dog-run-cleanups': { q: 'How much does a dog run cleanup cost?', slug: 'how-much-does-a-dog-run-cleanup-cost', topic: 'Cost', words: ['run'] },
    'cat-tree-cleaning': { q: 'How much does cat tree cleaning cost?', slug: 'how-much-does-cat-tree-cleaning-cost', topic: 'Cost' },
    'pressure-washing': { q: 'How much does pressure washing a patio or dog run cost?', slug: 'how-much-does-pet-area-pressure-washing-cost', topic: 'Cost', words: ['patio', 'sanitiz'] },
    'kitty-litter-robot-cleaning': { q: 'How much does Litter-Robot cleaning cost?', slug: 'how-much-does-litter-robot-cleaning-cost', topic: 'Cost' },
  };
  const out: Question[] = [];
  for (const s of services) {
    if (s.slug === SCOOP) continue;
    const ph = phrasing[s.slug] ?? { q: `How much does ${s.name.toLowerCase()} cost?`, slug: `how-much-does-${slugify(s.name)}-cost`, topic: 'Cost' as Topic };
    const tiers = tiersFor(s.slug);
    const priced = tiers.filter((t) => t.price_cents !== null && !t.requires_quote);
    if (!priced.length) continue;
    const pk = packagesForService(s.slug);
    const quote = tiers.find((t) => t.price_cents === null || t.requires_quote);
    const pieces = priced.map((t) => `${formatTierPrice(t)}${t.price_suffix && !formatTierPrice(t).includes(t.price_suffix) ? t.price_suffix : ''} for ${lower(t.label)}`);
    const answer = pk.length
      ? `${s.name} from Scoop Dogg is ${list(pk.map((p) => `${formatCents(p.monthly_price_cents)} a month for a ${p.short_label.toLowerCase()}`))}, visited every week. Priced per visit, that is ${list(pieces)}.`
      : `${s.name} from Scoop Dogg costs ${list(pieces)}.${quote ? ` ${quote.label.replace(/^./, (c) => c.toUpperCase())} gets a custom quote.` : ''}`;
    const offer = offers.find((o) => o.status === 'active' && o.applies_to_slugs.includes(s.slug));
    const more = [
      s.who_its_for ? `It suits ${lower(s.who_its_for).replace(/\.$/, '')}.` : null,
      offer ? `${offer.name}.` : null,
      pk.length && quote ? `${quote.label.replace(/^./, (c) => c.toUpperCase())} gets a custom quote.` : null,
    ].filter(Boolean).join(' ');
    out.push({
      slug: ph.slug,
      q: ph.q,
      topic: ph.topic,
      answer,
      more: more || undefined,
      facts: [...priced.map(tierFact), ...pk.map(pkgFact), ...(offer ? [f(`offer:${offer.id}.value`, offer.value, offer.name)] : [])],
      blocks: [
        { kind: 'table', title: `${s.name} prices`, head: pk.length ? ['Size', 'Per visit', 'Per month, weekly'] : ['Option', 'Price'],
          rows: tiers.map((t) => { const p = pk.find((x) => x.tier_id === t.id); return pk.length ? [t.label, formatTierPrice(t, 'Custom quote'), p ? formatCents(p.monthly_price_cents) : '—'] : [t.label, formatTierPrice(t, 'Custom quote')]; }) },
        ...((s.what_includes ?? []).length ? [{ kind: 'list' as const, title: 'What is included', items: s.what_includes ?? [] }] : []),
      ],
      action: pk.length ? { href: `/book?service=${s.slug}`, label: 'See my price', service: s.slug } : { href: `/contact?service=${s.slug}`, label: 'Request this service', service: s.slug },
      service: s.slug,
      reviewWords: ph.words,
    });
  }
  return out;
}

/** Questions that compare services, answered from more than one service's rows. */
function choosingQuestions(): Question[] {
  const out: Question[] = [];
  const deo = serviceBySlug('artificial-turf-deodorizing');
  const deep = serviceBySlug('yard-deep-clean');
  const maint = serviceBySlug('weekly-turf-maintenance');
  const lowest = (slug: string) => tiersFor(slug).filter((t) => t.price_cents !== null && !t.requires_quote).sort((a, b) => (a.price_cents ?? 0) - (b.price_cents ?? 0))[0];
  if (deo && deep && maint && lowest(deo.slug) && lowest(deep.slug) && lowest(maint.slug)) {
    const [d, dc, m] = [lowest(deo.slug), lowest(deep.slug), lowest(maint.slug)];
    out.push({
      slug: 'how-do-i-get-rid-of-dog-urine-smell-on-artificial-turf',
      q: 'How do I get rid of dog urine smell on artificial turf?',
      topic: 'Turf and odor',
      answer: `Treat the turf with an enzyme deodorizer, which breaks down urine instead of masking it: Scoop Dogg's turf deodorizing starts at ${formatTierPrice(d)}. If the smell comes back within days, the infill is saturated and needs a deep clean first, from ${formatTierPrice(dc)}.`,
      more: `To keep it from coming back, weekly turf maintenance sweeps and deodorizes every week, from ${formatTierPrice(m)}${m.price_suffix ?? ''}.`,
      facts: [tierFact(d), tierFact(dc), tierFact(m)],
      blocks: [
        { kind: 'table', title: 'Which turf service fits', head: ['If your turf', 'Service', 'From'], rows: [
          ['Smells, but only sometimes', deo.name, formatTierPrice(d)],
          ['Smells again days after cleaning', deep.name, formatTierPrice(dc)],
          ['Gets daily use from dogs', maint.name, `${formatTierPrice(m)}${m.price_suffix ?? ''}`],
        ] },
        { kind: 'links', title: 'Read more', items: [{ href: '/resources/clean-dog-poop-artificial-turf-ventura-county', label: 'How to clean dog poop off artificial turf' }] },
      ],
      action: { href: `/services/${deo.slug}`, label: 'See turf deodorizing' },
      service: deo.slug,
      reviewWords: ['turf', 'sanitized', 'deodoriz'],
    });
  }

  const scoop = packagesForService(SCOOP);
  // The booking flow treats "cleaned this week or in the last two weeks" as ready for weekly
  // scooping (BookingFlow lastCleaned), so the cleanup tiers that matter here are the longer ones.
  const cleanup = tiersFor('one-time-dog-poop-cleanup').filter((t) => !/up to 2 weeks/i.test(t.label));
  const pricedCleanup = cleanup.filter((t) => t.price_cents !== null && !t.requires_quote);
  if (scoop.length && pricedCleanup.length) {
    out.push({
      slug: 'weekly-scooping-or-a-one-time-cleanup-which-do-i-need',
      q: 'Weekly scooping or a one-time cleanup: which do I need?',
      topic: 'Choosing a service',
      answer: `If your yard was cleaned in the last two weeks, start weekly scooping, from ${formatCents(scoop[0].monthly_price_cents)} a month. If waste has built up for longer, book a one-time cleanup first (${list(cleanup.map((t) => `${formatTierPrice(t, 'a custom quote')} for ${lower(t.label)}`))}), then keep it clean weekly.`,
      more: 'When you book weekly scooping, we ask when the yard was last cleaned and suggest a cleanup only if it needs one.',
      facts: [pkgFact(scoop[0]), ...pricedCleanup.map(tierFact), sf('booking.initial_cleanup_policy', setting<string>('booking.initial_cleanup_policy', ''), 'last cleaned')],
      blocks: [
        { kind: 'table', title: 'Where to start, by when the yard was last cleaned', head: ['Last cleaned', 'Start with'], rows: [
          ['In the last two weeks', `Weekly scooping, from ${formatCents(scoop[0].monthly_price_cents)} a month`],
          ...cleanup.map((t) => [t.label, `One-time cleanup, ${formatTierPrice(t, 'custom quote')}, then weekly`]),
        ] },
      ],
      action: { href: `/book?service=${SCOOP}`, label: 'See my price', service: SCOOP },
      service: 'one-time-dog-poop-cleanup',
      reviewWords: ['mess', 'huskies', 'enjoyable again'],
    });
  }
  return out;
}

let cache: Question[] | null = null;

/** Every question page, with related links computed: same service first, then same topic. */
export function questions(): Question[] {
  if (cache) return cache;
  const all = [...scoopingQuestions(), ...policyQuestions(), ...serviceCostQuestions(), ...choosingQuestions()];
  const seen = new Set<string>();
  for (const q of all) {
    if (seen.has(q.slug)) throw new Error(`duplicate question slug ${q.slug}`);
    seen.add(q.slug);
  }
  for (const q of all) {
    const sameService = all.filter((o) => o !== q && o.service && o.service === q.service);
    const sameTopic = all.filter((o) => o !== q && o.topic === q.topic && !sameService.includes(o));
    const rest = all.filter((o) => o !== q && !sameService.includes(o) && !sameTopic.includes(o));
    q.related = [...sameService, ...sameTopic, ...rest].slice(0, 5).map((o) => o.slug);
  }
  cache = all;
  return all;
}

export const questionBySlug = (slug: string) => questions().find((q) => q.slug === slug);

/** A real review that speaks to the question, if one does. */
export function reviewFor(q: Question) {
  const words = (q.reviewWords ?? []).map((w) => w.toLowerCase());
  const hit = words.length ? reviews.find((r) => words.some((w) => r.quote.toLowerCase().includes(w))) : undefined;
  return hit ?? null;
}

/** The markdown twin: the same answer and facts, no page furniture (agentic-seo step 4). */
export function questionMarkdown(q: Question, siteUrl: string): string {
  const lines = [`# ${q.q}`, '', q.answer, ''];
  if (q.more) lines.push(q.more, '');
  for (const b of q.blocks) {
    lines.push(`## ${b.title}`, '');
    if (b.kind === 'table') {
      lines.push(`| ${b.head.join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.join(' | ')} |`), '');
    } else if (b.kind === 'list') {
      lines.push(...b.items.map((i) => `- ${i}`), '');
    } else if (b.kind === 'steps') {
      lines.push(...b.items.map((i, n) => `${n + 1}. **${i.t}.** ${i.d}`), '');
    } else {
      lines.push(...b.items.map((i) => `- [${i.label}](${siteUrl}${i.href})`), '');
    }
  }
  lines.push(`Next step: [${q.action.label}](${siteUrl}${q.action.href}) · Call or text ${business.phone}`, '', `Source: ${siteUrl}/questions/${q.slug}`, '');
  return lines.join('\n');
}
