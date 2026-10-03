/**
 * daily.ts — what has to happen on a date, whether or not anybody opens a screen.
 *
 * Until 2026-09-30 every one of these ran "when somebody reads": a due pause came back when a
 * customer or Josue opened a page, a quote expired when somebody looked at it, the card-expiry and
 * review sweeps and photo retention ran when Josue opened his board. If he did not open it, nothing
 * happened. Now one route runs them all once a day (api/cron.ts, a Vercel cron in vercel.json), and
 * the owner can run it on demand from the admin. The on-read calls stay: they cost nothing and make
 * a page accurate between runs.
 *
 * THE STEPS, each caught on its own so one failure cannot stop the rest, and each returning what
 * it changed — which is how gates/daily.mjs proves it by calling it and reading the rows:
 *   pauses            a pause past its end resumes (account.ts expireDuePauses)
 *   quote_expiry      a sent quote past its valid_until date expires, on Ventura's calendar
 *   quote_follow_ups  a quote opened two days ago and not approved goes on Josue's list with a
 *                     prefilled text, and he gets one email naming them. There is no SMS transport,
 *                     so the text is a link that opens his own phone's Messages with it written.
 *   job_review        a custom job done and paid gets the review ask, once per customer
 *   comms             card expiring, review requests after N visits, photo retention (comms.ts)
 *
 * The run is recorded in `settings.daily.last_run` so the admin can say when it last ran and what
 * it did — a job that runs silently is indistinguishable from one that does not run.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { expireDuePauses } from './account.js';
import { runCommsSweeps, sendCustomJobReviewRequests } from './comms.js';
import { sendEmail } from './notify.js';
import { safeError } from './http.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const FOLLOW_UP_AFTER_DAYS = 2;

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const first = (name: string) => name.replace(/^DEMO—/, '').trim().split(/\s+/)[0] || name;
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}`;
export const smsHref = (phone: string, body: string) => {
  const digits = String(phone).replace(/[^\d]/g, '').replace(/^1?(\d{10})$/, '+1$1');
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
};

/** Every sent quote past its date, expired in one pass. Same rule as quotes.ts expireIfDue. */
export async function expireDueQuotes(q: Queryable = db()) {
  const { rows } = await q.query(
    `update quotes set state = 'expired', updated_at = now()
      where state = 'sent' and valid_until < (now() at time zone 'America/Los_Angeles')::date
      returning id, subscription_id, number`);
  for (const r of rows) {
    if (r.subscription_id) {
      await q.query(`update subscriptions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'quote expired', updated_at = now()
                      where id = $1 and state = 'quote_ready'`, [r.subscription_id]);
    }
    await appendEvent(q as never, { subjectKind: 'quote', subjectId: r.id, type: 'quote.expired', from: 'sent', to: 'expired', actorKind: 'system', payload: { by: 'daily' } });
  }
  return { expired: rows.length, numbers: rows.map((r: any) => r.number) };
}

