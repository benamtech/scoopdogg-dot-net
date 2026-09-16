/**
 * The ONE place this codebase talks to the mail provider.
 *
 * Before this file there were three: api/lead.ts, api/contact.ts and
 * server/lib/admin-auth.ts each built their own `fetch`, and two of them named the
 * owner's address as a fallback recipient. That shape has one defect that matters more
 * than the duplication: a demo check added to one of them is absent from the other two,
 * and the fourth one somebody writes next month forgets it entirely.
 *
 * So demo mode is enforced HERE, at the transport, and not at the address list. There is
 * one place to be right, and a gate can prove there is only one:
 *
 *     grep -rl 'api.resend.com' api/ server/ | wc -l    ->  1
 *
 * THERE IS NO FALLBACK RECIPIENT, deliberately. If `notify.lead_recipients` cannot be
 * read, this refuses to send and writes the refusal into `outbox`. The old fallback made
 * a missing or emptied settings row mail the client anyway - a demo facility that fails
 * open onto a real inbox is not a demo facility. Refusing costs a notification; the lead
 * itself is already committed by the time this is called, and now the failure is a row
 * somebody can see rather than a line in a log nobody reads.
 *
 * WHAT A 200 FROM THE PROVIDER MEANS: accepted. Not delivered. It cannot see a bounce, a
 * block or a spam complaint. So a successful send lands the row in `delivering`, and only
 * an observed provider event moves it to `delivered` or `failed` - see delivery.ts.
 */
import { db } from './db.js';
import { safeError } from './http.js';

/** The provider's base URL. Every call goes through resendFetch() below, so this is the
 *  only place in api/ or server/ that names the host - which is what the gate counts. */
const RESEND_BASE = 'https://api.resend.com';

/** Resend sits behind Cloudflare, which answers a bare or library user agent with
 *  403 "error code: 1010". That reads exactly like a dead API key and is not one. */
const USER_AGENT = 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)';

export type OutboxState = 'pending' | 'delivering' | 'delivered' | 'failed' | 'abandoned';

export type SendEmailArgs = {
  /** What this message is for. Stored on the row so a gate can find its own sends. */
  purpose: 'lead' | 'contact' | 'admin_login' | 'gate_probe' | 'customer_login' | 'booking_welcome' | 'booking_owner' | 'waitlist' | 'waitlist_owner' | 'subscription_change' | 'quote_request';
  /** Settings key holding the recipient list, or an explicit address for a sign-in code. */
  recipients: { settingKey: string } | { explicit: string[] };
  subject: string;
  html: string;
  replyTo?: string;
  /** Settings key for the From address. There is no person-shaped default. */
  fromSettingKey?: string;
  fromName?: string;
  /** Copy list settings key. AMTECH is copied, never addressed. */
  ccSettingKey?: string;
  /** Tag the row as belonging to a test run, so a cleanup can scope to exactly it. */
  mark?: string;
};

export type SendEmailResult = {
  outboxId: number | null;
  state: OutboxState;
  demo: boolean;
  /** What was asked for, before demo mode rewrote it. */
  requestedTo: string[];
  /** What the provider was actually given. */
  deliveredTo: string[];
  providerId: string | null;
  error: string | null;
};

/**
 * Everything this function needs from `settings`, read in ONE query.
 *
 * One query on purpose. `setting()` in db.ts swallows a failure and returns its fallback,
 * so reading demo.mode separately means a transient error on that one read looks exactly
 * like "demo mode is off" while the recipient read succeeded - and the message goes live
 * during a demo. Here, either the whole read works or nothing is sent.
 */
async function readSettings(keys: string[]): Promise<Map<string, unknown>> {
  const { rows } = await db().query(
    'select key, value from settings where key = any($1::text[])', [keys]);
  return new Map(rows.map((r: { key: string; value: unknown }) => [r.key, r.value]));
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.includes('@')) : [];

/** The demo state, as the mail surface sees it. `demo.mode` is the same setting the
 *  client pages, the booking journey and Stripe read - one switch, four surfaces. */
