/**
 * HOW THE WORK RELATES. Pure, like pricing.ts, and read by the booking flow, the server, the gates and
 * the agents, so they cannot disagree. It holds no price.
 *
 * Nobody types "these two do not go together". A service is what gets done, where on the property and
 * how thoroughly, and the relation between two services is worked out from that, with direction:
 *
 *   Turf Deep Clean  -> Yard Sanitizing   included   it already sanitizes the turf; never offered
 *   Turf Deodorizing -> Turf Deep Clean   upgrade    it would replace the visit, so it is not an add-on
 *   Turf Deep Clean  -> Turf Deodorizing  follow_on  the weekly visit that keeps the result
 *   Turf Deep Clean  -> Dog Run Cleanup   add_on     another part of the same property
 *
 * The question is always "is this the same work in the same place". `service_relations` is what a
 * person approved to show, with the sentence the customer reads; `graphProblems` refuses a row the
 * calculation contradicts, so a contradiction is caught by a machine and not noticed by luck.
 */
export type Depth = 'light' | 'spot' | 'full';
export type Work = { service_slug: string; zone_slug: string; task_slug: string; depth: Depth };
export type Zone = { slug: string; name: string; indoors: boolean };
export type Task = { slug: string; name: string; stage: number };
export type Approved = { base_slug: string; other_slug: string; kind: 'add_on' | 'follow_on'; customer_line: string };
export type GraphService = { slug: string; name: string; kind: string };
/** A set of services for a real moment. No price of its own: the customer picks sizes and pays the sum. */
export type Bundle = { slug: string; name: string; customer_line: string; base_slug: string; members: string[] };
export type Graph = { services: GraphService[]; packages: { service_slug: string }[]; zones: Zone[]; tasks: Task[]; work: Work[]; relations: Approved[]; bundles?: Bundle[] };

export type Relation = 'add_on' | 'follow_on' | 'included' | 'upgrade' | 'household' | 'not_a_base' | 'none';
const RANK: Record<Depth, number> = { light: 1, spot: 2, full: 3 };

const workOf = (g: Graph, slug: string) => g.work.filter((w) => w.service_slug === slug);
const zonesOf = (w: Work[]) => [...new Set(w.map((x) => x.zone_slug))];
const recurring = (g: Graph, slug: string) => g.packages.some((p) => p.service_slug === slug);
const isIndoors = (g: Graph, w: Work[]) => w.length > 0 && w.every((x) => g.zones.find((z) => z.slug === x.zone_slug)?.indoors);

/** Every piece of `inner` is done by `outer`, in the same zone, at least as thoroughly. */
const covers = (outer: Work[], inner: Work[], anyDepth = false) => inner.length > 0 && inner.every((i) =>
  outer.some((o) => o.zone_slug === i.zone_slug && o.task_slug === i.task_slug && (anyDepth || RANK[o.depth] >= RANK[i.depth])));

/** What `other` is to someone already buying `base`. Direction matters. */
export function relate(g: Graph, base: string, other: string): { relation: Relation; why: string } {
  if (base === other) return { relation: 'none', why: 'the same service' };
  const svc = (s: string) => g.services.find((x) => x.slug === s);
  const a = workOf(g, base), b = workOf(g, other);
  if (!svc(base) || !svc(other) || !a.length || !b.length) return { relation: 'none', why: 'no work recorded' };
  if (svc(base)!.kind === 'addon') return { relation: 'not_a_base', why: `${svc(base)!.name} is sold with something else` };
  if (isIndoors(g, a) !== isIndoors(g, b)) return { relation: 'household', why: 'indoors and outdoors: a different kind of visit' };

  // An add-on applies to the areas the job is already working on.
  if (svc(other)!.kind === 'addon') {
    const shared = zonesOf(a).filter((z) => zonesOf(b).includes(z));
    if (!shared.length) return { relation: 'none', why: 'it works on different parts of the property' };
    const here = b.filter((w) => shared.includes(w.zone_slug));
    // At any depth: a job that already sanitizes the dog areas does not sell sanitizing on top.
    return covers(a, here, true) ? { relation: 'included', why: `${svc(base)!.name} already does this` }
                           : { relation: 'add_on', why: 'more work in the same place, on the same visit' };
  }
  // Cadence first: a weekly visit after a one-time job is not the same work, it is the work kept up.
  if (!recurring(g, base) && recurring(g, other)) return { relation: 'follow_on', why: 'a one-time job, then a weekly visit that keeps it up' };
  if (covers(a, b)) return { relation: 'included', why: `${svc(base)!.name} already does all of this` };
  if (covers(b, a)) return { relation: 'upgrade', why: `${svc(other)!.name} includes all of ${svc(base)!.name}: it would replace it, not add to it` };
  return { relation: 'add_on', why: zonesOf(a).some((z) => zonesOf(b).includes(z)) ? 'different work on one visit' : 'another part of the same property, on one visit' };
}

