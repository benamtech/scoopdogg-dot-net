/**
 * quotes.ts — a particular job, from "here is my yard" to the balance being paid. The only place
 * that moves a quote from one state to the next.
 *
 * THE PATH (R21, migration 042):
 *   requestQuote     the customer describes the job; a lead with a capability token
 *   addRequestPhoto  their photos, against that lead
 *   finishRequest    Josue is told, once, with the photos
 *   draftQuote / saveQuote     Josue prices it: lines, optional lines, the one switch, the deposit
 *   sendQuote        the job becomes a subscription row in 'quote_ready'; the customer gets a link
 *   viewQuote        every open is counted — R21 says his own numbers are the only ones that matter
 *   acceptQuote      'quote_accepted', then 'deposit_pending' with a Stripe Checkout that saves the card
 *   confirmQuotePayment   the deposit (or balance) is in the books with the fee Stripe took
 *   completeQuoteJob the balance: the saved card with one tap, or a link he texts
 *   declineQuote / withdrawQuote / reviseQuote / refundQuoteDeposit
 *
 * EVERY FUNCTION TAKES ITS QUERY CLIENT. The API passes the pool and each multi-row change runs in
 * its own transaction; `gates/quote-rail.mjs` passes a client inside a transaction it rolls back,
 * and so exercises this file rather than a copy of it.
 *
 * WHAT IT WILL NOT DO: send an install contract without the facts the law puts on it (the licence
 * number and three others — `contractGaps()`), or take a deposit on one above California's cap.
 * Both are the owner's protection, and both are said to him in one sentence, not a 500.
 */