export type DemoState = { mode: boolean; address: string | null };

export function demoFrom(settings: Map<string, unknown>): DemoState {
  // A local test harness forces demo mode for its own process (SD_FORCE_DEMO=1), so an
  // end-to-end booking run can never mail the owner or charge a live card - without writing
  // a setting the live site also reads. It can only turn demo ON, never off.
  const forced = process.env.SD_FORCE_DEMO === '1';
  const mode = forced || settings.get('demo.mode') === true;
  const raw = forced && process.env.SD_DEMO_ADDRESS ? process.env.SD_DEMO_ADDRESS : settings.get('demo.address');
  const address = typeof raw === 'string' && raw.includes('@') ? raw : null;
  return { mode, address };
}

/** Read `demo.mode` on its own, for the surfaces that only need to know whether to put a
 *  banner up. Mail must NOT use this - it reads the flag in the same query as the
 *  addresses, so a half-failed read cannot send a demo message to a real customer. */
export async function demoMode(): Promise<DemoState> {
  const settings = await readSettings(['demo.mode', 'demo.address']);
  return demoFrom(settings);
}

/**
 * The demo state as the admin receives it over the wire.
 *
 * `demo_mode` is snake_case because it is a JSON field and every other field this API
 * returns is snake_case; `mode` is camelCase because it is a value in this process. They
 * are two names for one fact and this function is the only place they meet, so a screen
 * reading `demo_mode` and a server reading `demo.mode` cannot drift apart.
 */
export type DemoStatus = { demo_mode: boolean; demo_address: string | null };

export function demoStatus(state: DemoState): DemoStatus {
  return { demo_mode: state.mode, demo_address: state.address };
}

