/**
 * The negative control: with demo mode OFF, a real send DOES reach a real address, and it
 * is DELIVERED rather than merely accepted.
 *
 *   node --env-file=.env.local --env-file=../../.env gates/demo-negative-control.mjs
 *
 * WHY THIS EXISTS AND WHY IT IS THE GATE THAT MATTERS. gates/demo-mode-no-leak.mjs asserts
 * that nothing reaches the client while demo mode is on. A sendEmail that sends NOTHING AT
 * ALL passes that perfectly. So the no-leak gate, on its own, is decoration: it cannot tell
 * a working demo mode from a completely broken mail system. This is the half that can go
 * red on the second one.
 *
 * IT SENDS ONE REAL EMAIL TO THE CLIENT, AND THAT IS THE POINT. Ben decided this on
 * 2026-09-12: the live-send step uses the real configuration - notify.lead_recipients and
 * notify.lead_cc, exactly as the business runs - because a step that stubs the transport is
 * testing the stub. The subject says plainly that it is an AMTECH delivery check and not a
 * lead, so nobody reading it has to work that out.
 *
 * DELIVERED, NOT SENT. A 200 from the provider means accepted. It cannot see a bounce, a
 * block or a complaint. So this polls until the provider reports a terminal event, and the
 * outbox row reaching `delivered` is the assertion.
 *
 * AND IT REPORTS `unknown` ON TIMEOUT, NEVER `passed`. Delivery events are asynchronous. A
 * gate that reads a slow event as a success is the measured-absence defect this project has
 * already shipped once, in scripts/run-health-checks.mjs, where a failed read was reported
 * as a measured `blocked`. Unknown is a third answer and it is an honest one.
 *
 * IT SENDS AT MOST ONE A DAY. The oracle runs all 88 probes several times in a session, and
 * a gate that mails the client on each of those is not a gate, it is a mailing list. So the
 * live send is cached: if this gate already got a terminal answer within FRESH_HOURS, it
 * reports THAT answer WITH ITS AGE and sends nothing. `--force` sends anyway.
 *
 * Reporting a measurement with its age is the same rule the Stripe screen follows - show
 * the probe and how old it is, or re-probe, but never render a bare boolean. A cached
 * delivery from four hours ago is a fact about this system; a fresh one every ten minutes is
 * a fact about nothing plus an irritated client.
 */
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv, isResendKey } from './_env.mjs';

// See gates/_env.mjs: the gate owns its environment so the oracle measures the same run.
console.log(`  env: ${JSON.stringify(loadEnv())}`);

const MARK = 'DEMO—negative-control';
const FRESH_HOURS = 24;
const force = process.argv.includes('--force');
const POLL_SECONDS = 90;
const POLL_EVERY = 6;

let pass = 0, fail = 0, unknown = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m) => { console.log(`  FAIL  ${n} — ${m}`); fail++; };
const dunno = (n, m) => { console.log(`  UNKNOWN  ${n} — ${m}`); unknown++; };

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log("  UNKNOWN  DATABASE_URL is not set — nothing was measured"); process.exit(1); }