import { randomBytes, createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { resolve, currentMode, type StripeMode } from './stripe.js';
import { chargeOnce, chargeSavedCard, refund } from './money.js';
import { appendEvent } from './events.js';
import { sendEmail } from './notify.js';
import { paymentsReady, stripeCustomer } from './booking.js';
import { photoUrl } from './photos.js';
import {
  quoteTotals, depositFor, needsLicence, needsWrittenContract, acceptanceTerms, money, type QuoteLine, type DepositMode,
} from '../../src/shared/quote-math.js';
import { JOB_KIND_IDS, jobKindLabel, looksLikeImprovement, contractGaps, type ContractFacts, type CglFact } from '../../src/shared/quote-contract.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class QuoteError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'quote_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isPool = (q: Queryable) => typeof (q as { totalCount?: unknown }).totalCount === 'number';

/** Run `fn` in a transaction: its own when given the pool, the caller's when given a client. */
async function inTx<T>(q: Queryable, fn: (c: Queryable) => Promise<T>): Promise<T> {
  if (!isPool(q)) return fn(q);
  const c = await (q as unknown as { connect: () => Promise<Queryable & { release: () => void }> }).connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const digits = (s: string) => s.replace(/\D/g, '');
const smsHref = (phone: string, body: string) => {
  const d = digits(phone);
  return d.length >= 10 ? `sms:+1${d.slice(-10)}?&body=${encodeURIComponent(body)}` : null;
};
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Settings = Map<string, unknown>;
/**
 * The settings this file reads, through the caller's own client. Not loadCatalog(): that reads the
 * pool, so a gate inside a transaction could not try "with a licence number" and "without" — and a
 * check that can only see one of its two branches is half a check.
 */
async function settings(q: Queryable): Promise<Settings> {
  const { rows } = await q.query(
    `select key, value from settings where key like 'quote.%' or key like 'contract.%' or key like 'business.%'`);
  return new Map(rows.map((r) => [r.key as string, r.value as unknown]));
}
const setting = (s: Settings, k: string, fallback: unknown = null) => (s.has(k) && s.get(k) !== null ? s.get(k) : fallback);

export function contractFacts(s: Settings): ContractFacts {
  const text = (k: string) => { const v = s.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null; };
  const cgl = s.get('contract.cgl');
  const wc = s.get('contract.workers_comp');
  return {
    legalName: text('business.legal_name'),
    licenceNumber: text('business.license_number'),
    licenceClass: text('business.license_class'),
    mailingAddress: text('business.mailing_address'),
    email: text('business.email'),
    phone: text('business.phone'),
    cgl: cgl && typeof cgl === 'object' && 'mode' in (cgl as object) ? cgl as CglFact : null,
    workersComp: wc === 'exempt' || wc === 'carries' ? wc : null,
  };
}

// ─────────────────────────────────────────────────────────────── the request

export type QuoteRequestInput = {
  name: string; phone: string; email: string; address: string; city: string;
  job_kinds: string[]; description: string; timing?: string | null; contact_pref?: string | null;
  source_page?: string; service_slug?: string; photos_expected?: number;
};

export async function requestQuote(q: Queryable, raw: Record<string, unknown>, demo = false): Promise<{ leadId: string; token: string }> {
  const input: QuoteRequestInput = {
    name: str(raw.name, 120), phone: str(raw.phone, 40), email: str(raw.email, 200),
    address: str(raw.address, 300), city: str(raw.city, 80),
    job_kinds: Array.isArray(raw.job_kinds) ? raw.job_kinds.map((k) => String(k)).filter((k) => JOB_KIND_IDS.includes(k)).slice(0, 8) : [],
    description: str(raw.description, 4000),
    timing: ['asap', 'month', 'flexible'].includes(String(raw.timing)) ? String(raw.timing) : null,
    contact_pref: ['text', 'call', 'email'].includes(String(raw.contact_pref)) ? String(raw.contact_pref) : null,
    source_page: str(raw.source_page, 300), service_slug: str(raw.service_slug, 60),
  };
  if (!input.name || !input.phone || !input.email) throw new QuoteError('Please give your name, phone and email so Josue can reach you.', 400, 'contact_required');
  if (!input.email.includes('@')) throw new QuoteError('That email address does not look right.', 400, 'bad_email');
  if (digits(input.phone).length < 10) throw new QuoteError('Please give a phone number Josue can text.', 400, 'bad_phone');
  if (!input.description && input.job_kinds.length === 0) throw new QuoteError('Tell Josue a little about the job.', 400, 'describe_the_job');
  if (!input.address && !input.city) throw new QuoteError('Where is the job? An address or a city is enough.', 400, 'where_required');
  const postal = /\b(9\d{4})\b/.exec(`${input.address} ${input.city}`)?.[1] ?? null;
  const token = randomBytes(24).toString('base64url');
  const name = demo ? `DEMO—${input.name}` : input.name;
  const { rows: [lead] } = await q.query(
    `insert into leads (id, name, phone, email, address, city, service_slug, notes, source_page, status, created_at,
                        kind, job_kinds, timing, contact_pref, postal_code, request_token)
     values (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,'new', now(), 'custom', $9::text[], $10, $11, $12, $13) returning id`,
    [name, input.phone, input.email, input.address, input.city || postal || input.address, input.service_slug || 'custom-quote',
     input.description, input.source_page, input.job_kinds, input.timing, input.contact_pref, postal, token]);
  await appendEvent(q as never, {
    subjectKind: 'lead', subjectId: lead.id, type: 'quote.requested', actorKind: 'customer',
    payload: { job_kinds: input.job_kinds, timing: input.timing, photos_expected: Number(raw.photos_expected ?? 0) || 0 },
  });
  return { leadId: lead.id, token };
}

async function leadByToken(q: Queryable, token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const { rows: [lead] } = await q.query(`select * from leads where request_token = $1`, [token]);
  return lead ?? null;
}

export async function addRequestPhoto(q: Queryable, token: string, bytes: Buffer, mime: string) {
  const lead = await leadByToken(q, token);
  if (!lead) throw new QuoteError('That request link is not recognised.', 404, 'not_found');
  if (!['image/jpeg', 'image/webp', 'image/png'].includes(mime)) throw new QuoteError('A photo must be a JPEG, WebP or PNG.', 415, 'bad_mime');
  const s = await settings(q);
  const max = Number(setting(s, 'quote.photos_max', 6));
  const maxBytes = Number(setting(s, 'quote.photo_max_bytes', 900_000));
  if (!bytes.length) throw new QuoteError('That file is empty.', 400, 'empty');
  if (bytes.length > maxBytes) throw new QuoteError(`That photo is too large (${Math.round(bytes.length / 1000)}KB; the limit is ${Math.round(maxBytes / 1000)}KB).`, 413, 'too_big');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const { rows: [dupe] } = await q.query(`select id from lead_photos where lead_id = $1 and sha256 = $2`, [lead.id, sha]);
  if (dupe) return { id: dupe.id as string, url: photoUrl(dupe.id), deduped: true };
  const { rows: [{ n }] } = await q.query(`select count(*)::int as n from lead_photos where lead_id = $1`, [lead.id]);
  if (n >= max) throw new QuoteError(`That is the ${max}-photo limit for one request.`, 409, 'too_many');
  const { rows: [row] } = await q.query(
    `insert into lead_photos (lead_id, bytes, mime, byte_size, sha256) values ($1,$2,$3,$4,$5) returning id`,
    [lead.id, bytes, mime, bytes.length, sha]);
  return { id: row.id as string, url: photoUrl(row.id), deduped: false };
}

export async function leadPhotos(q: Queryable, leadId: string) {
  const { rows } = await q.query(`select id, byte_size, created_at from lead_photos where lead_id = $1 order by created_at`, [leadId]);
  return rows.map((r) => ({ id: r.id as string, url: photoUrl(r.id), bytes: r.byte_size as number }));
}

/** Tell Josue, once, with the photos. Idempotent on the lead's own event history. */
export async function finishRequest(q: Queryable, token: string, base: string): Promise<{ notified: boolean }> {
  const lead = await leadByToken(q, token);
  if (!lead) throw new QuoteError('That request link is not recognised.', 404, 'not_found');
  const { rows: [done] } = await q.query(
    `select 1 from events where subject_kind = 'lead' and subject_id = $1 and event_type = 'quote.request_notified' limit 1`, [lead.id]);
  if (done) return { notified: false };
  const photos = await leadPhotos(q, lead.id);
  const s = await settings(q);
  const reply = String(setting(s, 'quote.reply_promise', 'within one business day'));
  const kinds = (lead.job_kinds as string[]).map(jobKindLabel);
  const road = await roadLegFor(q, lead.postal_code);
  const row = (k: string, v: string) => `<tr><td style="padding:6px 12px;color:#666;vertical-align:top">${k}</td><td style="padding:6px 12px;font-weight:600">${v || '—'}</td></tr>`;
  await sendEmail({
    purpose: 'quote_request',
    recipients: { settingKey: 'notify.lead_recipients' },
    ccSettingKey: 'notify.lead_cc',
    fromName: 'Scoop Dogg Leads',
    replyTo: lead.email,
    subject: `Custom quote request: ${lead.name} — ${kinds[0] ?? 'a particular job'}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px">
      <h2 style="color:#1B4332">A custom job, from scoopdogg.net</h2>
      <table style="width:100%;border-collapse:collapse;background:#f9f8f5">
        ${row('Name', esc(lead.name))}${row('Phone', esc(lead.phone))}${row('Email', esc(lead.email))}
        ${row('Where', esc([lead.address, lead.city].filter(Boolean).join(', ')))}
        ${road ? row('From Ventura', `${road.place ?? ''} · ${road.miles} mi, about ${road.minutes} min each way`) : ''}
        ${row('What', esc(kinds.join(', ')))}
        ${row('When', lead.timing === 'asap' ? 'As soon as possible' : lead.timing === 'month' ? 'Within a month' : lead.timing === 'flexible' ? 'Flexible' : '')}
        ${row('Prefers', lead.contact_pref ?? '')}
      </table>
      ${lead.notes ? `<p style="white-space:pre-wrap;color:#333">${esc(lead.notes)}</p>` : ''}
      ${photos.length ? `<p>${photos.map((p) => `<a href="${p.url}"><img src="${p.url}" width="180" style="margin:4px;border-radius:6px"></a>`).join('')}</p>` : '<p style="color:#666">No photos sent.</p>'}
      <p><a href="${base}/admin/leads/${lead.id}" style="display:inline-block;background:#F4A024;color:#0F2A1F;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">Open it and build a quote</a></p>
      <p style="color:#666;font-size:13px">The customer was told you reply ${esc(reply)}.</p></div>`,
  }).catch(() => null);
  await sendEmail({
    purpose: 'quote_receipt',
    recipients: { explicit: [lead.email] },
    fromName: 'Scoop Dogg',
    subject: 'Josue has your job details',
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <p>Hi ${esc(firstName(lead.name))},</p>
      <p>Josue has your request${photos.length ? ` and your ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}. He reads every one himself and will reply ${esc(reply)}, usually by text from (805) 869-8070.</p>
      <p>What happens next: he may ask a question or stop by for a quick look, then he sends you a quote you can approve online. You can see where it is any time:</p>
      <p><a href="${base}/quote/${token}">${base}/quote/${token}</a></p></div>`,
  }).catch(() => null);
  await appendEvent(q as never, { subjectKind: 'lead', subjectId: lead.id, type: 'quote.request_notified', actorKind: 'system', payload: { photos: photos.length } });
  return { notified: true };
}

export async function roadLegFor(q: Queryable, postal: string | null) {
  if (!postal) return null;
  const { rows: [r] } = await q.query(
    `select place_name, road_miles, drive_minutes from postal_road_legs where postal_code = $1`, [postal]).catch(() => ({ rows: [] }));
  return r ? { place: r.place_name as string | null, miles: Math.round(Number(r.road_miles)), minutes: Math.round(Number(r.drive_minutes)) } : null;
}

// ─────────────────────────────────────────────────────────────── the owner prices it

export type QuoteRow = Record<string, any>;

async function linesOf(q: Queryable, quoteId: string): Promise<(QuoteLine & { chosen: boolean | null })[]> {
  const { rows } = await q.query(
    `select id, description, detail, amount_cents, optional, chosen from quote_lines where quote_id = $1 order by sort, created_at`, [quoteId]);
  return rows.map((r) => ({ id: r.id, description: r.description, detail: r.detail, amount_cents: r.amount_cents, optional: r.optional, chosen: r.chosen }));
}

export async function draftQuote(q: Queryable, leadId: string, by: string): Promise<QuoteRow> {
  const { rows: [lead] } = await q.query(`select * from leads where id = $1`, [leadId]);
  if (!lead) throw new QuoteError('No such lead.', 404, 'not_found');
  const { rows: [open] } = await q.query(`select * from quotes where lead_id = $1 and state = 'draft' order by created_at desc limit 1`, [leadId]);
  if (open) return open;
  if (!lead.request_token) {
    await q.query(`update leads set request_token = $2, kind = 'custom' where id = $1`, [leadId, randomBytes(24).toString('base64url')]);
  }
  const s = await settings(q);
  const kinds: string[] = lead.job_kinds ?? [];
  const { rows: [row] } = await q.query(
    `insert into quotes (lead_id, title, is_improvement, deposit_mode, deposit_percent, created_by)
     values ($1,$2,$3,'percent',$4,$5) returning *`,
    [leadId, kinds.length ? jobKindLabel(kinds[0]) : '', looksLikeImprovement(kinds),
     Number(setting(s, 'quote.deposit_percent', 25)), by]);
  return row;
}

export type QuotePatch = {
  title?: string; message?: string; is_improvement?: boolean;
  deposit_mode?: DepositMode; deposit_percent?: number | null; deposit_fixed_cents?: number | null;
  approx_start?: string; approx_completion?: string;
  lines?: { description: string; detail?: string; amount_cents: number; optional?: boolean }[];
};

export async function saveQuote(q: Queryable, quoteId: string, patch: QuotePatch, by: string): Promise<QuoteRow> {
  return inTx(q, async (c) => {
    const { rows: [qt] } = await c.query(`select * from quotes where id = $1 for update`, [quoteId]);
    if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
    if (qt.state !== 'draft') throw new QuoteError('A sent quote is not edited under the customer. Revise it instead — that withdraws this one and starts a copy.', 409, 'not_draft');
    const sets: string[] = []; const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (patch.title !== undefined) put('title', str(patch.title, 200));
    if (patch.message !== undefined) put('message', str(patch.message, 4000));
    if (patch.is_improvement !== undefined) put('is_improvement', Boolean(patch.is_improvement));
    if (patch.deposit_mode !== undefined) {
      if (!['percent', 'fixed', 'none'].includes(patch.deposit_mode)) throw new QuoteError('Unknown deposit rule.', 400, 'bad_deposit');
      put('deposit_mode', patch.deposit_mode);
    }
    if (patch.deposit_percent !== undefined) {
      const n = patch.deposit_percent === null ? null : Number(patch.deposit_percent);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100)) throw new QuoteError('A deposit percentage is a whole number from 0 to 100.', 400, 'bad_deposit');
      put('deposit_percent', n);
    }
    if (patch.deposit_fixed_cents !== undefined) {
      const n = patch.deposit_fixed_cents === null ? null : Number(patch.deposit_fixed_cents);
      if (n !== null && (!Number.isInteger(n) || n < 0)) throw new QuoteError('A deposit is a whole number of cents, not negative.', 400, 'bad_deposit');
      put('deposit_fixed_cents', n);
    }
    if (patch.approx_start !== undefined) put('approx_start', str(patch.approx_start, 120));
    if (patch.approx_completion !== undefined) put('approx_completion', str(patch.approx_completion, 120));
    if (sets.length) {
      vals.push(quoteId);
      await c.query(`update quotes set ${sets.join(', ')}, updated_at = now() where id = $${vals.length}`, vals);
    }
    if (patch.lines) {
      if (patch.lines.length > 40) throw new QuoteError('Forty lines is the most one quote holds.', 400, 'too_many_lines');
      for (const l of patch.lines) {
        const d = str(l.description, 300);
        const a = Number(l.amount_cents);
        if (!d) throw new QuoteError('Every line needs a description.', 400, 'line_needs_words');
        if (!Number.isInteger(a) || a < 0 || a > 10_000_000) throw new QuoteError(`"${d}" needs an amount between $0 and $100,000.`, 400, 'bad_amount');
      }
      await c.query(`delete from quote_lines where quote_id = $1`, [quoteId]);
      let i = 0;
      for (const l of patch.lines) {
        await c.query(
          `insert into quote_lines (quote_id, sort, description, detail, amount_cents, optional) values ($1,$2,$3,$4,$5,$6)`,
          [quoteId, i++, str(l.description, 300), str(l.detail ?? '', 1000), Number(l.amount_cents), Boolean(l.optional)]);
      }
    }
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: quoteId, type: 'quote.edited', actorKind: 'owner', payload: { by, fields: Object.keys(patch) } });
    const { rows: [fresh] } = await c.query(`select * from quotes where id = $1`, [quoteId]);
    return fresh;
  });
}

