/**
 * The funnel's own memory: which ZIP is where, and what happened before a booking existed.
 *
 * P19 §2 put this inside the definition of done. The site has produced 26 leads in its entire
 * life and nobody can say at which step the other visitors left, because nothing before
 * `booking.created` was ever written down. A 20x gap has a shape; today it has none.
 *
 * TWO THINGS LIVE HERE.
 *
 * `resolveZip` answers the funnel's first question from rows with a source on them
 * (migration 020), replacing a 30-entry constant typed from memory into a React island. It
 * distinguishes three answers, and the third is the one that matters:
 *     served          -> which city, and therefore which route day
 *     known, not served -> "we're not on a route in 93012 yet", and a waitlist row worth having
 *     never heard of  -> the honest shrug
 *
 * `track` writes one row per booking-intent session and one event per step reached. It is the
 * whole of the analytics on this site: no cookie, no device id, no third-party script, no consent
 * banner, because there is nothing here that is not this business's own record of its own funnel.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export type ZipAnswer =
  | { known: true; served: true; postal_code: string; area_slug: string; area_name: string; city_name: string }
  | { known: true; served: false; postal_code: string; area_slug: null; city_name: string }
  | { known: false; served: false; postal_code: string };

export async function resolveZip(raw: string): Promise<ZipAnswer> {
  const zip = String(raw ?? '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) return { known: false, served: false, postal_code: zip };
  const { rows } = await db().query(
    `select z.postal_code, z.area_slug, z.city_name, a.name as area_name, a.bookable
       from area_postal_codes z left join service_areas a on a.slug = z.area_slug
      where z.postal_code = $1`, [zip]);
  const r = rows[0];
  if (!r) return { known: false, served: false, postal_code: zip };
  // `bookable` is Josue's switch in the admin (P18 §2 item 5). A city he has turned off is known
  // and not served, exactly like a ZIP we never had a route in - the customer hears the same
  // honest sentence either way.
  if (!r.area_slug || !r.bookable) {
    return { known: true, served: false, postal_code: r.postal_code, area_slug: null, city_name: r.city_name };
  }
  return { known: true, served: true, postal_code: r.postal_code, area_slug: r.area_slug, area_name: r.area_name, city_name: r.city_name };
}

/** The ZIPs a page may put in front of a browser: served ones only, generated at build time. */
export async function servedZipMap(): Promise<Record<string, string>> {
  const { rows } = await db().query(
    `select z.postal_code, z.area_slug from area_postal_codes z
       join service_areas a on a.slug = z.area_slug
      where a.bookable and a.status = 'active' order by z.postal_code`);
  return Object.fromEntries(rows.map((r) => [r.postal_code, r.area_slug]));
}

// ---------------------------------------------------------------------------------------
// The session, and the events P16 §9 names.
// ---------------------------------------------------------------------------------------

/**
 * The steps that are worth an event, and the event each one writes. A closed list on the SERVER,
 * because an events table anybody can write any string into is a table nobody can query.
 */
const EVENT_FOR: Record<string, string> = {
  zip: 'booking.started',          // a ZIP was entered - the top of the funnel, at last
  price: 'booking.priced',         // a number was on screen
  lane: 'booking.lane_chosen',     // prepay or pay-after
  onetime: 'onetime.scheduled',    // a one-time job picked a date
  texted: 'lead.texted',           // Josue tapped the SMS link in the admin
};

