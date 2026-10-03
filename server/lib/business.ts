/**
 * business.ts — the admin runs the business the site brings in (§4 of the final session).
 *
 * Reads, mostly, over rows other modules write — and three writers that did not exist:
 *   - scheduleJob: the day a custom job is booked for (migration 043 `quotes.scheduled_for`);
 *   - recordManualPayment: cash, Venmo, Zelle or a check, as `payments.kind = 'manual'` — allowed
 *     since migration 001 and never written. No AMTECH fee: the fee report (growth.ts) sums
 *     charge, deposit and refund only, so a manual row is outside it by construction;
 *   - (route days and bookable already have writers in onboarding.ts; the Areas screen uses them).
 *
 * A JOB'S STAGE IS DERIVED, NEVER STORED. It is a function of dates the payment and completion
 * paths already write, so it cannot disagree with them:
 *   deposit_due   approved, a deposit asked for, not paid
 *   to_schedule   approved and paid what was asked up front, no day booked, not done
 *   scheduled     a day is booked, not done
 *   balance_owed  done, and money is still owed
 *   done          done and paid in full
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import { photoUrl } from './photos.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class BusinessError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'business_error') { super(message); this.status = status; this.code = code; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const JOB_STAGES = ['deposit_due', 'to_schedule', 'scheduled', 'balance_owed', 'done'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** The stage SQL, one place, so the list and the counts cannot use different rules. */
const STAGE_SQL = `
  case
    when qt.completed_at is not null and (qt.balance_paid_at is not null or coalesce(qt.total_cents, 0) - coalesce(case when qt.deposit_paid_at is not null then qt.deposit_cents end, 0) - coalesce(manual.paid, 0) <= 0) then 'done'
    when qt.completed_at is not null then 'balance_owed'
    when coalesce(qt.deposit_cents, 0) > 0 and qt.deposit_paid_at is null then 'deposit_due'
    when qt.scheduled_for is null then 'to_schedule'
    else 'scheduled'
  end`;

const JOB_SELECT = `
  select qt.id, qt.number, qt.title, qt.state, qt.total_cents, qt.deposit_cents, qt.deposit_paid_at, qt.accepted_at,
         qt.scheduled_for::text as scheduled_for, qt.completed_at, qt.balance_paid_at, qt.approx_start, qt.customer_id,
         l.name, l.phone, l.city, l.address,
         coalesce(manual.paid, 0)::int as manual_paid_cents,
         greatest(coalesce(qt.total_cents, 0) - coalesce(case when qt.deposit_paid_at is not null then qt.deposit_cents end, 0)
                  - case when qt.balance_paid_at is not null then coalesce(qt.total_cents, 0) else 0 end - coalesce(manual.paid, 0), 0)::int as owed_cents,
         ${STAGE_SQL} as stage
    from quotes qt
    join leads l on l.id = qt.lead_id
    left join lateral (
      select sum(p.amount_cents) as paid from payments p
       where p.kind = 'manual' and p.state = 'succeeded' and p.quote_id = qt.id
    ) manual on true
   where qt.state = 'accepted'`;

export async function listJobs(q: Queryable = db()) {
  const { rows } = await q.query(`${JOB_SELECT} order by qt.scheduled_for nulls last, qt.accepted_at`);
  const counts = Object.fromEntries(JOB_STAGES.map((s) => [s, rows.filter((r: any) => r.stage === s).length]));
  return { jobs: rows, counts };
}

export async function scheduleJob(q: Queryable, quoteId: string, date: string | null, by: string) {
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BusinessError('Pick a day for the job.', 400, 'bad_date');
  if (!UUID.test(quoteId)) throw new BusinessError('No such job.', 404, 'not_found');
  const { rows: [qt] } = await q.query(`select id, state, completed_at, scheduled_for::text as was from quotes where id = $1`, [quoteId]);
  if (!qt) throw new BusinessError('No such job.', 404, 'not_found');
  if (qt.state !== 'accepted') throw new BusinessError('Only an approved quote is a job that can be booked.', 409, 'not_accepted');
  if (qt.completed_at) throw new BusinessError('This job is already done.', 409, 'done');
  await q.query(`update quotes set scheduled_for = $2::date, updated_at = now() where id = $1`, [quoteId, date]);
  await appendEvent(q as never, { subjectKind: 'quote', subjectId: quoteId, type: 'quote.scheduled', actorKind: 'owner', payload: { by, was: qt.was, now: date } });
  const { rows: [job] } = await q.query(`${JOB_SELECT} and qt.id = $1`, [quoteId]);
  return job;
}