/**
 * Everything the builder shows, with the numbers the customer would see: the total with every
 * optional line and without, the deposit and whether the cap cut it, and what an install contract
 * still needs. The builder never computes these itself.
 */
export async function quoteForOwner(q: Queryable, quoteId: string) {
  const { rows: [qt] } = await q.query(`select * from quotes where id = $1`, [quoteId]);
  if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
  const { rows: [lead] } = await q.query(
    `select id, name, phone, email, address, city, postal_code, notes, job_kinds, timing, contact_pref, request_token, created_at, first_response_at
       from leads where id = $1`, [qt.lead_id]);
  const lines = await linesOf(q, quoteId);
  const s = await settings(q);
  const facts = contractFacts(s);
  const withAll = quoteTotals(lines, lines.filter((l) => l.optional).map((l) => l.id));
  const base = quoteTotals(lines);
  const rule = { mode: qt.deposit_mode as DepositMode, percent: qt.deposit_percent, fixedCents: qt.deposit_fixed_cents };
  const { rows: events } = await q.query(
    `select event_type, created_at, payload from events where subject_kind = 'quote' and subject_id = $1 order by seq`, [quoteId]);
  return {
    quote: qt, lines, lead, photos: await leadPhotos(q, qt.lead_id), road: await roadLegFor(q, lead?.postal_code ?? null),
    numbers: {
      required: base.required, optionalAvailable: withAll.optionalAvailable,
      depositOnRequired: depositFor(base.total, rule, qt.is_improvement),
      depositWithAll: depositFor(withAll.total, rule, qt.is_improvement),
    },
    contract: {
      writtenContract: needsWrittenContract(qt.is_improvement, withAll.total),
      licenceNeeded: needsLicence(qt.is_improvement, withAll.total),
      gaps: needsWrittenContract(qt.is_improvement, withAll.total) ? contractGaps(facts) : [],
    },
    events,
    link: lead?.request_token ? `/quote/${lead.request_token}` : null,
  };
}

