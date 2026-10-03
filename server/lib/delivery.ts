/**
 * Where an outbox row learns whether its message actually arrived.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. A 200 from the mail provider means ACCEPTED, not
 * delivered. It is returned before the message has been offered to the recipient's server,
 * so it cannot see a bounce, a block, or a spam complaint. Marking a row `delivered` on
 * that 200 produces a database that claims every message arrived and an owner who finds
 * out otherwise from a customer who never got their confirmation.
 *
 * So `sendEmail` only ever sets `delivering`, and the terminal state comes from here, from
 * an OBSERVED event:
 *
 *     email.delivered   ->  delivered
 *     email.bounced     ->  failed,  and the address is suppressed
 *     email.complained  ->  failed,  and the address is suppressed
 *     past the budget   ->  abandoned
 *
 * TWO SHAPES OF THE SAME FACT, and both are handled here on purpose. A webhook payload
 * carries `type: 'email.delivered'`. The provider's own read endpoint carries
 * `last_event: 'delivered'`. They are the same event under two names, so they normalise to
 * one vocabulary before anything is written - otherwise the reconciler and the webhook
 * disagree about a row and the last writer wins.
 *
 * RECONCILING BY READING IS NOT A SECOND-BEST. The provider's index is a second copy of a
 * receipt we would otherwise have thrown away: it answers for a message sent days ago, it
 * needs no listener to have been reachable at the moment the event fired, and it can be
 * run again. A webhook that was pointed at the wrong host loses events silently; a read
 * cannot.
 */
import { db } from './db.js';
import { resendFetch } from './notify.js';
import { safeError } from './http.js';

/** The three events that decide a message's fate. Named in the provider's webhook
 *  vocabulary, which is the one that appears in its documentation and its dashboard. */
export const DELIVERED = 'email.delivered';
export const BOUNCED = 'email.bounced';
export const COMPLAINED = 'email.complained';

/** Attempts before a message that has never resolved either way is given up on. */
const RETRY_BUDGET = 6;

export type DeliveryEvent = typeof DELIVERED | typeof BOUNCED | typeof COMPLAINED | null;

/**
 * Normalise either shape to the webhook vocabulary.
 *
 * Anything that is not one of the three - `sent`, `queued`, `opened`, `clicked`,
 * `delivery_delayed` - returns null, which means "still in flight". It deliberately does
 * NOT mean "fine": a row with no terminal event stays `delivering` and shows up in the
 * next reconcile, and eventually as `abandoned`. Reading an absent event as a success is
 * the measured-absence defect this project has already shipped once.
 */
export function normaliseEvent(raw: unknown): DeliveryEvent {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'delivered' || v === DELIVERED) return DELIVERED;
  if (v === 'bounced' || v === BOUNCED) return BOUNCED;
  if (v === 'complained' || v === COMPLAINED) return COMPLAINED;
  return null;
}

type ApplyResult = { outboxId: number; state: string; event: DeliveryEvent; suppressed: string[] };

/**
 * Record one observed event against the outbox row that owns the provider's message id.
 *
 * Idempotent: applying the same event twice leaves the same row. A row that has already
 * reached a terminal state is not moved by a later, weaker event.
 */
export async function applyDeliveryEvent(
  providerId: string,
  event: DeliveryEvent,
  detail: string | null = null,
): Promise<ApplyResult | null> {
  if (!event) return null;

  const state = event === DELIVERED ? 'delivered' : 'failed';
  const { rows } = await db().query(
    `update outbox
        set state         = $2,
            last_event    = $3,
            last_event_at = now(),
            last_error    = case when $2 = 'failed' then coalesce($4, $3) else last_error end,
            delivered_at  = case when $2 = 'delivered' then now() else delivered_at end
      where provider = 'resend' and provider_id = $1
        and state in ('pending', 'delivering')
      returning id, payload`,
    [providerId, state, event, detail],
  );
  if (!rows.length) return null;

  const row = rows[0] as { id: number; payload: { to?: string[] } };
  const suppressed: string[] = [];

  // A bounce or a complaint is not a retryable failure. Sending to that address again
  // costs the sending domain its reputation, which is shared with every other message
  // this business sends - including the ones a customer is waiting for.
  if (event === BOUNCED || event === COMPLAINED) {
    for (const address of row.payload?.to ?? []) {
      await db().query(
        `insert into email_suppressions (address, reason, event, outbox_id)
         values ($1, $2, $3, $4)
         on conflict (address) do update set reason = excluded.reason, event = excluded.event`,
        [address, detail ?? event, event, row.id],
      );
      suppressed.push(address);
    }
  }

  return { outboxId: Number(row.id), state, event, suppressed };
}

/** Is this address one we have been told to stop writing to? */
export async function isSuppressed(address: string): Promise<boolean> {
  const { rows } = await db().query(
    'select 1 from email_suppressions where lower(address) = lower($1)', [address]);
  return rows.length > 0;
}

export type ReconcileReport = {
  looked_at: number;
  delivered: number;
  failed: number;
  abandoned: number;
  still_in_flight: number;
  unreadable: number;
};

/**
 * Ask the provider what became of every message we have accepted but not resolved.
 *
 * Run by scripts/reconcile-deliveries.mjs, by the demo gates, and - once the site is on
 * Vercel - by a cron. It is safe to run at any time and as often as you like.
 */
export async function reconcileOutbox(limit = 200): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    looked_at: 0, delivered: 0, failed: 0, abandoned: 0, still_in_flight: 0, unreadable: 0,
  };

  const { rows } = await db().query(
    `select id, provider_id, attempts, created_at
       from outbox
      where provider = 'resend' and provider_id is not null
        and state in ('pending', 'delivering')
      order by created_at asc
      limit $1`,
    [limit],
  );

  for (const row of rows as { id: number; provider_id: string; attempts: number }[]) {
    report.looked_at++;
    let lastEvent: unknown = null;
    try {
      const res = await resendFetch(`/emails/${row.provider_id}`, { method: 'GET' });
      if (!res.ok) { report.unreadable++; continue; }
      const body = (await res.json()) as { last_event?: string };
      lastEvent = body.last_event;
    } catch (e) {
      safeError('delivery:read', e);
      report.unreadable++;
      continue;
    }

    const event = normaliseEvent(lastEvent);
    if (event) {
      const applied = await applyDeliveryEvent(row.provider_id, event, String(lastEvent));
      if (applied?.state === 'delivered') report.delivered++;
      else if (applied?.state === 'failed') report.failed++;
      continue;
    }

    // No terminal event yet. Count the look, and give up only once the budget is spent -
    // at which point the message becomes a VISIBLE abandoned fact rather than a row that
    // sits in `delivering` forever looking like it is about to succeed.
    const attempts = Number(row.attempts) + 1;
    if (attempts >= RETRY_BUDGET) {
      await db().query(
        `update outbox
            set state = 'abandoned', attempts = $2,
                last_error = coalesce(last_error, 'no delivery event after ' || $2 || ' checks')
          where id = $1`,
        [row.id, attempts],
      );
      report.abandoned++;
    } else {
      await db().query(
        `update outbox set attempts = $2, next_retry_at = now() + interval '10 minutes'
          where id = $1`,
        [row.id, attempts],
      );
      report.still_in_flight++;
    }
  }

  return report;
}
