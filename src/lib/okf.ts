/**
 * THE BUSINESS AS AN OKF v0.2 BUNDLE, for agents, generated from the same rows the booking charges.
 * Spec: GoogleCloudPlatform/open-knowledge-format SPEC.md. Nothing here is typed knowledge: prices,
 * add-ons, policies and the guarantee come from the catalog, so the bundle cannot disagree with the
 * site. `generated` and `verified` say a machine read the rows. A person is named only where a person
 * stands behind the fact: the prices are Josue's, and a Google review count has the date it was read.
 *
 * Not a ranking lever: nobody documents a crawler that fetches OKF (research/2026-10-14-seo-geo-okf-chatgpt).
 * It is here so an agent can get the facts, their source and their age in one clean read.
 */
import {
  services, packagesForService, tiersFor, formatCents, formatTierPrice, markets, business, trust, reviewSummary,
  catalog, offers, serviceBySlug, setting,
} from './catalog';
import { graphOf, offeredWith, relate } from '../shared/service-graph';
import { weeklyCents } from '../shared/pricing';
import { SITE_URL } from './constants';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const yamlStr = (s: string) => JSON.stringify(clean(s));
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

type Front = { type: string; title: string; description: string; resource?: string; tags?: string[]; extra?: string[]; sources?: { id: string; resource: string; title: string; author?: string; last_modified?: string }[] };

function frontmatter(f: Front, at: number, staleDays = 30) {
  const L = ['---', `type: ${f.type}`, `title: ${yamlStr(f.title)}`, `description: ${yamlStr(f.description)}`];
  if (f.resource) L.push(`resource: ${f.resource}`);
  if (f.tags?.length) L.push(`tags: [${f.tags.map(yamlStr).join(', ')}]`);
  L.push('status: stable', `generated: { by: process:scoopdogg-site, at: ${iso(at)} }`, `verified: [{ by: process:scoopdogg-booking-rows, at: ${iso(at)} }]`, `stale_after: ${iso(at + staleDays * DAY)}`);
  if (f.sources?.length) {
    L.push('sources:');
    for (const s of f.sources) {
      L.push(`  - id: ${s.id}`, `    resource: ${s.resource}`, `    title: ${yamlStr(s.title)}`);
      if (s.author) L.push(`    author: ${s.author}`);
      if (s.last_modified) L.push(`    last_modified: ${s.last_modified}`);
    }
  }
  if (f.extra) L.push(...f.extra);
  L.push('---', '');
  return L.join('\n');
}

const PRICES = { id: 'prices', resource: `${SITE_URL}/pricing`, title: 'Scoop Dogg price list, the rows the booking charges', author: 'human:josue' };

/** Every price a service sells at, as table rows, from the rows. */
function priceRows(slug: string) {
  const plans = packagesForService(slug);
  const addOn = serviceBySlug(slug)?.kind === 'addon';
  if (plans.length && !addOn) {
    return plans.map((p) => { const wk = weeklyCents(p); return [p.short_label ?? p.name, wk ? `${formatCents(wk)} a week` : '', `${formatCents(p.monthly_price_cents)} a month`]; });
  }
  return tiersFor(slug).map((t) => [t.label, t.requires_quote || !t.price_cents ? 'custom quote' : formatTierPrice(t), 'one visit']);
}

/** The body of a service: what a customer gets, what it costs, what goes with it. Shared with the page's markdown twin. */
export function serviceMarkdown(slug: string, rel = (s: string) => `${SITE_URL}/services/${s}`) {
  const s = serviceBySlug(slug);
  if (!s) return null;
  const g = graphOf(catalog);
  const name = (x: string) => serviceBySlug(x)?.name ?? x;
  const L = [`# ${s.name}`, '', clean(s.intro ?? s.meta_description ?? ''), ''];
  if (s.what_includes?.length) L.push('## What is included', '', ...s.what_includes.map((i: string) => `- ${i}`), '');
  const rows = priceRows(slug);
  if (rows.length) L.push('## Price', '', ...(s.pricing_note ? [clean(s.pricing_note), ''] : []), '| Option | Price | Billing |', '| --- | --- | --- |', ...rows.map((r) => `| ${r.join(' | ')} |`), '');
  const add = offeredWith(g, slug, 'add_on'), keep = offeredWith(g, slug, 'follow_on');
  const already = services.filter((o) => o.slug !== slug && relate(g, slug, o.slug).relation === 'included');
  if (add.length) L.push('## Add to the same visit', '', ...add.map((r) => `- [${name(r.other_slug)}](${rel(r.other_slug)}): ${r.customer_line}`), '');
  if (keep.length) L.push('## Keep the result going', '', ...keep.map((r) => `- [${name(r.other_slug)}](${rel(r.other_slug)}): ${r.customer_line}`), '');
  if (already.length) L.push('## Already included', '', ...already.map((o) => `- ${o.name}: not sold on top of this job, because it already does that work.`), '');
  if (s.faqs?.length) L.push('## Questions', '', ...s.faqs.flatMap((f: { q: string; a: string }) => [`### ${f.q}`, '', f.a, '']));
  L.push(`Book or see a price: ${SITE_URL}/book?service=${slug} · Call or text ${business.phone}`, '', `Source: ${SITE_URL}/services/${slug}`, '');
  return L.join('\n');
}