export async function listQuotes(q: Queryable) {
  const { rows } = await q.query(
    `select qt.id, qt.number, qt.state, qt.title, qt.sent_at, qt.first_viewed_at, qt.view_count, qt.accepted_at, qt.total_cents,
            qt.deposit_cents, qt.deposit_paid_at, qt.completed_at, qt.balance_paid_at, qt.valid_until, qt.is_improvement,
            l.id as lead_id, l.name, l.city, l.phone,
            (select coalesce(sum(amount_cents), 0)::int from quote_lines x where x.quote_id = qt.id and not x.optional) as required_cents
       from quotes qt join leads l on l.id = qt.lead_id
      order by coalesce(qt.sent_at, qt.created_at) desc limit 200`);
  return rows;
}

// ─────────────────────────────────────────────────────────────── sending

export async function sendQuote(q: Queryable, quoteId: string, opts: { by: string; base: string; mode?: StripeMode }) {
  const s = await settings(q);
  const facts = contractFacts(s);
  const mode = opts.mode ?? await currentMode();
  const result = await inTx(q, async (c) => {
    const { rows: [qt] } = await c.query(`select * from quotes where id = $1 for update`, [quoteId]);
    if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
    if (qt.state !== 'draft') throw new QuoteError('This quote has already been sent.', 409, 'not_draft');
    const lines = await linesOf(c, quoteId);
    const base = quoteTotals(lines);
    const withAll = quoteTotals(lines, lines.filter((l) => l.optional).map((l) => l.id));
    if (!lines.some((l) => !l.optional)) throw new QuoteError('Add at least one line that is not optional.', 400, 'no_lines');
    if (base.total <= 0) throw new QuoteError('The quote adds up to $0.', 400, 'zero_total');
    if (needsLicence(qt.is_improvement, withAll.total) && !facts.licenceNumber) {
      throw new QuoteError('Install work of $1,000 or more needs the contractor licence number on the quote. Add it in Settings, or split the job.', 409, 'licence_required');
    }
    if (needsWrittenContract(qt.is_improvement, withAll.total)) {
      const gaps = contractGaps(facts);
      if (gaps.length) throw new QuoteError(`An install job over $500 is a written contract in California, and it needs ${gaps.join(', ')}.`, 409, 'contract_facts_missing');
    }
    const { rows: [lead] } = await c.query(`select * from leads where id = $1 for update`, [qt.lead_id]);
    // The customer: an existing one by phone, the natural key in a phone-first business, or new.
    let customerId: string;
    const { rows: [existing] } = await c.query(`select id from customers where phone = $1 and deleted_at is null limit 1`, [lead.phone]);
    if (existing) customerId = existing.id;
    else {
      const { rows: [cu] } = await c.query(
        `insert into customers (name, phone, email, preferred_payment, notes) values ($1,$2,$3,'card','') returning id`,
        [lead.name, lead.phone, lead.email]);
      customerId = cu.id;
    }
    const { rows: [prop] } = await c.query(
      `insert into properties (customer_id, address, city, postal_code, num_dogs) values ($1,$2,$3,$4,0) returning id`,
      [customerId, lead.address || lead.city, lead.city, lead.postal_code]);
    const { rows: [sub] } = await c.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, price_cents, price_tier_label, priced_at, frequency,
                                  livemode, source, booking_answers)
       values ($1,$2,'custom-job','quote_ready',$3,$4,now(),'one_time',$5,'quote',$6::jsonb) returning id`,
      [customerId, prop.id, base.total, `Quote #${qt.number}`, mode === 'live', JSON.stringify({ quote_id: qt.id })]);
    const validDays = Number(setting(s, 'quote.valid_days', 30));
    await c.query(
      `update quotes set state = 'sent', sent_at = now(),
                         valid_until = coalesce(valid_until, (now() at time zone 'America/Los_Angeles')::date + $2::int), customer_id = $3,
                         subscription_id = $4, livemode = $5, updated_at = now() where id = $1`,
      [quoteId, validDays, customerId, sub.id, mode === 'live']);
    await c.query(
      `update leads set status = 'quoted', customer_id = coalesce(customer_id, $2), first_response_at = coalesce(first_response_at, now()), updated_at = now()
        where id = $1`, [lead.id, customerId]);
    await appendEvent(c as never, { subjectKind: 'subscription', subjectId: sub.id, type: 'quote.sent', to: 'quote_ready', actorKind: 'owner', payload: { quote: qt.id, number: qt.number, total: base.total } });
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.sent', from: 'draft', to: 'sent', actorKind: 'owner', payload: { by: opts.by, total: base.total, optional: withAll.optionalAvailable } });
    return { qt, lead, total: base.total };
  });
  const url = `${opts.base}/quote/${result.lead.request_token}`;
  const body = `Hi ${firstName(result.lead.name)}, it's Josue from Scoop Dogg. Your quote for ${result.qt.title || 'the job'} is ready: ${url}`;
  const mail = await sendEmail({
    purpose: 'quote_sent',
    recipients: { explicit: [result.lead.email] },
    fromName: 'Josue at Scoop Dogg',
    subject: `Your quote from Scoop Dogg — ${money(result.total)}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <p>Hi ${esc(firstName(result.lead.name))},</p>
      <p>Here is my quote for ${esc(result.qt.title || 'your job')}: <strong>${money(result.total)}</strong>. It has every line itemised, the photos you sent, and anything optional you can add.</p>
      <p><a href="${url}" style="display:inline-block;background:#F4A024;color:#0F2A1F;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">See the quote</a></p>
      <p>You can approve it and pay the deposit on that page, or text me with any questions.</p>
      <p>Josue · Scoop Dogg · (805) 869-8070</p></div>`,
  }).catch(() => null);
  return { url, sms_href: smsHref(result.lead.phone, body), email: mail?.state ?? 'failed', number: result.qt.number };
}

// ─────────────────────────────────────────────────────────────── the customer's page