/** Quotes a customer opened FOLLOW_UP_AFTER_DAYS ago and has not approved, not yet on the list. */
export async function quoteFollowUps(q: Queryable = db(), base = 'https://scoopdogg.net', { email = true } = {}) {
  const { rows } = await q.query(
    `select qt.id, qt.number, qt.title, qt.total_cents, qt.first_viewed_at, qt.view_count, l.name, l.phone, l.request_token
       from quotes qt join leads l on l.id = qt.lead_id
      where qt.state = 'sent' and qt.first_viewed_at is not null
        and qt.first_viewed_at <= now() - ($1 || ' days')::interval
        and not exists (select 1 from events e where e.subject_kind = 'quote' and e.subject_id = qt.id and e.event_type = 'quote.follow_up_due')
      order by qt.first_viewed_at`, [String(FOLLOW_UP_AFTER_DAYS)]);
  const due = rows.map((r: any) => {
    const text = `Hi ${first(r.name)}, it's Josue from Scoop Dogg. Any questions on the quote for ${r.title || 'the job'}? Happy to walk you through it. ${base}/quote/${r.request_token}`;
    return { ...r, text, sms_href: smsHref(r.phone, text) };
  });
  for (const r of due) {
    await appendEvent(q as never, { subjectKind: 'quote', subjectId: r.id, type: 'quote.follow_up_due', actorKind: 'system', payload: { text: r.text, views: r.view_count } });
  }
  let emailed = false;
  if (email && due.length) {
    const r = await sendEmail({
      purpose: 'quote_follow_up',
      recipients: { settingKey: 'notify.lead_recipients' },
      fromName: 'Scoop Dogg',
      subject: `${due.length} quote${due.length === 1 ? '' : 's'} opened and not approved yet`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;font-size:16px;line-height:1.6">
        <p>${due.length === 1 ? 'This customer' : 'These customers'} opened ${due.length === 1 ? 'a quote' : 'their quotes'} ${FOLLOW_UP_AFTER_DAYS} or more days ago and ${due.length === 1 ? 'has' : 'have'} not approved yet. A short text usually settles it — tap one to open it in Messages, already written.</p>
        <ul>${due.map((d) => `<li><a href="${esc(d.sms_href)}">Text ${esc(d.name.replace(/^DEMO—/, ''))}</a> — quote #${d.number}, ${money(d.total_cents ?? 0)}</li>`).join('')}</ul>
        <p><a href="${base}/admin/quotes">Open your quotes</a></p></div>`,
    }).catch(() => null);
    emailed = !!r && r.state !== 'failed';
  }
  return { due: due.length, emailed, numbers: due.map((d) => d.number) };
}

/** Josue's list: follow-ups due and not yet marked done, still open. */
export async function nudgeList(q: Queryable = db(), base = 'https://scoopdogg.net') {
  const { rows } = await q.query(
    `select qt.id, qt.number, qt.title, qt.total_cents, qt.first_viewed_at, qt.view_count, l.name, l.phone, l.request_token,
            (select e.payload->>'text' from events e where e.subject_kind = 'quote' and e.subject_id = qt.id and e.event_type = 'quote.follow_up_due' order by e.seq desc limit 1) as text
       from quotes qt join leads l on l.id = qt.lead_id
      where qt.state = 'sent'
        and exists (select 1 from events e where e.subject_kind = 'quote' and e.subject_id = qt.id and e.event_type = 'quote.follow_up_due')
        and not exists (select 1 from events e where e.subject_kind = 'quote' and e.subject_id = qt.id and e.event_type = 'quote.nudged')
      order by qt.first_viewed_at`);
  return rows.map((r: any) => {
    const text = r.text ?? `Hi ${first(r.name)}, it's Josue from Scoop Dogg. Any questions on the quote? ${base}/quote/${r.request_token}`;
    return { ...r, text, sms_href: smsHref(r.phone, text) };
  });
}

export async function markNudged(q: Queryable, quoteId: string, by: string) {
  await appendEvent(q as never, { subjectKind: 'quote', subjectId: quoteId, type: 'quote.nudged', actorKind: 'owner', payload: { by } });
}

type Step = [string, () => Promise<unknown>];

export async function runDaily(opts: { base?: string; by: string }) {
  const base = opts.base ?? 'https://scoopdogg.net';
  const started = new Date();
  const out: Record<string, unknown> = {};
  const steps: Step[] = [
    ['pauses', () => expireDuePauses()],
    ['quote_expiry', () => expireDueQuotes()],
    ['quote_follow_ups', () => quoteFollowUps(db(), base)],
    ['job_review', () => sendCustomJobReviewRequests()],
    ['comms', () => runCommsSweeps()],
  ];
  for (const [name, fn] of steps) {
    try { out[name] = (await fn()) ?? { ok: true }; }
    catch (e) { safeError(`daily:${name}`, e); out[name] = { error: true }; }
  }
  const record = { at: started.toISOString(), by: opts.by, ms: Date.now() - started.getTime(), results: out };
  await db().query(
    `insert into settings (key, value, updated_by) values ('daily.last_run', $1::jsonb, $2)
       on conflict (key) do update set value = excluded.value, updated_by = $2, updated_at = now()`,
    [JSON.stringify(record), opts.by]).catch((e) => safeError('daily:record', e));
  return record;
}