/** A single authenticated call to the mail provider. The only place its host is reached. */
export async function resendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured.');
  return fetch(`${RESEND_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      ...(init.headers || {}),
    },
  });
}

async function writeOutbox(row: {
  purpose: string;
  payload: unknown;
  state: OutboxState;
  demo: boolean;
  lastError: string | null;
}): Promise<number | null> {
  try {
    const { rows } = await db().query(
      `insert into outbox (kind, purpose, provider, payload, state, demo, attempts, last_error)
       values ('email', $1, 'resend', $2::jsonb, $3, $4, $5, $6)
       returning id`,
      [row.purpose, JSON.stringify(row.payload), row.state, row.demo,
       row.state === 'pending' ? 0 : 1, row.lastError],
    );
    return Number(rows[0].id);
  } catch (e) {
    // The outbox row is the record that this was attempted. Losing it is bad, but it must
    // not take the caller down with it - the lead is already saved by the time we are here.
    safeError('notify:outbox-insert', e);
    return null;
  }
}

/**
 * Send one email, and leave a row saying what happened to it.
 *
 * Order, and the order is the design:
 *   1. read every setting in one query; a failure here refuses the send
 *   2. resolve the recipients, then rewrite them if demo mode is on - BEFORE any network
 *   3. write the outbox row
 *   4. call the provider
 *   5. move the row to `delivering` (accepted) or `failed` (refused), never `delivered`
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const fromKey = args.fromSettingKey ?? 'notify.from_address';
  const keys = ['demo.mode', 'demo.address', fromKey];
  if ('settingKey' in args.recipients) keys.push(args.recipients.settingKey);
  if (args.ccSettingKey) keys.push(args.ccSettingKey);

  let settings: Map<string, unknown>;
  try {
    settings = await readSettings(keys);
  } catch (e) {
    safeError('notify:settings', e);
    const id = await writeOutbox({
      purpose: args.purpose,
      payload: { subject: args.subject, reason: 'settings_unreadable' },
      state: 'failed', demo: false, lastError: 'settings_unreadable',
    });
    return { outboxId: id, state: 'failed', demo: false, requestedTo: [], deliveredTo: [],
             providerId: null, error: 'settings_unreadable' };
  }

  const demo = demoFrom(settings);

  const requestedTo = 'explicit' in args.recipients
    ? args.recipients.explicit.filter((a) => a.includes('@'))
    : asStringArray(settings.get(args.recipients.settingKey));
  const requestedCc = args.ccSettingKey ? asStringArray(settings.get(args.ccSettingKey)) : [];
  const fromRaw = settings.get(fromKey);
  const from = typeof fromRaw === 'string' && fromRaw.includes('@') ? fromRaw : null;

  // No fallback. An unaddressable message is a visible failure, not a guess at who owns
  // this business's inbox.
  const refusal =
    !requestedTo.length
      ? `no recipient: ${'settingKey' in args.recipients ? args.recipients.settingKey : 'explicit list'} is empty or unset`
      : !from ? `no sender: ${fromKey} is empty or unset`
      : demo.mode && !demo.address ? 'demo mode is on and demo.address is unset'
      : null;

  if (refusal) {
    const id = await writeOutbox({
      purpose: args.purpose,
      payload: { subject: args.subject, requested_to: requestedTo, requested_cc: requestedCc,
                 mark: args.mark ?? null, reason: refusal },
      state: 'failed', demo: demo.mode, lastError: refusal,
    });
    console.warn(`[notify] refused to send ${args.purpose}: ${refusal}`);
    return { outboxId: id, state: 'failed', demo: demo.mode, requestedTo, deliveredTo: [],
             providerId: null, error: refusal };
  }

  // Demo mode rewrites the addresses BEFORE the network call. This is the whole point of
  // the file: it happens once, for every message, whatever the caller remembered to do.
  const to = demo.mode ? [demo.address as string] : requestedTo;
  const cc = demo.mode ? [] : requestedCc;

  const payload = {
    subject: args.subject,
    from,
    requested_to: requestedTo,
    requested_cc: requestedCc,
    to, cc,
    reply_to: args.replyTo ?? null,
    demo: demo.mode,
    mark: args.mark ?? null,
  };

  const outboxId = await writeOutbox({
    purpose: args.purpose, payload, state: 'pending', demo: demo.mode, lastError: null,
  });

  const subject = demo.mode ? `[DEMO] ${args.subject}` : args.subject;
  const html = demo.mode
    ? `<div style="background:#FFF4D6;border:1px solid #E0B000;padding:10px 14px;margin-bottom:14px;font-family:system-ui,sans-serif;font-size:13px;color:#6B4E00">
         <strong>DEMO MODE.</strong> This message was addressed to
         ${requestedTo.map((a) => a.replace(/</g, '&lt;')).join(', ')} and sent here instead.
         Nothing in it is a real customer.
       </div>${args.html}`
    : args.html;

  let state: OutboxState = 'failed';
  let providerId: string | null = null;
  let error: string | null = null;

  try {
    const res = await resendFetch('/emails', {
      method: 'POST',
      body: JSON.stringify({
        from: `${args.fromName ?? 'Scoop Dogg'} <${from}>`,
        to,
        ...(cc.length ? { cc } : {}),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        subject,
        html,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
    if (res.ok && body.id) {
      // ACCEPTED. Not delivered - delivery.ts decides that from an observed event.
      state = 'delivering';
      providerId = body.id;
    } else {
      error = `resend_${res.status}${body.name ? `_${body.name}` : ''}`;
    }
  } catch (e) {
    safeError('notify:send', e);
    error = 'resend_unreachable';
  }

  if (outboxId !== null) {
    try {
      await db().query(
        `update outbox
            set state = $2, provider_id = $3, attempts = attempts + 1, last_error = $4,
                next_retry_at = case when $2 = 'failed'
                                then now() + interval '5 minutes' else next_retry_at end
          where id = $1`,
        [outboxId, state, providerId, error],
      );
    } catch (e) {
      safeError('notify:outbox-update', e);
    }
  }

  return { outboxId, state, demo: demo.mode, requestedTo, deliveredTo: to, providerId, error };
}
