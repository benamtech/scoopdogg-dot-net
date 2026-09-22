/**
 * photos.ts — where a completion photo lives, and the only place that decides.
 *
 * MIGRATION 029 SAYS WHY POSTGRES. The short version: at one customer, a blob store is a new
 * vendor, a new credential and a new failure mode; bytes in a table are none of those. This file
 * is the interface that makes that reversible — `put`, `get`, `prune` and `available`, and
 * nothing outside it knows where the bytes are. Moving to Vercel Blob is this file and no other.
 *
 * `available()` MEASURES, IT DOES NOT ASSERT. The version of `completionReadiness()` this
 * replaces carried the sentence "this project has no photo storage" as a hardcoded truth. It was
 * true when it was written and it would have gone on being said after it stopped being true —
 * the same shape as `rate_cards`, as `alreadySent()`, as the four claims the last session had to
 * retract. So the question "can we store a photo?" is answered by asking the database whether
 * the table is there. On a preview whose database predates 029 the answer is still no, honestly,
 * and the admin still says why.
 *
 * WHAT THIS FILE WILL NOT DO:
 *
 *   - It does not resize. The browser does that before it uploads (a 12MP phone original is
 *     3-5MB and would be rejected here). Server-side resizing means sharp in the function
 *     bundle, ~30MB, to fix a problem a canvas already solved for free.
 *   - It does not guess a mime type from the bytes. The caller declares it and the column's
 *     CHECK constraint is what enforces the set.
 *   - It does not decide whether a photo is REQUIRED. That is `visit.require_completion_photo`,
 *     read in visits.ts, and it is Josue's row.
 */
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { loadCatalog } from './catalog-db.js';

/**
 * Anything that can run a query: the pool, or a client inside a transaction.
 *
 * Every function here takes one, for the same reason `server/lib/comms.ts` does: it lets
 * `gates/visit-photos.mjs` apply migration 029 inside a transaction, plant a real photo, call
 * THESE functions rather than a re-implementation of them, and roll the whole thing back. A gate
 * that reimplemented the dedupe rule or the size cap would pass whenever the copy was right and
 * the shipped code was wrong, which is the one thing a gate must never do.
 */
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** The public base, same shape as comms.ts uses, so one deploy cannot disagree with itself. */
const SITE = () => process.env.PUBLIC_SITE_URL ?? 'https://scoopdogg.net';

export const photoUrl = (id: string) => `${SITE()}/api/photo/${id}`;

export class PhotoError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'photo_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MIMES = new Set(['image/jpeg', 'image/webp', 'image/png']);

/**
 * Is there anywhere to put a photo right now? Asked before offering an upload, and by
 * `completionReadiness()` before offering the complete action.
 *
 * `to_regclass` answers null rather than raising, so a database that predates migration 029 is a
 * `false` and not a 500.
 */