/** What a customer buying `base` is offered, as approved, in the order they were written down. */
export function offeredWith(g: Graph, base: string, kind: 'add_on' | 'follow_on') {
  return g.relations.filter((r) => r.base_slug === base && r.kind === kind && relate(g, base, r.other_slug).relation === kind);
}

/** The visit's work in the order it must happen: solids first, sanitizer late, rinse last. */
export function visitPlan(g: Graph, slugs: string[]) {
  const seen = new Set<string>();
  return slugs.flatMap((s) => workOf(g, s))
    .filter((w) => { const k = `${w.zone_slug}|${w.task_slug}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((w) => ({ ...w, stage: g.tasks.find((t) => t.slug === w.task_slug)?.stage ?? 99 }))
    .sort((x, y) => x.stage - y.stage);
}

/** The graph inside a catalog snapshot. */
export const graphOf = (c: { services: GraphService[]; packages: { service_slug: string }[]; zones?: Zone[]; work_tasks?: Task[]; work?: Work[]; relations?: Approved[]; bundles?: Bundle[] }): Graph =>
  ({ services: c.services, packages: c.packages, zones: c.zones ?? [], tasks: c.work_tasks ?? [], work: c.work ?? [], relations: c.relations ?? [], bundles: c.bundles ?? [] });

/**
 * THE SERVER'S CHECK. Whatever the screen shows, a booking can only combine what goes together: a
 * request cannot buy a sanitizing treatment on a deep clean that already includes one. `base` is what
 * is being bought; anything else must be offered with it or with another job in the same booking, or
 * be a weekly plan following one of those jobs. Returns the first thing that does not belong.
 */
export function refusedTogether(g: Graph, base: string, extras: string[], plans: string[]): string | null {
  const present = [base, ...extras, ...plans];
  const fits = (s: string) => present.some((p) => p !== s && offeredWith(g, p, 'add_on').some((r) => r.other_slug === s))
    || present.some((p) => p !== s && offeredWith(g, s, 'follow_on').some((r) => r.other_slug === p))
    || present.some((p) => p !== s && offeredWith(g, p, 'follow_on').some((r) => r.other_slug === s));
  // Same-visit extras must not repeat each other either: a job that includes a treatment makes buying
  // that treatment again a double charge, whichever of them was added first.
  const repeated = extras.find((s) => [base, ...extras].some((p) => p !== s && relate(g, p, s).relation === 'included'));
  return repeated ?? [...extras, ...plans].find((s) => !fits(s)) ?? null;
}

/** Every contradiction in the catalog, as a sentence. Empty means clean. */
export function graphProblems(g: Graph): string[] {
  const out: string[] = [];
  const name = (s: string) => g.services.find((x) => x.slug === s)?.name ?? s;
  for (const s of g.services) if (!workOf(g, s.slug).length) out.push(`${s.name} has no work recorded, so nothing can be said about what goes with it.`);
  const seen = new Set<string>();
  for (const r of g.relations) {
    if (!g.services.some((s) => s.slug === r.base_slug) || !g.services.some((s) => s.slug === r.other_slug)) {
      out.push(`${r.base_slug} and ${r.other_slug}: a relation names a service that is not on sale.`); continue;
    }
    const got = relate(g, r.base_slug, r.other_slug);
    if (got.relation !== r.kind) out.push(`${name(r.other_slug)} is approved as ${r.kind} on ${name(r.base_slug)}, but it is ${got.relation}: ${got.why}.`);
    if (!r.customer_line.trim()) out.push(`${name(r.other_slug)} on ${name(r.base_slug)} has no sentence for the customer.`);
    if (r.kind === 'add_on' && r.customer_line.length > 70) out.push(`${name(r.other_slug)} on ${name(r.base_slug)}: the customer's line is too long.`);
    seen.add(`${r.base_slug}|${r.other_slug}`);
  }
  for (const b of g.bundles ?? []) for (const m of b.members) {
    if (!offeredWith(g, b.base_slug, 'add_on').some((r) => r.other_slug === m)) out.push(`${b.name} includes ${name(m)}, which is not an approved add-on of ${name(b.base_slug)}.`);
    const other = b.members.find((x) => x !== m && relate(g, x, m).relation === 'included');
    if (other) out.push(`${b.name} sells ${name(m)} twice: ${name(other)} already does it.`);
  }
  // The same work under two names is one thing a customer would be sold twice.
  const sig = new Map<string, string[]>();
  for (const s of g.services) {
    const key = `${g.packages.some((p) => p.service_slug === s.slug) ? 'weekly' : 'once'}:${workOf(g, s.slug).map((w) => `${w.zone_slug}.${w.task_slug}.${w.depth}`).sort().join(',')}`;
    if (workOf(g, s.slug).length) sig.set(key, [...(sig.get(key) ?? []), s.name]);
  }
  for (const names of sig.values()) if (names.length > 1) out.push(`${names.join(' and ')} are the same work under two names.`);
  return out;
}