/** The quote a lead's link currently shows: the newest one that is not a draft. */
async function currentQuote(q: Queryable, leadId: string) {
  const { rows: [qt] } = await q.query(
    `select * from quotes where lead_id = $1 and state <> 'draft' order by number desc limit 1`, [leadId]);
  return qt ?? null;
}

/**
 * A sent quote past its date becomes expired the first time anyone looks. Compared in SQL on the
 * business's own calendar: "valid until the 30th" means until the end of the 30th in Ventura, and a
 * DATE parsed in JavaScript shifts by a day depending on the machine's timezone.
 */
async function expireIfDue(q: Queryable, qt: QuoteRow): Promise<QuoteRow> {
  if (qt.state !== 'sent') return qt;
  return inTx(q, async (c) => {
    const { rows: [done] } = await c.query(
      `update quotes set state = 'expired', updated_at = now()
        where id = $1 and state = 'sent' and valid_until < (now() at time zone 'America/Los_Angeles')::date returning id`, [qt.id]);
    if (!done) return qt;
    if (qt.subscription_id) await c.query(`update subscriptions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'quote expired', updated_at = now() where id = $1 and state = 'quote_ready'`, [qt.subscription_id]);
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.expired', from: 'sent', to: 'expired', actorKind: 'system' });
    return { ...qt, state: 'expired' };
  });
}

export async function viewQuote(q: Queryable, token: string, opts: { count: boolean }) {
  const lead = await leadByToken(q, token);
  if (!lead) throw new QuoteError('That link is not recognised. It may have been typed wrong.', 404, 'not_found');
  const s = await settings(q);
  const facts = contractFacts(s);
  let qt = await currentQuote(q, lead.id);
  if (qt) qt = await expireIfDue(q, qt);
  if (qt && opts.count && qt.state === 'sent') {
    await q.query(
      `update quotes set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now() where id = $1`, [qt.id]);
  }
  const lines = qt ? await linesOf(q, qt.id) : [];
  const stage = !qt ? 'received'
    : qt.state === 'sent' ? 'quote'
    : qt.state === 'accepted' ? (qt.balance_paid_at ? 'paid' : qt.completed_at ? 'completed' : qt.deposit_paid_at || !qt.deposit_cents ? 'booked' : 'accepted')
    : qt.state;
  return {
    stage,
    business: {
      name: String(setting(s, 'business.name', 'Scoop Dogg')), phone: facts.phone, email: facts.email,
      licence: facts.licenceNumber, licence_class: facts.licenceClass, legal_name: facts.legalName, mailing_address: facts.mailingAddress,
      cgl: facts.cgl, workers_comp: facts.workersComp,
      reply_promise: String(setting(s, 'quote.reply_promise', 'within one business day')),
    },
    request: {
      first_name: firstName(String(lead.name).replace(/^DEMO—/, '')), job_kinds: (lead.job_kinds ?? []).map(jobKindLabel),
      description: lead.notes, where: [lead.address, lead.city].filter(Boolean).join(', '), created_at: lead.created_at,
      photos: await leadPhotos(q, lead.id),
    },
    quote: qt ? {
      id: qt.id, number: qt.number, state: qt.state, title: qt.title, message: qt.message, is_improvement: qt.is_improvement,
      deposit: { mode: qt.deposit_mode, percent: qt.deposit_percent, fixed_cents: qt.deposit_fixed_cents },
      approx_start: qt.approx_start, approx_completion: qt.approx_completion,
      valid_until: qt.valid_until, sent_at: qt.sent_at,
      lines: lines.map((l) => ({ id: l.id, description: l.description, detail: l.detail, amount_cents: l.amount_cents, optional: l.optional, chosen: l.chosen })),
      accepted_at: qt.accepted_at, accepted_name: qt.accepted_name, total_cents: qt.total_cents, deposit_cents: qt.deposit_cents,
      deposit_paid_at: qt.deposit_paid_at, completed_at: qt.completed_at, balance_paid_at: qt.balance_paid_at,
      has_card: Boolean(qt.payment_method_id), balance_checkout_url: null as string | null,
    } : null,
  };
}

// ─────────────────────────────────────────────────────────────── approving

export async function acceptQuote(q: Queryable, token: string, raw: Record<string, unknown>, ctx: { base: string; ip?: string | null; ua?: string | null }) {
  const lead = await leadByToken(q, token);
  if (!lead) throw new QuoteError('That link is not recognised.', 404, 'not_found');
  const s = await settings(q);
  const businessName = String(setting(s, 'business.name', 'Scoop Dogg'));
  const name = str(raw.name, 120);
  const chosen = Array.isArray(raw.chosen) ? raw.chosen.map(String) : [];
  const senior = Boolean(raw.senior);

  const accepted = await inTx(q, async (c) => {
    const { rows: [qt0] } = await c.query(
      `select * from quotes where lead_id = $1 and state <> 'draft' order by number desc limit 1 for update`, [lead.id]);
    if (!qt0) throw new QuoteError('There is no quote on this link yet.', 404, 'no_quote');
    if (raw.quote_id && String(raw.quote_id) !== qt0.id) throw new QuoteError('Josue has sent a newer quote. Please refresh the page.', 409, 'quote_replaced');
    const qt = await expireIfDue(c, qt0);
    if (qt.state === 'accepted') return { qt, already: true };
    if (qt.state === 'expired') throw new QuoteError('This quote has expired. Text Josue and he will refresh it.', 409, 'expired');
    if (qt.state !== 'sent') throw new QuoteError('This quote is no longer open.', 409, 'not_open');
    if (name.length < 2) throw new QuoteError('Type your full name to approve.', 400, 'name_required');
    const lines = await linesOf(c, qt.id);
    const optionalIds = new Set(lines.filter((l) => l.optional).map((l) => l.id));
    const picked = chosen.filter((id) => optionalIds.has(id));
    const totals = quoteTotals(lines, picked);
    const dep = depositFor(totals.total, { mode: qt.deposit_mode, percent: qt.deposit_percent, fixedCents: qt.deposit_fixed_cents }, qt.is_improvement);
    const terms = acceptanceTerms({ businessName, number: qt.number, totalCents: totals.total, depositCents: dep.cents, isImprovement: qt.is_improvement });
    if (str(raw.terms, 2000) !== terms) {
      throw new QuoteError('The total changed while you were deciding. Please check the numbers again.', 409, 'terms_stale');
    }
    await c.query(`update quote_lines set chosen = case when optional then id = any($2::uuid[]) else true end where quote_id = $1`, [qt.id, picked]);
    await c.query(
      `update quotes set state = 'accepted', accepted_at = now(), accepted_name = $2, accepted_ip = $3, accepted_user_agent = $4,
                         accepted_terms = $5, total_cents = $6, deposit_cents = $7, updated_at = now() where id = $1`,
      [qt.id, name, ctx.ip ?? null, (ctx.ua ?? '').slice(0, 400), terms + (senior ? ' [buyer is a senior citizen: five-day right to cancel]' : ''), totals.total, dep.cents]);
    await c.query(`update subscriptions set state = 'quote_accepted', price_cents = $2, updated_at = now() where id = $1`, [qt.subscription_id, totals.total]);
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.accepted', from: 'sent', to: 'accepted', actorKind: 'customer', actorId: qt.customer_id, payload: { total: totals.total, deposit: dep.cents, capped: dep.capped, optional: picked.length, senior } });
    await appendEvent(c as never, { subjectKind: 'subscription', subjectId: qt.subscription_id, type: 'quote.accepted', from: 'quote_ready', to: 'quote_accepted', actorKind: 'customer', actorId: qt.customer_id });
    const { rows: [fresh] } = await c.query(`select * from quotes where id = $1`, [qt.id]);
    return { qt: fresh, already: false };
  });

  const qt = accepted.qt;
  // A second tap on Approve while the deposit is still unpaid returns the same checkout.
  if (accepted.already && qt.deposit_paid_at) return { checkout_url: null, state: 'accepted' as const, deposit_cents: qt.deposit_cents };
  if (!qt.deposit_cents) {
    await activateJob(q, qt, 'no deposit');
    await notifyOwner(qt, lead, `${lead.name} approved quote #${qt.number} (${money(qt.total_cents)}), no deposit. Schedule the job.`, ctx.base);
    return { checkout_url: null, state: 'accepted' as const, deposit_cents: 0 };
  }
  const mode: StripeMode = qt.livemode ? 'live' : 'test';
  if (!(await paymentsReady(mode))) {
    await notifyOwner(qt, lead, `${lead.name} approved quote #${qt.number} (${money(qt.total_cents)}). Online payments are not connected, so collect the ${money(qt.deposit_cents)} deposit directly.`, ctx.base);
    return { checkout_url: null, state: 'accepted' as const, deposit_cents: qt.deposit_cents, payments: 'not_ready' as const };
  }
  const session = await depositCheckout(q, qt, lead, mode, ctx.base);
  return { checkout_url: session.url, state: 'accepted' as const, deposit_cents: qt.deposit_cents };
}