export const MANUAL_METHODS = ['cash', 'venmo', 'zelle', 'check', 'other'] as const;

/**
 * Cash, Venmo, Zelle or a check, written down. A new `payments` row (append only, like every
 * payment), no fee, `recorded_by` the owner. Against a quote job it says so in the note ("quote
 * #1101"), which is how the Jobs screen counts it towards the balance; against an open invoice it
 * marks that invoice paid when it covers it.
 */
export async function recordManualPayment(q: Queryable, input: {
  customer_id: string; amount_cents: number; method: string; note?: string; quote_id?: string | null; invoice_id?: string | null; paid_on?: string | null;
}, by: string) {
  const amount = Number(input.amount_cents);
  if (!Number.isInteger(amount) || amount <= 0) throw new BusinessError('Enter the amount you were paid, above zero.', 400, 'bad_amount');
  if (amount > 5_000_000) throw new BusinessError('That is more than $50,000. Check the amount.', 400, 'too_large');
  if (!(MANUAL_METHODS as readonly string[]).includes(input.method)) throw new BusinessError('Say how you were paid: cash, Venmo, Zelle, a check or other.', 400, 'bad_method');
  if (!UUID.test(input.customer_id) || (input.quote_id && !UUID.test(input.quote_id)) || (input.invoice_id && !UUID.test(input.invoice_id))) {
    throw new BusinessError('No such customer, job or invoice.', 404, 'not_found');
  }
  const { rows: [cu] } = await q.query(`select id, name from customers where id = $1 and deleted_at is null`, [input.customer_id]);
  if (!cu) throw new BusinessError('No such customer.', 404, 'not_found');
  let note = String(input.note ?? '').trim().slice(0, 300);
  let invoiceId: string | null = null;
  if (input.quote_id) {
    const { rows: [qt] } = await q.query(`select id, number, customer_id from quotes where id = $1`, [input.quote_id]);
    if (!qt || qt.customer_id !== cu.id) throw new BusinessError('That job is not this customer\'s.', 400, 'wrong_job');
  }
  if (input.invoice_id) {
    const { rows: [inv] } = await q.query(`select id, customer_id, state, total_cents from invoices where id = $1`, [input.invoice_id]);
    if (!inv || inv.customer_id !== cu.id) throw new BusinessError('That invoice is not this customer\'s.', 400, 'wrong_invoice');
    if (inv.state !== 'open') throw new BusinessError('That invoice is not open.', 409, 'invoice_not_open');
    invoiceId = inv.id;
  }
  const paidOn = input.paid_on && /^\d{4}-\d{2}-\d{2}$/.test(input.paid_on) ? input.paid_on : null;
  const { rows: [pay] } = await q.query(
    `insert into payments (customer_id, invoice_id, quote_id, kind, amount_cents, currency, platform_fee_cents, state, method, note, recorded_by, created_at)
     values ($1, $2, $3, 'manual', $4, 'usd', 0, 'succeeded', $5, $6, $7, coalesce($8::date::timestamptz + interval '12 hours', now())) returning *`,
    [cu.id, invoiceId, input.quote_id ?? null, amount, input.method, note, by, paidOn]);
  if (invoiceId) {
    await q.query(
      `update invoices set state = 'paid', paid_at = now(), collection_method = 'offline'
        where id = $1 and state = 'open'
          and total_cents <= (select coalesce(sum(amount_cents), 0) from payments where invoice_id = $1 and state = 'succeeded')`, [invoiceId]);
  }
  if (input.quote_id) {
    // Settle the job if this covers what is owed. Owed is derived the same way the Jobs screen does.
    const { rows: [job] } = await q.query(`${JOB_SELECT} and qt.id = $1`, [input.quote_id]);
    if (job && job.owed_cents === 0 && job.completed_at && !job.balance_paid_at) {
      await q.query(`update quotes set balance_paid_at = now(), updated_at = now() where id = $1`, [input.quote_id]);
    }
    await appendEvent(q as never, { subjectKind: 'quote', subjectId: input.quote_id, type: 'quote.manual_payment', actorKind: 'owner', payload: { by, amount, method: input.method, payment: pay.id } });
  }
  await appendEvent(q as never, { subjectKind: 'payment', subjectId: pay.id, type: 'payment.recorded', to: 'succeeded', actorKind: 'owner', payload: { by, amount, method: input.method, customer: cu.id } });
  return pay;
}

