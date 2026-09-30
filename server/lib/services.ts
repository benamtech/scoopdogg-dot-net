/**
 * services.ts — the owner edits his services himself: the words on each page, the order, what is
 * related, and whether it is offered at all. Retire, never delete (migration 003's own rule: old
 * subscriptions, invoices and URLs still point at a slug).
 *
 * THE LIFECYCLE
 *   draft   -> being written; not on the site, not bookable. A new service starts here.
 *   active  -> on the site and bookable. Reaching it needs the words to pass the page rules
 *              (src/shared/service-rules.ts) AND at least one live price on the rate card, because
 *              gates/all-services-bookable.mjs holds that every service on the site can be booked.
 *   retired -> off the site. Its URL answers a permanent redirect to /services, never a 404
 *              (src/pages/services/[service].astro), so a link somebody saved keeps working.
 *
 * `kind` and `price_basis` are set when a service is added and not edited after: every tier on the
 * rate card is measured in that basis, so changing it would reprice every tier silently.
 *
 * An edit is on the page at the next render: api/admin.ts purges the page cache on every write.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { serviceProblems, type ServiceProse } from '../../src/shared/service-rules.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class ServiceError extends Error {
  status: number;
  code: string;
  problems: string[];
  constructor(message: string, status = 400, code = 'service_error', problems: string[] = []) {
    super(message); this.status = status; this.code = code; this.problems = problems;
  }
}

export type ServicePatch = Partial<ServiceProse> & { related_slugs?: string[]; sort_order?: number; status?: 'draft' | 'active' | 'retired' };

const COLUMNS = `slug, name, short_name, kind, price_basis, basis_label, pricing_note, sort_order, status, meta_title, meta_description,
                 h1, intro, what_includes, who_its_for, faqs, related_slugs, updated_at, updated_by`;

export async function listServices(q: Queryable = db()) {
  const { rows } = await q.query(
    `select ${COLUMNS},
            (select count(*)::int from service_tiers t where t.service_slug = s.slug and t.status = 'active'
               and (t.price_cents is not null or t.requires_quote)) as live_tiers,
            (select count(*)::int from subscriptions x where x.service_slug = s.slug and x.state in ('active', 'paused')) as customers
       from services s
      order by case s.status when 'active' then 0 when 'draft' then 1 else 2 end, s.sort_order, s.name`);
  return { services: rows };
}

const prose = (r: any): ServiceProse => ({
  name: r.name ?? '', short_name: r.short_name ?? '', h1: r.h1 ?? '', intro: r.intro ?? '',
  what_includes: r.what_includes ?? [], who_its_for: r.who_its_for ?? '', faqs: r.faqs ?? [],
  pricing_note: r.pricing_note ?? '', meta_title: r.meta_title ?? '', meta_description: r.meta_description ?? '',
});

/** The rules a service must meet to be on the site. Returns sentences; empty means it may go live. */
async function goLiveProblems(q: Queryable, row: any): Promise<string[]> {
  const out = serviceProblems(prose(row));
  const { rows: [t] } = await q.query(
    `select count(*)::int as n from service_tiers where service_slug = $1 and status = 'active' and (price_cents is not null or requires_quote)`, [row.slug]);
  if (!t.n) out.push('Add at least one price for it on the rate card first: a service on the site has to be bookable.');
  const { rows: same } = await q.query(
    `select name from services where status = 'active' and slug <> $1 and (lower(meta_title) = lower($2) or lower(h1) = lower($3))`,
    [row.slug, row.meta_title ?? '', row.h1 ?? '']);
  if (same.length) out.push(`"${same[0].name}" already uses that search title or page heading. Each page needs its own.`);
  return out;
}

