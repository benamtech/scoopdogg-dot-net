/**
 * Append to the event spine. `events` had zero application writers until this file (audit
 * finding 11): every admin number derived from it came from an empty table.
 *
 * The hash is computed by the events_chain trigger (migrations/007); this computes the
 * sequence under a per-subject advisory lock, inside the caller's transaction, so two
 * writers cannot both claim seq N.
 */
import type pg from 'pg';

export type EventInput = {
  subjectKind: 'customer' | 'subscription' | 'visit' | 'invoice' | 'booking' | 'waitlist' | 'team';
  subjectId: string;
  type: string;
  from?: string | null;
  to?: string | null;
  actorKind: 'customer' | 'team' | 'owner' | 'system' | 'agent';
  actorId?: string | null;
  payload?: Record<string, unknown>;
};

export async function appendEvent(client: pg.PoolClient | pg.Pool, e: EventInput) {
  await client.query(`select pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [e.subjectKind, e.subjectId]);
  await client.query(
    `insert into events (subject_kind, subject_id, seq, event_type, from_state, to_state, actor_kind, actor_id, payload)
     values ($1, $2, coalesce((select max(seq) from events where subject_kind = $1 and subject_id = $2), 0) + 1,
             $3, $4, $5, $6, $7, $8::jsonb)`,
    [e.subjectKind, e.subjectId, e.type, e.from ?? null, e.to ?? null, e.actorKind, e.actorId ?? null, JSON.stringify(e.payload ?? {})]);
}
