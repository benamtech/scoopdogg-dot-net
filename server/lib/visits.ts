/**
 * visits.ts — the writer that marks a visit done.
 *
 * WHY THIS FILE EXISTS. `visits.completed_at` was read in three places and written in none:
 * the customer's account page lists completed visits, `invoice.generate` was specified to sum
 * them, and step 9's review request fires on the third one. Measured 2026-09-19: one visit row
 * in the database, zero completed, and no code path anywhere that could complete one. Building
 * loop 2 and loop 3 on top of that would have been two more readers with no writer — the defect
 * this project keeps paying for (rate_cards, rate_calendar, photo_urls).
 *
 * THIS IS NOT THE CREW APP. P18 §4 and STANDARD.md §6 leave that deliberately unsettled, and
 * nothing here schedules, assigns, routes or tracks. It is one verb — `visit.complete` — so that
 * the messages that depend on it have something to depend on.
 *
 * WHAT P4 §"Visit" SPECIFIES, and what this does differently, said plainly:
 *
 *   - P4's edge is `en_route → completed`. This accepts `scheduled`, `assigned` and `en_route`,
 *     because NOTHING sets `en_route` — there is no crew app to tap it — so requiring it would
 *     make the verb unreachable. A one-man operator standing in the yard marks the stop done.
 *   - `completed_at` and `completed_by` are set, as specified.
 *   - `charge_cents` and `chargeable` are LEFT AS THEY ARE, not recomputed. Every visit created
 *     by `booking.ts` carries `chargeable = false` because the monthly subscription is what gets
 *     charged, not the visit. Freezing a per-visit price here would invent money that nothing
 *     bills. When per-visit billing exists, this is where it is decided.
 *   - `photo_urls` is required when `visit.require_completion_photo` is true, as specified.
 *
 * THE PHOTO REQUIREMENT USED TO BE UNSATISFIABLE, AND THE STORAGE WAS BUILT RATHER THAN THE
 * REQUIREMENT TURNED OFF. Until 2026-09-22 this file carried the sentence "this project has no
 * photo storage" as a hardcoded truth and refused every completion — correctly, but it was the
 * top of a chain nobody had traced: no storage, so no completed visit, so `count(v.id) >= 3` in
 * comms.ts is never true, so the review request R8 §B2 calls the single highest-return growth
 * item on this project could never fire. The recorded way out was "ask Josue: add storage or
 * turn the row off". It was not his question. Turning the row off would have deleted his
 * proof-of-care differentiator and his chargeback evidence (R3 §3d, $15 a dispute) to save us
 * writing a table. Migration 029 and `server/lib/photos.ts` are the table.
 *
 * AND THE READINESS CHECK NOW ASKS INSTEAD OF ASSERTING. `photos.available()` reads
 * `to_regclass('public.visit_photos')`, so a database that predates 029 still answers "not
 * ready" honestly and the admin still says why — while a database that has it stops being told
 * a stale sentence about itself. A hardcoded claim about the environment is exactly the shape
 * this project keeps having to retract.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { loadCatalog } from './catalog-db.js';
import { available as photosAvailable, type Queryable } from './photos.js';

export class VisitError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'visit_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The states a visit may be completed from. See the header for why this is wider than P4. */
const COMPLETABLE = ['scheduled', 'assigned', 'en_route'] as const;

export type CompleteVisitInput = {
  visitId: string;
  /** The team member marking it done. Recorded on the row and on the event. */
  completedBy?: string | null;
  photoUrls?: string[];
  crewNotes?: string;
};

export type CompleteVisitResult = {
  id: string;
  state: 'completed';
  completed_at: string;
  photos: number;
};

/**
 * Can a visit be completed at all right now? Asked by the admin BEFORE it offers the action, so
 * the screen can say why not instead of presenting a button that always errors.
 */