export async function customerDetail(q: Queryable, id: string) {
  if (!UUID.test(id)) throw new BusinessError('No such customer.', 404, 'not_found');
  const { rows: [customer] } = await q.query(`select id, name, phone, email, notes, preferred_payment, created_at from customers where id = $1 and deleted_at is null`, [id]);
  if (!customer) throw new BusinessError('No such customer.', 404, 'not_found');
  const [properties, subscriptions, jobs, payments, invoices, photos, messages, leads] = await Promise.all([
    q.query(`select id, address, city, postal_code, yard_size, num_dogs, gate_code, access_notes from properties where customer_id = $1 and deleted_at is null order by created_at`, [id]),
    q.query(`select s.id, s.service_slug, sv.name as service_name, s.state, s.payment_state, s.frequency, s.service_weekday, s.starts_on::text as starts_on,
                    s.paused_from::text as paused_from, s.paused_until::text as paused_until, s.monthly_price_cents, s.price_cents, s.price_tier_label,
                    s.discount, s.area_slug, s.source, s.created_at, s.cancelled_at,
                    (select count(*)::int from visits v where v.subscription_id = s.id and v.state = 'completed') as visits_done,
                    (select min(v.scheduled_for)::text from visits v where v.subscription_id = s.id and v.scheduled_for >= current_date and v.state in ('scheduled', 'assigned', 'en_route')) as next_visit
               from subscriptions s left join services sv on sv.slug = s.service_slug
              where s.customer_id = $1 and s.service_slug <> 'custom-job' order by s.created_at desc`, [id]),
    q.query(`${JOB_SELECT} and qt.customer_id = $1 order by qt.accepted_at desc`, [id]),
    q.query(`select id, kind, amount_cents, platform_fee_cents, state, method, note, recorded_by, invoice_id, quote_id, livemode, created_at from payments where customer_id = $1 order by created_at desc limit 100`, [id]),
    q.query(`select id, state, total_cents, issued_at, paid_at, period_start::text as period_start, period_end::text as period_end, hosted_invoice_url from invoices where customer_id = $1 order by coalesce(issued_at, created_at) desc limit 50`, [id]),
    q.query(`select ph.id, ph.created_at, v.scheduled_for::text as visit_day from visit_photos ph join visits v on v.id = ph.visit_id join subscriptions s on s.id = v.subscription_id
              where s.customer_id = $1 order by ph.created_at desc limit 24`, [id]),
    q.query(`select id, direction, channel, author_kind, body, created_at, read_at from messages where customer_id = $1 order by created_at desc limit 50`, [id]),
    q.query(`select id, created_at, status, kind, notes from leads where customer_id = $1 or (phone = $2 and $2 <> '') order by created_at desc limit 10`, [id, customer.phone ?? '']),
  ]);
  const paid = payments.rows.filter((p: any) => p.state === 'succeeded').reduce((n: number, p: any) => n + p.amount_cents, 0);
  return {
    customer, properties: properties.rows, subscriptions: subscriptions.rows, jobs: jobs.rows, payments: payments.rows,
    invoices: invoices.rows, messages: messages.rows, leads: leads.rows,
    photos: photos.rows.map((p: any) => ({ ...p, url: `/api/photo/${p.id}`, abs: photoUrl(p.id) })),
    totals: { paid_cents: paid, open_invoices: invoices.rows.filter((i: any) => i.state === 'open').length },
  };
}