export function okfService(slug: string, at: number) {
  const s = serviceBySlug(slug);
  const body = serviceMarkdown(slug, (x) => `${x}.md`);
  if (!s || !body) return null;
  const f = frontmatter({
    type: 'Service', title: s.name, description: s.meta_description ?? s.intro ?? s.name, resource: `${SITE_URL}/services/${slug}`,
    tags: [s.kind === 'addon' ? 'add-on' : s.kind === 'recurring' ? 'weekly plan' : 'one-time job'],
    sources: [PRICES, { id: 'page', resource: `${SITE_URL}/services/${slug}`, title: `${s.name} page` }],
  }, at);
  return `${f}${body}\nPrices for a real address and day come from [Price a booking](../computations/price-a-booking.md).\n`;
}

export function okfBusiness(at: number) {
  const checked = reviewSummary.checkedOn;
  const f = frontmatter({
    type: 'Local Business', title: business.name, description: `Dog poop pickup, turf care and yard care in ${markets().map((m) => m.label.replace(/^the /, '')).join(', ')}, run by its owner, Josue.`, resource: SITE_URL,
    sources: [{ id: 'reviews', resource: reviewSummary.profileUrl, title: 'Google Business Profile', ...(checked ? { last_modified: `${checked}T12:00:00-08:00` } : {}) }],
  }, at, 90);
  const L = [`# ${business.name}`, '', `- Phone, call or text: ${business.phone}`, `- Email: ${business.email}`, `- Website: ${SITE_URL}`, `- Book online: ${SITE_URL}/book`];
  if (trust.insured) L.push(`- Insured${trust.backgroundChecked ? ' and background-checked' : ''}`);
  if (reviewSummary.rating) L.push(`- ${reviewSummary.rating.toFixed(1)} on Google, ${reviewSummary.label}[^reviews]`);
  if (trust.guarantee) L.push(`- ${trust.guarantee}`);
  L.push('', '[^reviews]: Read from the Google Business Profile' + (checked ? ` on ${checked}.` : '.'), '');
  return f + L.join('\n');
}

export function okfPolicies(at: number) {
  const f = frontmatter({
    type: 'Policy', title: 'How billing, pausing and cancelling work', description: 'How a Scoop Dogg weekly plan is billed, what the first month costs, and how to pause or cancel.',
    resource: `${SITE_URL}/pricing`, sources: [PRICES],
  }, at);
  const live = offers.filter((o) => o.status === 'active');
  const L = ['# How billing, pausing and cancelling work', '', '- A weekly plan is billed once a month. A month is four weekly visits, and a month with a fifth visit costs the same.', '- No sign-up fees and no contract.'];
  for (const o of live) L.push(`- ${o.name}: ${o.value}% off the first month of ${o.applies_to_slugs.map((x: string) => serviceBySlug(x)?.name ?? x).join(', ')}${o.requires_slugs?.length ? ', when booked with weekly scooping' : ''}.`);
  L.push(`- Pause from your account for up to ${setting<number>('subscription.pause_max_weeks', 12)} weeks. You are not charged while paused.`, '- Cancel anytime from your account. The plan ends at the end of the paid month.', '- A one-time job is paid in full when you book it. To change one, call or text.');
  if (trust.guarantee) L.push(`- ${trust.guarantee}`);
  L.push('');
  return f + L.join('\n');
}

export function okfAreas(at: number) {
  const f = frontmatter({ type: 'Service Area', title: 'Where Scoop Dogg works', description: 'Every city with a route, by region.', resource: `${SITE_URL}/areas`, sources: [{ id: 'areas', resource: `${SITE_URL}/areas`, title: 'Service areas' }] }, at);
  const L = ['# Where Scoop Dogg works', ''];
  for (const m of markets()) L.push(`## ${m.label.replace(/^the /, 'The ')}`, '', ...m.areas.map((a) => `- [${a.name}](${SITE_URL}/areas/${a.slug})`), '');
  return f + L.join('\n');
}