async function depositCheckout(q: Queryable, qt: QuoteRow, lead: Record<string, any>, mode: StripeMode, base: string) {
  const { stripe, account } = await resolve(mode);
  if (qt.deposit_checkout) {
    const existing = await stripe.checkout.sessions.retrieve(qt.deposit_checkout, {}, { stripeAccount: account }).catch(() => null);
    if (existing && existing.status === 'open' && existing.url) return existing;
  }
  const scust = qt.stripe_customer_id ?? await stripeCustomer(stripe, account, mode, qt.customer_id, {
    name: lead.name, email: lead.email, phone: lead.phone, address: lead.address || lead.city, postal_code: lead.postal_code ?? '',
  } as never, q);
  const balance = qt.total_cents - qt.deposit_cents;
  const session = await chargeOnce({
    mode,
    customerId: scust,
    amountCents: qt.deposit_cents,
    lineItems: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: qt.deposit_cents, product_data: { name: `Deposit — quote #${qt.number}${qt.title ? `: ${qt.title}` : ''}` } } }],
    metadata: { quote_id: qt.id, kind: 'quote_deposit', subscription_id: qt.subscription_id },
    submitMessage: balance > 0 ? `The ${money(balance)} balance is charged to this card when the work is done.` : 'This pays the job in full.',
    successUrl: `${base}/quote/${lead.request_token}?paid={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/quote/${lead.request_token}`,
    idempotencyKey: `quote-deposit-${qt.id}-${qt.deposit_cents}`,
    saveCardForLater: balance > 0,
  });
  await inTx(q, async (c) => {
    await c.query(`update quotes set deposit_checkout = $2, stripe_customer_id = $3, account_id = $4, updated_at = now() where id = $1`, [qt.id, session.id, scust, account]);
    await c.query(`update subscriptions set state = 'deposit_pending', payment_state = 'pending', stripe_customer_id = $2, account_id = $3, updated_at = now()
                    where id = $1 and state in ('quote_accepted','deposit_pending')`, [qt.subscription_id, scust, account]);
    await appendEvent(c as never, { subjectKind: 'subscription', subjectId: qt.subscription_id, type: 'quote.deposit_requested', from: 'quote_accepted', to: 'deposit_pending', actorKind: 'system', payload: { checkout: session.id, cents: qt.deposit_cents } });
  });
  return session;
}

async function activateJob(q: Queryable, qt: QuoteRow, why: string) {
  await inTx(q, async (c) => {
    const { rowCount } = await c.query(
      `update subscriptions set state = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
        where id = $1 and state in ('quote_accepted','deposit_pending')`, [qt.subscription_id]);
    if (rowCount) await appendEvent(c as never, { subjectKind: 'subscription', subjectId: qt.subscription_id, type: 'quote.job_booked', to: 'active', actorKind: 'system', payload: { why } });
  });
}

async function notifyOwner(qt: QuoteRow, lead: Record<string, any>, sentence: string, base: string) {
  await sendEmail({
    purpose: 'quote_accepted',
    recipients: { settingKey: 'notify.lead_recipients' },
    ccSettingKey: 'notify.lead_cc',
    fromName: 'Scoop Dogg',
    replyTo: lead.email,
    subject: sentence.split('.')[0],
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><p>${esc(sentence)}</p>
      <p><a href="${base}/admin/quotes/${qt.id}">Open quote #${qt.number}</a></p></div>`,
  }).catch(() => null);
}

// ─────────────────────────────────────────────────────────────── money arriving

/**
 * A deposit or balance Checkout is paid: the invoice, its line, and the payment, with the fee
 * Stripe took. Called by the webhook and by the page the customer returns to, whichever is first;
 * the second finds it done.
 */
export async function confirmQuotePayment(q: Queryable, sessionId: string, opts: { mode?: StripeMode; base: string }) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw new QuoteError('Not a checkout session.', 400, 'bad_session');
  const mode: StripeMode = opts.mode ?? (sessionId.startsWith('cs_live_') ? 'live' : 'test');
  const { stripe, account } = await resolve(mode);
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] }, { stripeAccount: account });
  const quoteId = session.metadata?.quote_id;
  const kind = session.metadata?.kind;
  if (!quoteId || (kind !== 'quote_deposit' && kind !== 'quote_balance')) throw new QuoteError('That payment is not for a quote.', 400, 'not_a_quote');
  if (session.payment_status !== 'paid') return { paid: false, kind };
  const intent = session.payment_intent as Stripe.PaymentIntent;
  return recordQuotePayment(q, quoteId, kind, intent, { mode, account, base: opts.base });
}

