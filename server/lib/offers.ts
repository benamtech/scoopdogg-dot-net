/**
 * offers.ts — the owner edits his offers himself: add, change, pause, bring back. Never delete.
 *
 * An offer here is a FIRST-MONTH percentage off a monthly package (`kind = 'percent_off'`), because
 * that is the only shape the checkout honours: couponForOffer() (server/lib/stripe.ts) mints a
 * Stripe coupon with `duration: 'once'`. `promo_months` has no reader, and a promotion longer than a
 * month owes the customer a notice before the regular price begins (Bus. & Prof. Code
 * §17602(b)(1)) that is not built — so the editor does not offer one.
 *
 * WHAT A SAVE CHECKS, because the pages print an offer's NAME ("First month half off") next to the
 * checkout that applies its VALUE:
 *   - the value is a whole percentage from 1 to 100;
 *   - a name that states a discount ("half", "50%", "a quarter") states THIS one, or the header
 *     would promise one number while the checkout charged another;
 *   - it applies to at least one live service, and never requires a service it also applies to;
 *   - two active offers cannot claim the same service with the same condition — pricing.ts takes
 *     the best one per line, and a second, smaller one would be a promise nobody could receive.
 *
 * REDEMPTIONS ARE COUNTED, NOT STORED. `offers.redeemed_count` and `offer_redemptions` (migration
 * 003) never had a writer or a reader. The record that exists is the booking's own:
 * `subscriptions.discount->>'offer_id'`, written by server/lib/booking.ts when the offer is applied.
 * Every number here is read from it.
 *
 * An edit is live on the pages at the next render (api/admin.ts purges on every write) and at the
 * checkout on the next booking: the coupon is keyed on the value and the products, so a changed
 * offer mints a new coupon instead of reusing the old discount.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class OfferError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'offer_error') { super(message); this.status = status; this.code = code; }
}

export type OfferPatch = {
  name?: string;
  description?: string;
  value?: number;
  applies_to_slugs?: string[];
  requires_slugs?: string[];
  status?: 'active' | 'paused';
};

/** The discount a name states, if it states one. `null` when the name names no number. */
export function statedPercent(name: string): number | null {
  const n = name.toLowerCase();
  const pct = /(\d{1,3})\s*(%|percent)/.exec(n);
  if (pct) return Number(pct[1]);
  if (/\bhalf\b/.test(n)) return 50;
  if (/\b(a |one )?quarter\b/.test(n)) return 25;
  if (/\bthird\b/.test(n)) return 33;
  if (/\bfree\b/.test(n)) return 100;
  return null;
}

export async function listOffers(q: Queryable = db()) {
  const { rows } = await q.query(
    `select o.id, o.name, o.description, o.kind, o.value, o.applies_to_slugs, o.requires_slugs, o.status, o.created_at, o.updated_at,
            (select count(*)::int from subscriptions s where s.discount->>'offer_id' = o.id::text) as redeemed,
            (select count(*)::int from subscriptions s where s.discount->>'offer_id' = o.id::text and s.state in ('active', 'paused')) as customers_on_it
       from offers o
      where o.status in ('active', 'paused', 'draft')
      order by case o.status when 'active' then 0 when 'paused' then 1 else 2 end, o.name`);
  // The services an offer can take money off: the ones sold as a monthly plan. The "only when they
  // also book" list may name any live service.
  const { rows: services } = await q.query(
    `select s.slug, s.name, exists(select 1 from packages p where p.service_slug = s.slug and p.status = 'active') as monthly
       from services s where s.status = 'active' order by s.sort_order`);
  return { offers: rows, services };
}