export type TrackInput = {
  session_id: string;
  step: keyof typeof EVENT_FOR | string;
  postal_code?: string | null;
  area_slug?: string | null;
  city_name?: string | null;
  service_slug?: string | null;
  package_id?: string | null;
  price_cents_seen?: number | null;
  lane?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** The referrer's host, or a reserved verifier value when `trusted`. See `normaliseSource`. */
  source?: string | null;
  /** True only for server-side callers. A browser never sets this. */
  trusted?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reserved values of `funnel_sessions.source`, in ONE place.
 *
 * `'gate'` is written at the time by a verifier; `'gate-retro'` was attributed afterwards by
 * migration 033 to the 25 rows that existed when the fault was found. `growth.ts` filters both
 * out of every number a client sees, and `gates/funnel-source.mjs` plants one and fails if the
 * board moves.
 *
 * MEASURED, 2026-09-23: all 25 rows in the table were ours and nothing could tell. A client
 * dashboard whose first number is a count of AMTECH's continuous integration is a dashboard that
 * lies to the owner, and it lies more the more carefully we test.
 */
export const VERIFIER_SOURCES = ['gate', 'gate-retro'] as const;

/**
 * A referrer host, or nothing.
 *
 * TAKES A WHOLE REFERRER AND KEEPS THE HOST. The column groups channels — google.com,
 * instagram.com, nextdoor.com — and a full URL would make every visit its own channel. Paths and
 * query strings are dropped on the way in rather than filtered on the way out, so a search term
 * or a session id in somebody's referrer never lands in this client's database at all.
 *
 * REFUSES A RESERVED VALUE FROM UNTRUSTED INPUT. `trusted` is true only where the caller is
 * server-side code — a verifier calling `track()` directly, or the API recognising the verifier
 * header. A browser that sends `source: 'gate'` gets null, not a hidden session.
 *
 * THIS IS NOT A TRUST BOUNDARY and the migration says so too. Nothing stops a determined visitor
 * setting the header; the cost is one person leaving themselves out of a count on their own
 * client's dashboard. There is no secret here and a check for an attack nobody is running would
 * be the wrong shape.
 */
export function normaliseSource(raw: unknown, { trusted = false } = {}): string | null {
  let v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if ((VERIFIER_SOURCES as readonly string[]).includes(v)) return trusted ? v : null;
  // A full URL keeps only its host; a bare host stays a bare host.
  if (v.includes('/') || v.includes(':')) {
    try { v = new URL(v.includes('//') ? v : `https://${v}`).hostname; } catch { return null; }
  }
  v = v.replace(/^www\./, '');
  // The column's own check constraint, applied before the insert rather than caught after it.
  return /^[a-z0-9][a-z0-9.-]{0,79}$/.test(v) ? v : null;
}

/**
 * `q` IS WHY THIS TAKES A SECOND ARGUMENT, and it was added after a gate wrote to a client's live
 * database by accident. `gates/funnel-source.mjs` plants a session inside its own transaction and
 * rolls back; calling this without `q` took a SEPARATE connection out of the pool, so the planted
 * rows landed outside that transaction and survived it. The rows happened to fail on a column the
 * live table did not have yet, which is luck and not a design.
 *
 * So: pass a client and this runs ON it and the caller owns the transaction. Pass nothing — every
 * caller in the product — and it takes one from the pool and owns the transaction itself. The
 * statements are identical either way, which is the point: a gate that re-implemented them would
 * pass on a day the shipped path was wrong.
 */
export async function track(input: TrackInput, q?: Queryable): Promise<{ recorded: boolean; event: string | null }> {
  const id = String(input.session_id ?? '');
  if (!UUID.test(id)) return { recorded: false, event: null };
  const step = String(input.step ?? '');
  const eventType = EVENT_FOR[step] ?? null;
  const source = normaliseSource(input.source, { trusted: input.trusted === true });

  const run = async (client: Queryable) => {
    // The row is upserted with COALESCE so a later step never erases what an earlier one learned:
    // the price seen at the price step must survive the customer walking back and forward.
    await client.query(
      `insert into funnel_sessions (id, postal_code, area_slug, city_name, service_slug, package_id,
                                    price_cents_seen, lane, step, name, email, phone, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set
         postal_code      = coalesce(excluded.postal_code, funnel_sessions.postal_code),
         area_slug        = coalesce(excluded.area_slug, funnel_sessions.area_slug),
         city_name        = coalesce(excluded.city_name, funnel_sessions.city_name),
         service_slug     = coalesce(excluded.service_slug, funnel_sessions.service_slug),
         package_id       = coalesce(excluded.package_id, funnel_sessions.package_id),
         price_cents_seen = coalesce(excluded.price_cents_seen, funnel_sessions.price_cents_seen),
         lane             = coalesce(excluded.lane, funnel_sessions.lane),
         step             = coalesce(excluded.step, funnel_sessions.step),
         name             = coalesce(excluded.name, funnel_sessions.name),
         email            = coalesce(excluded.email, funnel_sessions.email),
         phone            = coalesce(excluded.phone, funnel_sessions.phone),
         -- WHERE THEY CAME FROM IS DECIDED ONCE, at the first step of the session. Every later
         -- track() call is a fetch from the site's own page, so letting a later value win would
         -- overwrite 'google.com' with 'scoopdogg.net' on the second click and turn every channel
         -- into direct traffic.
         source           = coalesce(funnel_sessions.source, excluded.source),
         last_seen_at     = now()`,
      [id, input.postal_code ?? null, input.area_slug ?? null, input.city_name ?? null,
       input.service_slug ?? null, input.package_id ?? null,
       Number.isFinite(Number(input.price_cents_seen)) ? Number(input.price_cents_seen) : null,
       input.lane ?? null, step || null, input.name ?? null, input.email ?? null, input.phone ?? null,
       source]);

    let recorded = false;
    if (eventType) {
      // ONCE PER SESSION PER STEP. A customer who walks back to the price step has not started a
      // second funnel, and a conversion rate computed over repeated steps is a rate over nothing.
      const { rows: seen } = await client.query(
        `select 1 from events where subject_kind = 'booking' and subject_id = $1 and event_type = $2 limit 1`,
        [id, eventType]);
      if (!seen.length) {
        await appendEvent(client as never, {
          subjectKind: 'booking', subjectId: id, type: eventType, to: step,
          actorKind: step === 'texted' ? 'owner' : 'customer',
          payload: {
            postal_code: input.postal_code ?? null, area: input.area_slug ?? null,
            package: input.package_id ?? null, price_cents: input.price_cents_seen ?? null,
            lane: input.lane ?? null,
          },
        });
        recorded = true;
      }
    }
    return { recorded, event: eventType };
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

/** Tie a session to the booking it became, so the hour block stops offering to chase it. */
export async function sessionConverted(sessionId: string, subscriptionId: string) {
  if (!UUID.test(String(sessionId ?? ''))) return;
  await db().query(
    `update funnel_sessions set subscription_id = $2, last_seen_at = now() where id = $1`,
    [sessionId, subscriptionId]);
}