export async function recordQuotePayment(q: Queryable, quoteId: string, kind: 'quote_deposit' | 'quote_balance', intent: Stripe.PaymentIntent,
  ctx: { mode: StripeMode; account: string; base: string }) {
  const out = await inTx(q, async (c) => {
    const { rows: [qt] } = await c.query(`select * from quotes where id = $1 for update`, [quoteId]);
    if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
    const already = kind === 'quote_deposit' ? qt.deposit_paid_at : qt.balance_paid_at;
    if (already) return { paid: true, kind, already: true, qt };
    const amount = intent.amount_received;
    const fee = intent.application_fee_amount ?? 0;
    const label = kind === 'quote_deposit' ? `Deposit on quote #${qt.number}${qt.title ? ` — ${qt.title}` : ''}` : `Balance on quote #${qt.number}${qt.title ? ` — ${qt.title}` : ''}`;
    const { rows: [inv] } = await c.query(
      `insert into invoices (customer_id, subscription_id, subtotal_cents, platform_fee_cents, total_cents, state, issued_at, paid_at,
                             collection_method, livemode, account_id)
       values ($1,$2,$3,$4,$3,'paid',now(),now(),'auto',$5,$6) returning id`,
      [qt.customer_id, qt.subscription_id, amount, fee, ctx.mode === 'live', ctx.account]);
    await c.query(`insert into invoice_lines (invoice_id, description, amount_cents) values ($1,$2,$3)`, [inv.id, label, amount]);
    await c.query(
      `insert into payments (customer_id, invoice_id, kind, amount_cents, currency, stripe_payment_id, stripe_account_id, platform_fee_cents, state, livemode)
       values ($1,$2,$3,$4,'usd',$5,$6,$7,'succeeded',$8) on conflict do nothing`,
      [qt.customer_id, inv.id, kind === 'quote_deposit' ? 'deposit' : 'charge', amount, intent.id, ctx.account, fee, ctx.mode === 'live']);
    if (kind === 'quote_deposit') {
      const pm = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id ?? null;
      await c.query(`update quotes set deposit_paid_at = now(), payment_method_id = coalesce($2, payment_method_id), updated_at = now() where id = $1`, [qt.id, pm]);
      await c.query(`update subscriptions set state = 'active', payment_state = 'ok', activated_at = coalesce(activated_at, now()), updated_at = now()
                      where id = $1 and state in ('quote_accepted','deposit_pending')`, [qt.subscription_id]);
    } else {
      await c.query(`update quotes set balance_paid_at = now(), completed_at = coalesce(completed_at, now()), updated_at = now() where id = $1`, [qt.id]);
      await c.query(`update subscriptions set payment_state = 'ok', updated_at = now() where id = $1`, [qt.subscription_id]);
    }
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: kind === 'quote_deposit' ? 'quote.deposit_paid' : 'quote.balance_paid', actorKind: 'customer', actorId: qt.customer_id, payload: { amount, fee, intent: intent.id } });
    return { paid: true, kind, already: false, qt, amount, fee };
  });
  if (!out.already) {
    const { rows: [lead] } = await q.query(`select * from leads where id = $1`, [out.qt.lead_id]);
    await notifyOwner(out.qt, lead, `${kind === 'quote_deposit' ? 'Deposit' : 'Balance'} paid on quote #${out.qt.number}: ${money(out.amount ?? 0)} from ${lead.name}.`, ctx.base);
  }
  return { paid: true, kind, already: out.already };
}

// ─────────────────────────────────────────────────────────────── the work is done

export async function completeQuoteJob(q: Queryable, quoteId: string, opts: { by: string; method: 'card' | 'link'; base: string }) {
  const { rows: [qt] } = await q.query(`select * from quotes where id = $1`, [quoteId]);
  if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
  if (qt.state !== 'accepted') throw new QuoteError('Only an approved quote can be completed.', 409, 'not_accepted');
  if (qt.balance_paid_at) throw new QuoteError('The balance is already paid.', 409, 'already_paid');
  if (qt.deposit_cents > 0 && !qt.deposit_paid_at) throw new QuoteError('The deposit has not been paid yet.', 409, 'deposit_unpaid');
  const balance = qt.total_cents - (qt.deposit_paid_at ? qt.deposit_cents : 0);
  await q.query(`update quotes set completed_at = coalesce(completed_at, now()), updated_at = now() where id = $1`, [quoteId]);
  await appendEvent(q as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.completed', actorKind: 'owner', payload: { by: opts.by, balance, method: opts.method } });
  if (balance <= 0) return { balance: 0, paid: true };
  const mode: StripeMode = qt.livemode ? 'live' : 'test';
  const { rows: [lead] } = await q.query(`select * from leads where id = $1`, [qt.lead_id]);
  if (opts.method === 'card') {
    if (!qt.payment_method_id || !qt.stripe_customer_id) throw new QuoteError('There is no card on file for this job. Text the customer a balance link instead.', 409, 'no_card_on_file');
    let intent: Stripe.PaymentIntent;
    try {
      intent = await chargeSavedCard({
        mode, customerId: qt.stripe_customer_id, paymentMethodId: qt.payment_method_id, amountCents: balance,
        description: `Balance on quote #${qt.number}${qt.title ? ` — ${qt.title}` : ''}`,
        metadata: { quote_id: qt.id, kind: 'quote_balance', subscription_id: qt.subscription_id },
        idempotencyKey: `quote-balance-${qt.id}-${balance}`,
      });
    } catch (e) {
      const why = (e as { code?: string; message?: string }).code ?? (e as Error).message;
      throw new QuoteError(`The card on file did not go through (${why}). Text the customer a balance link instead.`, 402, 'card_declined');
    }
    if (intent.status !== 'succeeded') throw new QuoteError('The card needs the customer to confirm. Text them a balance link instead.', 402, 'card_needs_customer');
    const { account } = await resolve(mode);
    await recordQuotePayment(q, qt.id, 'quote_balance', intent, { mode, account, base: opts.base });
    return { balance, paid: true };
  }
  const { stripe, account } = await resolve(mode);
  const scust = qt.stripe_customer_id ?? await stripeCustomer(stripe, account, mode, qt.customer_id, {
    name: lead.name, email: lead.email, phone: lead.phone, address: lead.address || lead.city, postal_code: lead.postal_code ?? '',
  } as never, q);
  const session = await chargeOnce({
    mode, customerId: scust, amountCents: balance,
    lineItems: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: balance, product_data: { name: `Balance — quote #${qt.number}${qt.title ? `: ${qt.title}` : ''}` } } }],
    metadata: { quote_id: qt.id, kind: 'quote_balance', subscription_id: qt.subscription_id },
    submitMessage: 'Thank you for choosing Scoop Dogg.',
    successUrl: `${opts.base}/quote/${lead.request_token}?paid={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${opts.base}/quote/${lead.request_token}`,
    idempotencyKey: `quote-balance-link-${qt.id}-${balance}`,
  });
  await q.query(`update quotes set balance_checkout = $2, stripe_customer_id = coalesce(stripe_customer_id, $3), updated_at = now() where id = $1`, [qt.id, session.id, scust]);
  const url = `${opts.base}/quote/${lead.request_token}`;
  return {
    balance, paid: false, checkout_url: session.url,
    sms_href: smsHref(lead.phone, `Hi ${firstName(lead.name)}, the job's done — thank you. The balance of ${money(balance)} is here: ${url}`),
  };
}