export async function available(q: Queryable = db()): Promise<boolean> {
  try {
    const { rows } = await q.query(`select to_regclass('public.visit_photos') is not null as ok`);
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

type Limits = { maxBytes: number; perVisit: number; retentionDays: number };

async function limits(): Promise<Limits> {
  const { settings } = await loadCatalog();
  const n = (k: string, fallback: number) => {
    const v = Number(settings.get(k));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  // The fallbacks match migration 029's seeded values. They are reached only when the rows are
  // missing, which `gates/settings-have-readers.mjs` is what stops becoming permanent.
  return { maxBytes: n('visit.photo_max_bytes', 900_000), perVisit: n('visit.photos_per_visit_max', 3), retentionDays: n('visit.photo_retention_days', 120) };
}

export type StoredPhoto = { id: string; url: string; bytes: number; deduped: boolean };

/**
 * Store one photo against one visit and return the URL the completion path wants.
 *
 * The same bytes uploaded twice for the same visit is ONE photo. A crew member on a slow
 * connection tapping the button again is the ordinary way that happens, and the unique index on
 * (visit_id, sha256) is what makes the second tap free rather than a duplicate row.
 */
export async function put(input: {
  visitId: string;
  bytes: Buffer;
  mime: string;
  uploadedBy?: string | null;
}, q: Queryable = db()): Promise<StoredPhoto> {
  if (!(await available(q))) {
    throw new PhotoError('Photo storage is not set up on this database (migration 029).', 503, 'no_storage');
  }
  if (!MIMES.has(input.mime)) {
    throw new PhotoError(`A photo must be a JPEG, WebP or PNG. Got ${input.mime}.`, 415, 'bad_mime');
  }
  const { maxBytes, perVisit } = await limits();
  if (input.bytes.length === 0) throw new PhotoError('That file is empty.', 400, 'empty');
  if (input.bytes.length > maxBytes) {
    throw new PhotoError(
      `That photo is ${Math.round(input.bytes.length / 1000)}KB and the limit is ${Math.round(maxBytes / 1000)}KB.`,
      413, 'too_big');
  }

  const { rows: [v] } = await q.query(`select id from visits where id = $1`, [input.visitId]);
  if (!v) throw new PhotoError('No such visit.', 404, 'not_found');

  const { rows: [{ n }] } = await q.query(
    `select count(*)::int as n from visit_photos where visit_id = $1`, [input.visitId]);
  const sha = createHash('sha256').update(input.bytes).digest('hex');

  // The count is checked BEFORE the insert and the insert may still be a dedupe, so an upload
  // that would be the (perVisit + 1)th is only refused when it is genuinely a new photo.
  const { rows: [existing] } = await q.query(
    `select id from visit_photos where visit_id = $1 and sha256 = $2`, [input.visitId, sha]);
  if (existing) {
    return { id: existing.id, url: photoUrl(existing.id), bytes: input.bytes.length, deduped: true };
  }
  if (n >= perVisit) {
    throw new PhotoError(`That visit already has ${n} photos, and the limit is ${perVisit}.`, 409, 'too_many');
  }

  const { rows: [row] } = await q.query(
    `insert into visit_photos (visit_id, bytes, mime, byte_size, sha256, uploaded_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.visitId, input.bytes, input.mime, input.bytes.length, sha, input.uploadedBy ?? null]);
  return { id: row.id, url: photoUrl(row.id), bytes: input.bytes.length, deduped: false };
}

export async function get(id: string, q: Queryable = db()): Promise<{ bytes: Buffer; mime: string; createdAt: Date } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;   // not a uuid: do not ask the database
  if (!(await available(q))) return null;
  const { rows } = await q.query(
    `select bytes, mime, created_at from visit_photos where id = $1`, [id]);
  const r = rows[0];
  return r ? { bytes: r.bytes as Buffer, mime: r.mime as string, createdAt: r.created_at as Date } : null;
}

/** Everything a visit has, for the admin and the customer's own account page. */
export async function forVisit(visitId: string, q: Queryable = db()): Promise<{ id: string; url: string; bytes: number; createdAt: Date }[]> {
  if (!(await available(q))) return [];
  const { rows } = await q.query(
    `select id, byte_size, created_at from visit_photos where visit_id = $1 order by created_at`, [visitId]);
  return rows.map((r) => ({ id: r.id, url: photoUrl(r.id), bytes: r.byte_size, createdAt: r.created_at }));
}

/**
 * Delete photos past the retention window, and clear the URLs that pointed at them.
 *
 * THERE IS NO SCHEDULER ON THIS PROJECT — `vercel.json` has no `crons` key — so this runs when
 * somebody reads, exactly like `expireDuePauses()` and the comms sweeps. That means retention is
 * enforced whenever the admin is opened and not on a timer, which is stated here rather than
 * implied by a default nobody checks.
 *
 * The URL cleanup is the half that is easy to forget: deleting the bytes and leaving
 * `visits.photo_urls` pointing at them turns a completed visit into a row of dead links.
 */
export async function prune(q: Queryable = db()): Promise<{ deleted: number; visitsCleared: number; retentionDays: number }> {
  if (!(await available(q))) return { deleted: 0, visitsCleared: 0, retentionDays: 0 };
  const { retentionDays } = await limits();

  // NO TRANSACTION OF ITS OWN. The delete and the URL cleanup want to be atomic, and the honest
  // way to get that here is for the CALLER to own the transaction — which the admin does, and
  // which `gates/visit-photos.mjs` needs in order to roll the whole thing back. A `db().connect()`
  // inside this function would have made it untestable by the gate that proves it, and an
  // untested prune is how `visits.photo_urls` ends up full of links to 404s.
  const { rows: gone } = await q.query(
    `delete from visit_photos
      where created_at < now() - ($1 || ' days')::interval
     returning id, visit_id`, [String(retentionDays)]);
  let visitsCleared = 0;
  if (gone.length) {
    const urls = gone.map((g) => photoUrl(g.id));
    const { rowCount } = await q.query(
      `update visits
          set photo_urls = coalesce((select array_agg(u) from unnest(photo_urls) u where u <> all($2::text[])), '{}'::text[]),
              updated_at = now()
        where id = any($1::uuid[]) and photo_urls && $2::text[]`,
      [gone.map((g) => g.visit_id), urls]);
    visitsCleared = rowCount ?? 0;
  }
  return { deleted: gone.length, visitsCleared, retentionDays };
}