export async function saveService(q: Queryable, slug: string, patch: ServicePatch, by: string) {
  const { rows: [cur] } = await q.query(`select * from services where slug = $1`, [slug]);
  if (!cur) throw new ServiceError('No such service.', 404, 'not_found');
  const next: any = { ...cur };
  for (const k of ['name', 'short_name', 'h1', 'intro', 'who_its_for', 'pricing_note', 'meta_title', 'meta_description'] as const) {
    if (patch[k] !== undefined) next[k] = String(patch[k]).trim();
  }
  if (patch.what_includes) next.what_includes = patch.what_includes.map((x) => String(x).trim()).filter(Boolean);
  if (patch.faqs) next.faqs = patch.faqs.map((f) => ({ q: String(f.q ?? '').trim(), a: String(f.a ?? '').trim() })).filter((f) => f.q || f.a);
  if (patch.sort_order !== undefined) {
    if (!Number.isInteger(patch.sort_order)) throw new ServiceError('The order is a whole number.', 400, 'bad_order');
    next.sort_order = patch.sort_order;
  }
  if (patch.related_slugs) {
    const { rows } = await q.query(`select slug from services where status = 'active' and slug = any($1::text[]) and slug <> $2`, [patch.related_slugs, slug]);
    const ok = new Set(rows.map((r: any) => r.slug));
    const bad = patch.related_slugs.filter((x) => !ok.has(x));
    if (bad.length) throw new ServiceError(`These cannot be related: ${bad.join(', ')} (not a live service, or the service itself).`, 400, 'bad_related');
    next.related_slugs = [...new Set(patch.related_slugs)];
  }
  if (patch.status) next.status = patch.status;

  // A service on the site, or going onto it, meets every rule. A draft may be saved half-written.
  if (next.status === 'active') {
    const problems = await goLiveProblems(q, next);
    if (problems.length) throw new ServiceError(problems[0], 400, 'page_rules', problems);
  }
  if (cur.status === 'active' && next.status !== 'active') {
    const { rows: [n] } = await q.query(`select count(*)::int as n from services where status = 'active' and slug <> $1`, [slug]);
    if (!n.n) throw new ServiceError('This is the last service on the site. Add or bring back another before taking this one off.', 409, 'last_service');
  }

  const { rows: [row] } = await q.query(
    `update services set name = $2, short_name = $3, h1 = $4, intro = $5, what_includes = $6, who_its_for = $7, faqs = $8::jsonb,
                         pricing_note = $9, meta_title = $10, meta_description = $11, related_slugs = $12, sort_order = $13,
                         status = $14, updated_at = now(), updated_by = $15
      where slug = $1 returning ${COLUMNS}`,
    [slug, next.name, next.short_name, next.h1, next.intro, next.what_includes, next.who_its_for, JSON.stringify(next.faqs ?? []),
     next.pricing_note, next.meta_title, next.meta_description, next.related_slugs ?? [], next.sort_order, next.status, by]);
  if (cur.status !== row.status) {
    // A retired service drops out of every other service's "often paired with" list.
    if (row.status === 'retired') await q.query(`update services set related_slugs = array_remove(related_slugs, $1) where $1 = any(related_slugs)`, [slug]);
  }
  await appendEvent(q as never, {
    subjectKind: 'service', subjectId: await subjectId(q, slug), type: 'service.saved', from: cur.status, to: row.status, actorKind: 'owner',
    payload: { by, slug, changed: Object.keys(patch) },
  });
  return row;
}

const SLUG = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function addService(q: Queryable, input: { name: string; kind: string; price_basis: string; basis_label?: string }, by: string) {
  const name = String(input.name ?? '').trim();
  if (name.length < 3 || name.length > 60) throw new ServiceError('Give the service a name between 3 and 60 characters.', 400, 'bad_name');
  if (!['recurring', 'one_time'].includes(input.kind)) throw new ServiceError('Say whether it is a recurring plan or a one-time job.', 400, 'bad_kind');
  if (!['dogs', 'sqft', 'boxes', 'units', 'levels', 'choice', 'flat'].includes(input.price_basis)) throw new ServiceError('Say what the price is measured in.', 400, 'bad_basis');
  const slug = SLUG(name);
  if (!slug) throw new ServiceError('That name does not make an address for the page.', 400, 'bad_name');
  const { rows: [clash] } = await q.query(`select status from services where slug = $1`, [slug]);
  if (clash) throw new ServiceError(clash.status === 'retired'
    ? 'A retired service already has that name. Bring it back from the retired list instead.'
    : 'A service with that name already exists.', 409, 'exists');
  // The URL must not be one the predecessor site used for something else, or a redirect elsewhere.
  const { rows: [order] } = await q.query(`select coalesce(max(sort_order), 0) + 10 as n from services`);
  const { rows: [row] } = await q.query(
    `insert into services (slug, name, short_name, kind, price_basis, basis_label, status, sort_order, h1, meta_title, updated_by)
     values ($1, $2, $2, $3, $4, $5, 'draft', $6, $2, $2 || ' | Scoop Dogg', $7) returning ${COLUMNS}`,
    [slug, name, input.kind, input.price_basis, String(input.basis_label ?? '').slice(0, 80), order.n, by]);
  await appendEvent(q as never, { subjectKind: 'service', subjectId: await subjectId(q, slug), type: 'service.added', to: 'draft', actorKind: 'owner', payload: { by, slug } });
  return row;
}

/** events.subject_id is a uuid and a service's key is its slug, so the id is derived from the slug. */
async function subjectId(q: Queryable, slug: string): Promise<string> {
  const { rows: [r] } = await q.query(`select md5('service:' || $1)::uuid as id`, [slug]);
  return r.id;
}