export async function completionReadiness(q: Queryable = db()): Promise<{ ready: boolean; requiresPhoto: boolean; reason: string | null }> {
  const { settings } = await loadCatalog();
  const requiresPhoto = settings.get('visit.require_completion_photo') === true;
  if (!requiresPhoto) return { ready: true, requiresPhoto: false, reason: null };

  // ASK, do not assert. On a database that predates migration 029 this is still false and the
  // admin still says why; on one that has it, the action is offered. `q` is here so
  // `gates/visit-photos.mjs` can ask THIS function, inside a transaction that has the table,
  // instead of re-implementing the rule it is checking.
  if (!(await photosAvailable(q))) {
    return {
      ready: false,
      requiresPhoto: true,
      reason: 'visit.require_completion_photo is on and this database has no photo storage yet '
        + '(migration 029 has not been applied here). Apply it, or turn the requirement off in Settings.',
    };
  }
  return { ready: true, requiresPhoto: true, reason: null };
}

/**
 * How many timed stops it takes before a median replaces an estimate.
 *
 * R14 §E5's number, not this file's: "then the ladder, with fifty measured visits behind it." A
 * median over three stops moves by minutes when one customer has a bad week, and a price ladder
 * that moves like that is one nobody will trust twice. It lives here because
 * `gates/price-clears-the-floor.mjs` and `server/lib/density.ts` both need it and two copies of a
 * threshold is how the two halves of a rule drift apart.
 */
export const ENOUGH_TIMED_STOPS = 50;

/**
 * The van left for this stop.
 *
 * `en_route_at` has been in the schema since migration 001 and this is the first thing that has
 * ever written it. Until now no visit on this project had a clock of any kind, which is why
 * `service_tiers.est_minutes` — an estimate that its own column comment asks to be replaced — is
 * simultaneously the input to the price ladder (migration 016) and the standard the ladder is
 * checked against (gates/price-clears-the-floor.mjs). R14 §B.
 *
 * IDEMPOTENT, AND THE FIRST TAP WINS. A crew member tapping twice has not left twice, and taking
 * the later timestamp would quietly shorten every drive it measured.
 */
export async function markEnRoute(visitId: string, by?: string | null, q: Queryable = db()): Promise<StopClock> {
  return stamp(visitId, 'en_route_at', by ?? null, q);
}

/**
 * The van is at the property: travel ends and work begins.
 *
 * This is the column the price argument needs. `arrived_at -> completed_at` is SERVICE time —
 * what the work actually takes — and it is the number `est_minutes` has been standing in for.
 * `en_route_at -> arrived_at` is DRIVE time, which `server/lib/density.ts` models from Census
 * geometry, so recording it is how that model finally gets checked against a road.
 *
 * DOES NOT IMPLY en_route. Arriving without having tapped "on my way" is a stop whose service
 * time is known and whose drive time is not, and inventing an `en_route_at` here would fabricate
 * a drive of zero minutes into the median that checks the routing model.
 */
export async function markArrived(visitId: string, by?: string | null, q: Queryable = db()): Promise<StopClock> {
  return stamp(visitId, 'arrived_at', by ?? null, q);
}

export type StopClock = {
  id: string;
  state: string;
  en_route_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  /** Null until both ends of an interval exist. Never zero as a stand-in for unknown. */
  drive_minutes: number | null;
  service_minutes: number | null;
};

const clock = (r: Record<string, any>): StopClock => {
  const t = (v: any) => (v ? new Date(v).getTime() : null);
  const mins = (a: number | null, b: number | null) =>
    a !== null && b !== null ? Math.round(((b - a) / 60000) * 10) / 10 : null;
  return {
    id: r.id,
    state: r.state,
    en_route_at: r.en_route_at ? new Date(r.en_route_at).toISOString() : null,
    arrived_at: r.arrived_at ? new Date(r.arrived_at).toISOString() : null,
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    drive_minutes: mins(t(r.en_route_at), t(r.arrived_at)),
    service_minutes: mins(t(r.arrived_at), t(r.completed_at)),
  };
};

