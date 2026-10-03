/**
 * What a service page must be, checked when the owner saves one — the same rules the build gates
 * hold, so an edit that would turn a gate red is refused with a sentence instead of shipped.
 *
 *   - NO TYPED PRICE IN PROSE (gates/no-price-in-prose.mjs). Prices come from the rate card and
 *     are formatted by the page; "$45" typed into an intro is the second copy that goes stale the
 *     day the price changes.
 *   - A REAL PAGE (gates/build-gates.mjs "crawlable"): a heading, an intro a person can read, what
 *     the visit includes, a description a search result can show. The floors are below the
 *     shortest live service on 2026-09-29 (intro 255 characters, 5 included items).
 *   - DISTINCT TITLES (build-gates "distinct-titles"): checked against the other services by the
 *     caller, which has the rows.
 */
export const PRICE_IN_PROSE = /\$\s?\d/;

export type ServiceProse = {
  name: string;
  short_name: string;
  h1: string;
  intro: string;
  what_includes: string[];
  who_its_for: string;
  faqs: { q: string; a: string }[];
  pricing_note: string;
  meta_title: string;
  meta_description: string;
};

export const LIMITS = {
  name: [3, 60], short_name: [2, 30], h1: [10, 90], intro: [200, 1200], who_its_for: [0, 600],
  pricing_note: [0, 300], meta_title: [15, 70], meta_description: [70, 200], included: [3, 12], item: [3, 200],
} as const;

/** Every problem with a service's words, as sentences the owner can act on. Empty = fine. */
export function serviceProblems(s: ServiceProse): string[] {
  const out: string[] = [];
  const len = (k: keyof typeof LIMITS, v: string, label: string) => {
    const [lo, hi] = LIMITS[k];
    const n = v.trim().length;
    if (n < lo) out.push(`${label} needs at least ${lo} characters (it has ${n}).`);
    if (n > hi) out.push(`${label} can be at most ${hi} characters (it has ${n}).`);
  };
  len('name', s.name, 'The name');
  len('short_name', s.short_name, 'The short name');
  len('h1', s.h1, 'The page heading');
  len('intro', s.intro, 'The introduction');
  len('who_its_for', s.who_its_for, '"Who it is for"');
  len('pricing_note', s.pricing_note, 'The pricing note');
  len('meta_title', s.meta_title, 'The search title');
  len('meta_description', s.meta_description, 'The search description');
  const items = s.what_includes.map((x) => x.trim()).filter(Boolean);
  if (items.length < LIMITS.included[0]) out.push(`List at least ${LIMITS.included[0]} things every visit includes.`);
  if (items.length > LIMITS.included[1]) out.push(`List at most ${LIMITS.included[1]} things every visit includes.`);
  if (items.some((x) => x.length > LIMITS.item[1])) out.push('Keep each included item under 200 characters.');
  s.faqs.forEach((f, i) => { if (!f.q.trim() || !f.a.trim()) out.push(`Question ${i + 1} needs both a question and an answer.`); });
  const prose: [string, string][] = [
    ['The name', s.name], ['The page heading', s.h1], ['The introduction', s.intro], ['"Who it is for"', s.who_its_for],
    ['The pricing note', s.pricing_note], ['The search title', s.meta_title], ['The search description', s.meta_description],
    ...items.map((x, i) => [`Included item ${i + 1}`, x] as [string, string]),
    ...s.faqs.flatMap((f, i) => [[`Question ${i + 1}`, f.q], [`Answer ${i + 1}`, f.a]] as [string, string][]),
  ];
  for (const [label, v] of prose) {
    if (PRICE_IN_PROSE.test(v)) out.push(`${label} types a price. Prices come from the rate card so they can never disagree with checkout; write "see the prices below" instead.`);
  }
  return out;
}