/** The week ahead: every visit and every booked custom job, by day. */
export async function week(q: Queryable = db(), from?: string) {
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const { rows: visits } = await q.query(
    `select v.id, v.scheduled_for::text as day, v.state, v.completed_at, v.charge_cents,
            c.id as customer_id, c.name, p.address, p.city, s.service_slug, sv.name as service_name, a.name as area_name,
            (select count(*)::int from visit_photos ph where ph.visit_id = v.id) as photos
       from visits v
       join subscriptions s on s.id = v.subscription_id
       join customers c on c.id = s.customer_id
       join properties p on p.id = v.property_id
       left join services sv on sv.slug = s.service_slug
       left join service_areas a on a.slug = s.area_slug
      where v.scheduled_for between coalesce($1::date, current_date) and coalesce($1::date, current_date) + 6
        and v.state not in ('cancelled', 'rescheduled') and c.name not like 'DEMO—%'
      order by v.scheduled_for, a.name, p.address`, [start]);
  const { rows: jobs } = await q.query(
    `${JOB_SELECT} and qt.scheduled_for between coalesce($1::date, current_date) and coalesce($1::date, current_date) + 6 order by qt.scheduled_for`, [start]);
  const { rows: [{ d }] } = await q.query(`select coalesce($1::date, current_date)::text as d`, [start]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.parse(`${d}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    return { day, visits: visits.filter((v: any) => v.day === day), jobs: jobs.filter((j: any) => j.scheduled_for === day) };
  });
  return { from: d, days };
}

export async function visitDetail(q: Queryable, id: string) {
  if (!UUID.test(id)) throw new BusinessError('No such visit.', 404, 'not_found');
  const { rows: [v] } = await q.query(
    `select v.id, v.scheduled_for::text as day, v.state, v.en_route_at, v.arrived_at, v.completed_at, v.crew_notes, v.customer_note,
            v.charge_cents, v.chargeable, t.name as completed_by_name,
            c.id as customer_id, c.name, c.phone, p.address, p.city, p.gate_code, p.access_notes, p.num_dogs, p.yard_size,
            s.id as subscription_id, s.service_slug, sv.name as service_name, s.state as subscription_state
       from visits v
       join subscriptions s on s.id = v.subscription_id
       join customers c on c.id = s.customer_id
       join properties p on p.id = v.property_id
       left join services sv on sv.slug = s.service_slug
       left join team_members t on t.id = v.completed_by
      where v.id = $1`, [id]);
  if (!v) throw new BusinessError('No such visit.', 404, 'not_found');
  const { rows: photos } = await q.query(`select id, created_at from visit_photos where visit_id = $1 order by created_at`, [id]);
  return { visit: v, photos: photos.map((p: any) => ({ ...p, url: `/api/photo/${p.id}` })) };
}

export const INVOICE_STATES = ['open', 'paid', 'uncollectible', 'void', 'draft'] as const;

export async function invoicesByState(q: Queryable = db()) {
  const { rows } = await q.query(
    `select i.id, i.state, i.total_cents, i.platform_fee_cents, i.issued_at, i.paid_at, i.collection_method, i.hosted_invoice_url,
            i.period_start::text as period_start, i.period_end::text as period_end, i.livemode,
            c.id as customer_id, c.name,
            (select string_agg(l.description, '; ') from invoice_lines l where l.invoice_id = i.id) as lines
       from invoices i join customers c on c.id = i.customer_id
      where c.name not like 'DEMO—%'
      order by coalesce(i.issued_at, i.created_at) desc limit 300`);
  const counts = Object.fromEntries(INVOICE_STATES.map((s) => [s, rows.filter((r: any) => r.state === s).length]));
  const owed = rows.filter((r: any) => r.state === 'open').reduce((n: number, r: any) => n + r.total_cents, 0);
  return { invoices: rows, counts, owed_cents: owed };
}