/**
 * One timestamp, written once, in the database rather than in this process.
 *
 * `now()` is the SERVER's clock. A phone in a yard with a wrong timezone would otherwise put a
 * negative service time into the median that sets a price, and migration 035's own check
 * constraint would reject the row — correctly, and as an error the crew member cannot act on.
 *
 * THE TWO STATEMENTS ARE WRITTEN OUT IN FULL rather than built from a `${column}` the caller
 * supplies, and the reason is not injection — the type is a two-member union. It is that a column
 * name that only exists at runtime is invisible to anything reading the repository.
 * `gates/writers-outside-gates.mjs` caught exactly that on its first full run: `arrived_at` was
 * reported as written ONLY by a gate, because the one shipped writer spelled it `${column}`. A
 * writer no reader can find is most of the way to a writer that is not there.
 */
const STAMP = {
  en_route_at: `update visits
        set en_route_at = coalesce(en_route_at, now()),
            state = case when state in ('scheduled','assigned') then 'en_route' else state end,
            updated_at = now()
      where id = $1
      returning id, state, en_route_at, arrived_at, completed_at`,
  arrived_at: `update visits
        set arrived_at = coalesce(arrived_at, now()),
            updated_at = now()
      where id = $1
      returning id, state, en_route_at, arrived_at, completed_at`,
} as const;

async function stamp(visitId: string, column: 'en_route_at' | 'arrived_at', by: string | null, q: Queryable): Promise<StopClock> {
  const { rows } = await q.query(
    `select id, state from visits where id = $1`, [visitId]);
  const v = rows[0];
  if (!v) throw new VisitError('No such visit.', 404, 'not_found');
  if (v.state === 'completed') throw new VisitError('That visit is already complete.', 409, 'already_complete');
  if (['cancelled', 'skipped'].includes(v.state)) {
    throw new VisitError(`A ${v.state} visit has no stop to record.`, 409, 'wrong_state');
  }

  const { rows: [done] } = await q.query(STAMP[column], [visitId]);

  await appendEvent(q as never, {
    subjectKind: 'visit', subjectId: visitId,
    type: column === 'en_route_at' ? 'visit.en_route' : 'visit.arrived',
    from: v.state, to: done.state,
    actorKind: by ? 'team' : 'owner', actorId: by ?? undefined,
    payload: clock(done) as unknown as Record<string, unknown>,
  });
  return clock(done);
}

/**
 * What a stop actually takes, from the stops that were actually recorded.
 *
 * MEDIAN, NOT MEAN. One visit where somebody forgot to tap "done" until the evening would drag a
 * mean by an hour and move a price. `percentile_cont(0.5)` ignores it.
 *
 * `measured` IS PART OF THE ANSWER. Two recorded visits is not a median of anything, and a
 * caller that cannot see the count would use it anyway. Nothing here decides what "enough" is —
 * `gates/price-clears-the-floor.mjs` and `server/lib/density.ts` each state their own threshold,
 * because "enough to check a price ladder" and "enough to rank cities" are different questions.
 */
