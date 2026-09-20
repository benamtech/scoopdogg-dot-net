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
 * THE PHOTO REQUIREMENT IS ON AND CANNOT BE SATISFIED TODAY, and that is stated rather than
 * worked around. `visit.require_completion_photo` is `true` in settings and this project has no
 * photo storage — no blob client, no bucket, nothing in `package.json`. So this refuses, by
 * name, and the admin says why. The two ways out are both somebody's decision and neither is
 * mine: add storage, or set the row to `false` at /admin/settings, which Josue can do himself.
 * Refusing is the right failure: the setting is Josue's proof-of-care differentiator and his
 * chargeback evidence (R3 §3d, $15 a dispute), so quietly ignoring it would be the worse bug.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { loadCatalog } from './catalog-db.js';

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
export async function completionReadiness(): Promise<{ ready: boolean; requiresPhoto: boolean; reason: string | null }> {
  const { settings } = await loadCatalog();
  const requiresPhoto = settings.get('visit.require_completion_photo') === true;
  // There is no uploader and no storage, so a required photo cannot be supplied from the admin.
  // This is a measurement of the project, not a policy: when storage exists, drop this.
  if (requiresPhoto) {
    return {
      ready: false,
      requiresPhoto: true,
      reason: 'visit.require_completion_photo is on and this site has no photo storage yet. '
        + 'Add storage, or turn the requirement off in Settings.',
    };
  }
  return { ready: true, requiresPhoto: false, reason: null };
}

/**
 * Mark one visit done.
 *
 * The whole thing is one transaction: the row, the event and nothing else. The messages that
 * follow a completion are sent by the CALLER, after the transaction commits, so a mail provider
 * being slow or down cannot roll back the fact that the yard was cleaned.
 */
export async function completeVisit(input: CompleteVisitInput): Promise<CompleteVisitResult> {
  const photos = (input.photoUrls ?? []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  const { settings } = await loadCatalog();
  if (settings.get('visit.require_completion_photo') === true && photos.length === 0) {
    throw new VisitError(
      'A completion photo is required by visit.require_completion_photo, and none was supplied.',
      422, 'photo_required');
  }

  const client = await db().connect();
  try {
    await client.query('begin');
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
      returning id, completed_at, photo_urls`,
      [input.visitId, input.completedBy ?? null, photos, (input.crewNotes ?? '').slice(0, 2000)]);

    await appendEvent(client, {
      subjectKind: 'visit', subjectId: input.visitId, type: 'visit.complete',
      from: v.state, to: 'completed',
      actorKind: input.completedBy ? 'team' : 'owner', actorId: input.completedBy ?? undefined,
      payload: { photos: (done.photo_urls ?? []).length },
    });
    await client.query('commit');
    return {
      id: done.id,
      state: 'completed',
      completed_at: new Date(done.completed_at).toISOString(),
      photos: (done.photo_urls ?? []).length,
    };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