async function validate(q: Queryable, next: Required<Omit<OfferPatch, 'description'>> & { id: string | null }) {
  const name = next.name.trim();
  if (name.length < 4 || name.length > 80) throw new OfferError('Give the offer a name between 4 and 80 characters. It is what the site shows.', 400, 'bad_name');
  if (!Number.isInteger(next.value) || next.value < 1 || next.value > 100) throw new OfferError('The discount is a whole percentage from 1 to 100.', 400, 'bad_value');
  const stated = statedPercent(name);
  if (stated !== null && stated !== next.value) {
    throw new OfferError(`The name says ${stated}% off and the discount is ${next.value}%. The site shows the name and the checkout charges the discount, so they have to agree.`, 400, 'name_disagrees');
  }
  const { rows } = await q.query(`select slug from services where status = 'active'`);
  const live = new Set(rows.map((r: any) => r.slug));
  // Only a MONTHLY PLAN can receive an offer: the discount is a coupon on the first invoice of a
  // subscription (booking.ts). An offer on a one-time job would be advertised and never applied.
  const { rows: plans } = await q.query(`select distinct service_slug from packages where status = 'active'`);
  const monthly = new Set(plans.map((r: any) => r.service_slug));
  const applies = [...new Set(next.applies_to_slugs)], requires = [...new Set(next.requires_slugs)];
  if (!applies.length) throw new OfferError('Choose at least one service the offer takes money off.', 400, 'no_services');
  const unknown = [...applies, ...requires].filter((s) => !live.has(s));
  if (unknown.length) throw new OfferError(`These are not live services: ${unknown.join(', ')}.`, 400, 'unknown_service');
  const noPlan = applies.filter((s) => !monthly.has(s));
  if (noPlan.length) throw new OfferError(`An offer takes money off a monthly plan's first month, and ${noPlan.join(', ')} has no monthly plan.`, 400, 'not_monthly');
  if (applies.some((s) => requires.includes(s))) throw new OfferError('An offer cannot require the same service it takes money off.', 400, 'requires_itself');
  if (next.status === 'active') {
    const { rows: clash } = await q.query(
      `select name from offers where status = 'active' and ($1::uuid is null or id <> $1)
          and applies_to_slugs && $2::text[] and requires_slugs @> $3::text[] and $3::text[] @> requires_slugs`,
      [next.id, applies, requires]);
    if (clash.length) throw new OfferError(`"${clash[0].name}" is already active on the same service with the same condition. Pause one of them first: a customer only ever gets one.`, 409, 'overlaps');
  }
  return { name, applies, requires };
}

export async function saveOffer(q: Queryable, id: string, patch: OfferPatch, by: string) {
  const { rows: [cur] } = await q.query(`select * from offers where id = $1`, [id]);
  if (!cur) throw new OfferError('No such offer.', 404, 'not_found');
  if (cur.kind !== 'percent_off') throw new OfferError('Only first-month percentage offers can be edited here.', 409, 'not_editable');
  const next = {
    id,
    name: patch.name ?? cur.name,
    value: patch.value ?? cur.value,
    applies_to_slugs: patch.applies_to_slugs ?? cur.applies_to_slugs,
    requires_slugs: patch.requires_slugs ?? cur.requires_slugs,
    status: patch.status ?? (cur.status === 'active' ? 'active' : 'paused'),
  } as const;
  const v = await validate(q, next);
  const { rows: [row] } = await q.query(
    `update offers set name = $2, description = $3, value = $4, applies_to_slugs = $5, requires_slugs = $6, status = $7, updated_at = now()
      where id = $1 returning *`,
    [id, v.name, (patch.description ?? cur.description ?? '').slice(0, 400), next.value, v.applies, v.requires, next.status]);
  await appendEvent(q as never, { subjectKind: 'offer', subjectId: id, type: 'offer.saved', from: cur.status, to: row.status, actorKind: 'owner',
    payload: { by, was: { name: cur.name, value: cur.value, applies: cur.applies_to_slugs, requires: cur.requires_slugs } } });
  return row;
}

export async function addOffer(q: Queryable, input: OfferPatch, by: string) {
  const next = {
    id: null,
    name: input.name ?? '',
    value: Number(input.value),
    applies_to_slugs: input.applies_to_slugs ?? [],
    requires_slugs: input.requires_slugs ?? [],
    status: input.status === 'active' ? 'active' : 'paused',
  } as const;
  const v = await validate(q, next);
  const { rows: [row] } = await q.query(
    `insert into offers (name, description, kind, value, applies_to_slugs, requires_slugs, status)
     values ($1, $2, 'percent_off', $3, $4, $5, $6) returning *`,
    [v.name, (input.description ?? '').slice(0, 400), next.value, v.applies, v.requires, next.status]);
  await appendEvent(q as never, { subjectKind: 'offer', subjectId: row.id, type: 'offer.added', to: row.status, actorKind: 'owner', payload: { by } });
  return row;
}
