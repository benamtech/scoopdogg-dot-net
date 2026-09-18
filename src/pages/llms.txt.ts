/**
 * llms.txt, generated from the catalog at build time. It replaces a hand-written file that
 * quoted prices by hand and said "Ventura County" only, so it drifted from the site the day
 * either changed. For agents (ChatGPT, Claude, Perplexity), not for Google: Google Search does
 * not use llms.txt (R6 §C1). Every question page is listed with its markdown twin.
 */
import type { APIRoute } from 'astro';
import {
  services, packagesForService, tiersFor, formatCents, formatTierPrice, headlineOffer, markets, regionSentence,
  business, trust, reviewSummary,
} from '../lib/catalog';
import { questions, TOPICS } from '../lib/questions';
import { ARTICLES } from '../lib/articles';
import { SITE_URL } from '../lib/constants';

const firstSentence = (s?: string | null) => (s ? s.split(/(?<=[.!?])\s/)[0] : '');

export const GET: APIRoute = () => {
  const L: string[] = [];
  L.push(`# ${business.name} — weekly dog poop pickup and yard care in ${regionSentence()}`, '');
  L.push(`> Locally owned pooper scooper and turf care company run by its owner, Josue. Monthly plans on the same day every week, booked and paid online, managed from a customer account.${headlineOffer ? ` ${headlineOffer.name} on weekly scooping.` : ''} No contract.`, '');
  L.push(`- Phone (call or text): ${business.phone}`, `- Email: ${business.email}`, `- See a price and book: ${SITE_URL}/book`, `- Customer account: ${SITE_URL}/account`);
  if (trust.insured) L.push(`- Insured${trust.backgroundChecked ? ', background-checked' : ''}`);
  if (reviewSummary.rating) L.push(`- ${reviewSummary.rating.toFixed(1)} on Google, ${reviewSummary.count} reviews: ${SITE_URL}/reviews`);
  if (trust.guarantee) L.push(`- ${trust.guarantee}`);
  L.push('');

  L.push('## Services and prices', '');
  for (const s of services) {
    const pk = packagesForService(s.slug);
    const tiers = tiersFor(s.slug);
    L.push(`### ${s.name}`, '');
    if (s.intro) L.push(firstSentence(s.intro));
    if (pk.length) L.push(`Monthly plans (weekly visits): ${pk.map((p) => `${p.short_label} ${formatCents(p.monthly_price_cents)}/month`).join('; ')}`);
    if (tiers.length) L.push(`${pk.length ? 'Per visit' : 'Prices'}: ${tiers.map((t) => `${t.label} ${formatTierPrice(t, 'custom quote')}`).join('; ')}`);
    L.push(`Details: ${SITE_URL}/services/${s.slug}`, '');
  }

  L.push('## Questions and answers', '', 'Each answer is built from the same price list and policies the booking uses. Markdown twins end in .md.', '');
  const qs = questions();
  for (const topic of TOPICS) {
    const items = qs.filter((q) => q.topic === topic);
    if (!items.length) continue;
    L.push(`### ${topic}`, '');
    for (const q of items) L.push(`- [${q.q}](${SITE_URL}/questions/${q.slug}.md): ${firstSentence(q.answer)}`);
    L.push('');
  }

  L.push('## Service areas', '');
  for (const m of markets()) {
    L.push(`${m.label.replace(/^the /, 'The ')}: ${m.areas.map((a) => `[${a.name}](${SITE_URL}/areas/${a.slug})`).join(', ')}`);
  }
  L.push('', '## Guides', '');
  for (const a of ARTICLES) L.push(`- [${a.title}](${SITE_URL}/resources/${a.slug}): ${firstSentence(a.excerpt)}`);
  L.push('');

  return new Response(L.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