/** What goes with what, with the reason in plain words. The same relations the booking enforces. */
export function okfRelations(at: number) {
  const g = graphOf(catalog);
  const name = (x: string) => serviceBySlug(x)?.name ?? x;
  const f = frontmatter({
    type: 'Service Relations', title: 'What goes with what', description: 'Which Scoop Dogg services go on one visit, which keep a result going, and which are already included in another.',
    resource: `${SITE_URL}/services`, tags: ['add-ons'], sources: [{ id: 'graph', resource: `${SITE_URL}/services`, title: 'The relations the booking enforces' }],
  }, at);
  const L = ['# What goes with what', '', 'Each line is checked by the booking: a request that combines services another way is refused.', ''];
  for (const s of services) {
    const add = offeredWith(g, s.slug, 'add_on'), keep = offeredWith(g, s.slug, 'follow_on');
    const included = services.filter((o) => o.slug !== s.slug && relate(g, s.slug, o.slug).relation === 'included');
    if (!add.length && !keep.length && !included.length) continue;
    L.push(`## ${s.name}`, '');
    if (add.length) L.push(`Same visit: ${add.map((r) => `[${name(r.other_slug)}](services/${r.other_slug}.md)`).join(', ')}.`, '');
    if (keep.length) L.push(`Afterwards: ${keep.map((r) => `[${name(r.other_slug)}](services/${r.other_slug}.md)`).join(', ')}.`, '');
    if (included.length) L.push(`Already included, never sold on top: ${included.map((o) => o.name).join(', ')}.`, '');
  }
  if (g.bundles?.length) {
    L.push('## Visits people ask for', '');
    for (const b of g.bundles) L.push(`- ${b.name}: ${name(b.base_slug)}, ${b.members.map(name).join(', ')}. ${b.customer_line}`);
    L.push('');
  }
  return f + L.join('\n');
}

export const ATTESTER_PATH = '/okf/references/attest-price.mjs';

export function okfPriceComputation(at: number) {
  const f = frontmatter({
    type: 'Attested Computation', title: 'Price a booking', description: 'The first charge and monthly price for a chosen plan or job in a served city, computed by the booking itself.',
    resource: `${SITE_URL}/book`, sources: [PRICES],
    extra: [
      'runtime: https-json',
      'parameters:',
      '  - { name: city, type: string, required: true }',
      '  - { name: package_id, type: string, required: false }',
      '  - { name: tier_id, type: string, required: false }',
      '  - { name: extra_tier_ids, type: "array<string>", required: false }',
      '  - { name: with_package_ids, type: "array<string>", required: false }',
      'executor:',
      `  resource: ${SITE_URL}/api/booking/price`,
      '  receipt: [request, first_charge_cents]',
      'attester:',
      `  resource: ${SITE_URL}${ATTESTER_PATH}`,
    ],
  }, at, 7);
  return `${f}# Computation

Send the parameters as a JSON POST to the executor, with exactly one of \`package_id\` or \`tier_id\`. Ids and city slugs are in [the machine-readable catalog](../catalog.json). The answer holds \`first_charge_cents\`, \`monthly_cents\`, \`discount_cents\` and the open start days.

Do not add prices up by hand: first-month offers, add-ons and refused combinations are applied here, and this is the number the checkout charges.

To check a quoted price, run the attester with \`node attest-price.mjs '{"request": {...}, "first_charge_cents": 4000}'\`. It repeats the request and exits 0 only if the amount still matches.
`;
}

export const ATTESTER_SOURCE = `#!/usr/bin/env node
// Attester for "Price a booking" (OKF v0.2 section 10). No model: it repeats the priced request and compares cents.
const receipt = JSON.parse(process.argv[2] ?? '{}');
const res = await fetch('${SITE_URL}/api/booking/price', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(receipt.request ?? {}) });
const body = await res.json();
const ok = res.ok && body.first_charge_cents === receipt.first_charge_cents;
console.log(JSON.stringify({ verdict: ok ? 'attested' : 'refused', first_charge_cents: body.first_charge_cents ?? null, quoted: receipt.first_charge_cents ?? null }));
process.exit(ok ? 0 : 1);
`;

/** The ids an agent needs to call the computation. Prices are included so a reader never needs a second source. */
export function okfCatalogJson() {
  return {
    services: services.map((s) => ({
      slug: s.slug, name: s.name, kind: s.kind, url: `${SITE_URL}/services/${s.slug}`,
      plans: s.kind === 'addon' ? [] : packagesForService(s.slug).map((p) => ({ package_id: p.id, name: p.name, monthly_cents: p.monthly_price_cents })),
      options: tiersFor(s.slug).map((t) => ({ tier_id: t.id, label: t.label, cents: t.requires_quote ? null : t.price_cents })),
    })),
    cities: markets().flatMap((m) => m.areas.map((a) => ({ slug: a.slug, name: a.name }))),
  };
}

export function okfRootIndex() {
  const L = ['---', 'okf_version: "0.2"', '---', '', '# Scoop Dogg', '',
    '* [Scoop Dogg](business.md) - who they are, how to reach them, the guarantee and the reviews',
    '* [How billing, pausing and cancelling work](policies.md) - billing, first-month offers, pausing, cancelling',
    '* [Where Scoop Dogg works](areas.md) - every city with a route',
    '* [What goes with what](relations.md) - which services go on one visit, and which are already included',
    '', '# Services', ''];
  for (const s of services) L.push(`* [${s.name}](services/${s.slug}.md) - ${clean(s.meta_description ?? s.intro ?? '')}`);
  L.push('', '# Computations', '', '* [Price a booking](computations/price-a-booking.md) - the first charge the checkout will take, from the booking itself', '');
  return L.join('\n');
}