export async function stopDurations(q: Queryable = db()): Promise<{
  service_minutes: number | null; service_measured: number;
  drive_minutes: number | null; drive_measured: number;
  by_tier: { service_slug: string; label: string; est_minutes: number | null; median_minutes: number; measured: number }[];
}> {
  const has = await q.query(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'visits' and column_name = 'arrived_at'`);
  if (Number(has.rows[0]?.n) !== 1) {
    return { service_minutes: null, service_measured: 0, drive_minutes: null, drive_measured: 0, by_tier: [] };
  }

  const { rows: [agg] } = await q.query(`
    select count(*) filter (where arrived_at is not null and completed_at is not null)::int as service_measured,
           percentile_cont(0.5) within group (
             order by extract(epoch from (completed_at - arrived_at)) / 60
           ) filter (where arrived_at is not null and completed_at is not null) as service_minutes,
           count(*) filter (where en_route_at is not null and arrived_at is not null)::int as drive_measured,
           percentile_cont(0.5) within group (
             order by extract(epoch from (arrived_at - en_route_at)) / 60
           ) filter (where en_route_at is not null and arrived_at is not null) as drive_minutes
      from visits where state = 'completed'`);

  // Per tier, because a four-dog yard is not a one-dog yard and one median across both would
  // check every rung of the ladder against the middle of it.
  const { rows: byTier } = await q.query(`
    select t.service_slug, t.label, t.est_minutes,
           round(percentile_cont(0.5) within group (
             order by extract(epoch from (v.completed_at - v.arrived_at)) / 60
           )::numeric, 1) as median_minutes,
           count(*)::int as measured
      from visits v
      join subscriptions s on s.id = v.subscription_id
      join service_tiers t on t.service_slug = s.service_slug
     where v.state = 'completed' and v.arrived_at is not null and v.completed_at is not null
     group by t.service_slug, t.label, t.est_minutes
     order by t.service_slug, t.label`);

  const round1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  return {
    service_minutes: round1(agg.service_minutes),
    service_measured: Number(agg.service_measured),
    drive_minutes: round1(agg.drive_minutes),
    drive_measured: Number(agg.drive_measured),
    by_tier: byTier.map((r) => ({ ...r, est_minutes: r.est_minutes === null ? null : Number(r.est_minutes), median_minutes: Number(r.median_minutes) })),
  };
}

/**
 * Mark one visit done.
 *
 * The whole thing is one transaction: the row, the event and nothing else. The messages that
 * follow a completion are sent by the CALLER, after the transaction commits, so a mail provider
 * being slow or down cannot roll back the fact that the yard was cleaned.
 */
export async function completeVisit(input: CompleteVisitInput, q?: Queryable): Promise<CompleteVisitResult> {
  const photos = (input.photoUrls ?? []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  const { settings } = await loadCatalog();
  if (settings.get('visit.require_completion_photo') === true && photos.length === 0) {
    throw new VisitError(
      'A completion photo is required by visit.require_completion_photo, and none was supplied.',
      422, 'photo_required');
  }

  /**
   * `q` IS WHY THIS TAKES A SECOND ARGUMENT, and `track()` carries the same one for the same
   * reason. A gate that plants a visit inside its own transaction and then calls this without a
   * client gets a SEPARATE pooled connection, which cannot see the planted row — and whatever it
   * does write survives the rollback, in a client's live database. Pass a client and this runs on
   * it and the caller owns the transaction; pass nothing, as every caller in the product does,
   * and it takes one from the pool and owns the transaction itself.
   */
  const run = async (client: Queryable) => {
    const { rows } = await client.query(
      `select id, state from visits where id = $1 for update`, [input.visitId]);
    const v = rows[0];
    if (!v) throw new VisitError('No such visit.', 404, 'not_found');
    if (v.state === 'completed') throw new VisitError('That visit is already complete.', 409, 'already_complete');
    if (!COMPLETABLE.includes(v.state)) {
      throw new VisitError(`A ${v.state} visit cannot be completed.`, 409, 'wrong_state');
    }

    const { rows: [done] } = await client.query(
      `update visits
          set state = 'completed', completed_at = now(), completed_by = $2,
              photo_urls = case when $3::text[] = '{}'::text[] then photo_urls else $3::text[] end,
              crew_notes = coalesce(nullif($4, ''), crew_notes),
              updated_at = now()
        where id = $1
      returning id, state, completed_at, photo_urls,
                (select en_route_at from visits where id = $1) as en_route_at,
                (select arrived_at  from visits where id = $1) as arrived_at`,
      [input.visitId, input.completedBy ?? null, photos, (input.crewNotes ?? '').slice(0, 2000)]);

    await appendEvent(client as never, {
      subjectKind: 'visit', subjectId: input.visitId, type: 'visit.complete',
      from: v.state, to: 'completed',
      actorKind: input.completedBy ? 'team' : 'owner', actorId: input.completedBy ?? undefined,
      // The clock goes on the receipt: a completion that recorded a duration and one that did
      // not are different events, and `service_minutes: null` says which without pretending.
      payload: { photos: (done.photo_urls ?? []).length, ...clock(done) },
    });
    return {
      id: done.id,
      state: 'completed' as const,
      completed_at: new Date(done.completed_at).toISOString(),
      photos: (done.photo_urls ?? []).length,
    };
  };

  if (q) return run(q);

  const client = await db().connect();
  try {
    await client.query('begin');
    const r = await run(client);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