// ─────────────────────────────────────────────────────────────── the other ways it ends

export async function declineQuote(q: Queryable, token: string, reason: string, base: string) {
  const lead = await leadByToken(q, token);
  if (!lead) throw new QuoteError('That link is not recognised.', 404, 'not_found');
  const qt = await currentQuote(q, lead.id);
  if (!qt || qt.state !== 'sent') throw new QuoteError('This quote is not open.', 409, 'not_open');
  await inTx(q, async (c) => {
    await c.query(`update quotes set state = 'declined', declined_at = now(), decline_reason = $2, updated_at = now() where id = $1`, [qt.id, str(reason, 1000)]);
    await c.query(`update subscriptions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'quote declined', updated_at = now() where id = $1`, [qt.subscription_id]);
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.declined', from: 'sent', to: 'declined', actorKind: 'customer', payload: { reason: str(reason, 1000) } });
  });
  await notifyOwner(qt, lead, `${lead.name} passed on quote #${qt.number}.${reason ? ` They said: "${str(reason, 300)}"` : ''}`, base);
  return { state: 'declined' };
}

export async function withdrawQuote(q: Queryable, quoteId: string, by: string) {
  return inTx(q, async (c) => {
    const { rows: [qt] } = await c.query(`select * from quotes where id = $1 for update`, [quoteId]);
    if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
    if (qt.state !== 'sent') throw new QuoteError('Only a sent, unanswered quote can be withdrawn.', 409, 'not_open');
    await c.query(`update quotes set state = 'withdrawn', updated_at = now() where id = $1`, [qt.id]);
    await c.query(`update subscriptions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'quote withdrawn', updated_at = now() where id = $1`, [qt.subscription_id]);
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.withdrawn', from: 'sent', to: 'withdrawn', actorKind: 'owner', payload: { by } });
    return { state: 'withdrawn' };
  });
}

/** A copy of a sent, declined or expired quote as a new draft; an open one is withdrawn first. */
export async function reviseQuote(q: Queryable, quoteId: string, by: string) {
  return inTx(q, async (c) => {
    const { rows: [qt] } = await c.query(`select * from quotes where id = $1 for update`, [quoteId]);
    if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
    if (!['sent', 'declined', 'expired', 'withdrawn'].includes(qt.state)) throw new QuoteError('Only a quote the customer has not approved can be revised.', 409, 'not_revisable');
    if (qt.state === 'sent') {
      await c.query(`update quotes set state = 'withdrawn', updated_at = now() where id = $1`, [qt.id]);
      await c.query(`update subscriptions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'quote revised', updated_at = now() where id = $1`, [qt.subscription_id]);
    }
    const { rows: [nq] } = await c.query(
      `insert into quotes (lead_id, title, message, is_improvement, deposit_mode, deposit_percent, deposit_fixed_cents, approx_start, approx_completion, created_by)
       select lead_id, title, message, is_improvement, deposit_mode, deposit_percent, deposit_fixed_cents, approx_start, approx_completion, $2
         from quotes where id = $1 returning *`, [qt.id, by]);
    await c.query(
      `insert into quote_lines (quote_id, sort, description, detail, amount_cents, optional)
       select $2, sort, description, detail, amount_cents, optional from quote_lines where quote_id = $1`, [qt.id, nq.id]);
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: nq.id, type: 'quote.revised_from', actorKind: 'owner', payload: { from: qt.id, by } });
    return nq;
  });
}

/**
 * Cancel an approved job and give the deposit back, AMTECH's fee with it (`refund()` always
 * returns the fee). The three-day right to cancel is the case this exists for: "the contractor
 * must return to you anything you paid within 10 days".
 */
export async function refundQuoteDeposit(q: Queryable, quoteId: string, by: string) {
  const { rows: [qt] } = await q.query(`select * from quotes where id = $1`, [quoteId]);
  if (!qt) throw new QuoteError('No such quote.', 404, 'not_found');
  if (!qt.deposit_paid_at) throw new QuoteError('There is no paid deposit on this quote.', 409, 'no_deposit');
  if (qt.balance_paid_at) throw new QuoteError('The job is paid in full; refund it from Payments instead.', 409, 'already_paid');
  const { rows: [pay] } = await q.query(`select p.stripe_payment_id, p.amount_cents, p.platform_fee_cents from payments p join invoices i on i.id = p.invoice_id
                                          where i.subscription_id = $1 and p.kind = 'deposit' and p.state = 'succeeded' limit 1`, [qt.subscription_id]);
  if (!pay) throw new QuoteError('The deposit payment is not on record.', 409, 'no_deposit');
  const mode: StripeMode = qt.livemode ? 'live' : 'test';
  const r = await refund({ mode, paymentIntentId: pay.stripe_payment_id, reason: 'requested_by_customer', idempotencyKey: `quote-refund-${qt.id}` });
  await inTx(q, async (c) => {
    // Append-only: the refund is its own row, negative, and so is the fee it gave back — a full
    // refund returns the whole fee (refund() sets refund_application_fee), so the fee report nets.
    await c.query(`insert into payments (customer_id, kind, amount_cents, currency, stripe_payment_id, stripe_account_id, platform_fee_cents, state, livemode)
                   values ($1,'refund',$2,'usd',$3,$4,$5,'succeeded',$6) on conflict do nothing`,
      [qt.customer_id, -pay.amount_cents, r.id, qt.account_id, -Number(pay.platform_fee_cents ?? 0), mode === 'live']);
    await c.query(`update quotes set state = 'withdrawn', updated_at = now() where id = $1`, [qt.id]);
    await c.query(`update subscriptions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'quote cancelled, deposit refunded', updated_at = now() where id = $1`, [qt.subscription_id]);
    await appendEvent(c as never, { subjectKind: 'quote', subjectId: qt.id, type: 'quote.deposit_refunded', to: 'withdrawn', actorKind: 'owner', payload: { by, refund: r.id, cents: pay.amount_cents } });
  });
  return { refunded: pay.amount_cents, refund: r.id };
}