const key = process.env.RESEND_API_KEY || '';
if (!isResendKey(key)) {
  console.log("  UNKNOWN  RESEND_API_KEY is not a usable Resend credential, so a live send " +
              "cannot be attempted. Re-run with --env-file=../../.env after .env.local.");
  console.log("  This is 'unknown', not 'passed'. Nothing was measured.");
  process.exit(1);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();

const readSetting = async (k) => {
  const { rows } = await c.query('select value from settings where key = $1', [k]);
  return rows.length ? rows[0].value : null;
};
const writeSetting = async (k, v) => c.query(
  `insert into settings (key, value, updated_by) values ($1, $2::jsonb, 'demo-negative-control')
     on conflict (key) do update set value = excluded.value,
       updated_by = 'demo-negative-control', updated_at = now()`,
  [k, JSON.stringify(v)]);

const captured = {
  demoMode: await readSetting('demo.mode'),
  recipients: (await readSetting('notify.lead_recipients')) || [],
  cc: (await readSetting('notify.lead_cc')) || [],
};
const realSet = new Set([...captured.recipients, ...captured.cc].map((a) => String(a).toLowerCase()));

console.log(`  captured: demo.mode=${captured.demoMode}`);
console.log(`  a live send must reach: ${captured.recipients.join(', ')}` +
            `${captured.cc.length ? ` (cc ${captured.cc.join(', ')})` : ''}`);

if (!captured.recipients.length) {
  dunno('there is a real recipient to reach', 'notify.lead_recipients is empty');
  await c.end();
  process.exit(1);
}

// Has this gate already had a terminal answer recently enough to trust?
const { rows: recent } = await c.query(
  `select id, state, last_event, last_error, created_at,
          extract(epoch from (now() - created_at)) / 3600 as age_hours
     from outbox
    where payload->>'mark' = $1 and state in ('delivered', 'failed')
    order by created_at desc limit 1`,
  [MARK]);

if (recent.length && !force && Number(recent[0].age_hours) < FRESH_HOURS) {
  const r = recent[0];
  const age = Number(r.age_hours);
  const when = age < 1 ? `${Math.round(age * 60)} minutes ago` : `${age.toFixed(1)} hours ago`;
  console.log(`  cached: measured ${when} — no email sent this run (--force to re-send)`);
  if (r.state === 'delivered') {
    ok('live-send-seen: a real send reached a real recipient', `measured ${when}`);
    ok('DELIVERED, from an observed provider event', `last_event=${r.last_event}, measured ${when}`);
  } else {
    no('DELIVERED, from an observed provider event',
       `the last live send FAILED ${when}: ${r.last_event} (${r.last_error})`);
  }
  await c.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${unknown} unknown`);
  console.log(fail === 0 ? 'PASS — live-send-seen and delivered' : 'FAIL');
  process.exit(fail === 0 ? 0 : 1);
}

const restore = async () => {
  await writeSetting('demo.mode', captured.demoMode === true);
  console.log(`  restored: demo.mode=${await readSetting('demo.mode')}`);
};

try {
  compileServer();
  const { sendEmail } = await import(`../.gate-build/server/lib/notify.js?t=${Date.now()}`);
  const { reconcileOutbox } = await import(`../.gate-build/server/lib/delivery.js?t=${Date.now()}`);

  // Demo mode OFF. This is the state the business runs in.
  await writeSetting('demo.mode', false);
  if ((await readSetting('demo.mode')) !== false) throw new Error('could not turn demo mode off');

  const sent = await sendEmail({
    purpose: 'lead',
    recipients: { settingKey: 'notify.lead_recipients' },
    ccSettingKey: 'notify.lead_cc',
    fromName: 'Scoop Dogg Leads',
    subject: '[AMTECH delivery check] not a lead — no action needed',
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
      <h2 style="color:#1B4332">AMTECH delivery check</h2>
      <p>This is an automated check that lead notifications are reaching this inbox.
      It is not a customer enquiry and needs no reply.</p>
      <p style="color:#888;font-size:13px">Sent by gates/demo-negative-control.mjs.</p>
    </div>`,
    mark: MARK,
  });

  // 1. It was addressed to a real recipient. This is the half the no-leak gate cannot do.
  const deliveredTo = (sent.deliveredTo || []).map((a) => String(a).toLowerCase());
  const reached = deliveredTo.filter((a) => realSet.has(a));
  reached.length
    ? ok('live-send-seen: the message was addressed to a real recipient', reached.join(', '))
    : no('live-send-seen: the message was addressed to a real recipient',
         `it went to ${deliveredTo.join(', ') || '(nowhere)'} — demo mode is still rewriting, ` +
         `or the recipient list is not being read`);

  // 2. The provider accepted it, and the row says accepted rather than delivered.
  if (sent.state === 'delivering' && sent.providerId) {
    ok('the provider accepted it', `state=delivering, id recorded`);
  } else {
    no('the provider accepted it', `state=${sent.state}, error=${sent.error ?? 'none'}`);
  }
  if (sent.state === 'delivered') {
    no('the send call does not claim delivery', 'a 200 means accepted, not delivered');
  }

  // 3. Poll for a terminal event. Bounded, and `unknown` on timeout.
  if (sent.outboxId && sent.providerId) {
    let state = sent.state;
    let event = null;
    const deadline = Date.now() + POLL_SECONDS * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_EVERY * 1000));
      await reconcileOutbox(50);
      const { rows } = await c.query(
        'select state, last_event, last_error from outbox where id = $1', [sent.outboxId]);
      state = rows[0].state;
      event = rows[0].last_event;
      if (state !== 'pending' && state !== 'delivering') break;
      process.stdout.write('.');
    }
    if (state === 'delivering' || state === 'pending') process.stdout.write('\n');

    if (state === 'delivered') {
      ok('DELIVERED, from an observed provider event', `last_event=${event}`);
    } else if (state === 'failed') {
      const { rows } = await c.query('select last_error from outbox where id = $1', [sent.outboxId]);
      no('DELIVERED, from an observed provider event',
         `the message did not arrive: ${event} (${rows[0].last_error}). ` +
         `This is a real delivery problem, not a gate problem.`);
    } else {
      dunno('DELIVERED, from an observed provider event',
            `no terminal event after ${POLL_SECONDS}s — state is still '${state}'. ` +
            `Delivery events are asynchronous, so this is UNKNOWN and not a pass. ` +
            `Re-run scripts/reconcile-deliveries.mjs in a minute and read the row.`);
    }
  } else {
    dunno('DELIVERED, from an observed provider event', 'nothing was accepted, so nothing to poll');
  }
} catch (e) {
  no('the gate ran to completion', e.message);
} finally {
  await restore();
  cleanupCompile();
  await c.end();
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${unknown} unknown`);
if (fail === 0 && unknown === 0) console.log('PASS — live-send-seen and delivered');
else if (fail === 0) console.log("UNKNOWN — the live send was seen; delivery is unconfirmed. Not a pass.");
else console.log('FAIL');
process.exit(fail === 0 && unknown === 0 ? 0 : 1);
