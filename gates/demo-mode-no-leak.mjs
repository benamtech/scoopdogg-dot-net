/**
 * With demo mode ON, prove that ZERO notifications reach a real recipient.
 *
 *   node --env-file=.env.local --env-file=../../.env gates/demo-mode-no-leak.mjs
 *
 * The second --env-file is not optional and the order matters: .env.local carries this
 * project's DATABASE_URL, and its RESEND_API_KEY is a placeholder, so the real sending
 * credential has to come after it to win. A gate that ran on the placeholder would watch
 * every send fail and call that "no leak", which is the same defect as a negative control
 * that cannot go red.
 *
 * TWO STAGES, AND THE ORDER IS A SAFETY PROPERTY.
 *
 *   Stage 1 runs with NO network at all. RESEND_API_KEY is removed from the environment
 *   for the duration, so resendFetch throws before it can reach anything, while sendEmail
 *   has already resolved and rewritten the addresses and written them onto the outbox row.
 *   Reading that row proves the rewrite happens BEFORE the network call - which is the
 *   actual claim - and it cannot post a byte.
 *
 *   Stage 2 only runs if stage 1 passed. It fires all three notification classes for real.
 *   If stage 1 is green, the only address stage 2 can reach is demo.address.
 *
 * The order is what makes this gate safe to run against a live client's database and a live
 * sending domain. Firing first and checking afterwards would mean a broken demo mode is
 * discovered by an email arriving in the owner's inbox.
 *
 * IT RESTORES WHAT IT CHANGED. demo.mode is captured before anything and written back at
 * the end, including on failure.
 */
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv, isResendKey } from './_env.mjs';

// The gate resolves its own environment, so it measures the same thing whether it is run
// by hand with --env-file or as a bare command by the oracle. See gates/_env.mjs.
console.log(`  env: ${JSON.stringify(loadEnv())}`);

const MARK = 'DEMO—no-leak-gate';
// Stage 2 posts three real messages. They go to AMTECH's own address, so they cost nobody
// anything but noise - and the oracle runs every probe several times a session, so the
// noise is real. Cached the same way as the negative control: a recent stage-2 result is
// reported with its age, and --force re-sends.
const FRESH_HOURS = 24;
const force = process.argv.includes('--force');
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m) => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log('  UNKNOWN  DATABASE_URL is not set — nothing was measured'); process.exit(1); }

const key = process.env.RESEND_API_KEY || '';
const usableKey = isResendKey(key);

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();

const readSetting = async (k) => {
  const { rows } = await c.query('select value from settings where key = $1', [k]);
  return rows.length ? rows[0].value : null;
};
const writeSetting = async (k, v) => c.query(
  `insert into settings (key, value, updated_by) values ($1, $2::jsonb, 'demo-no-leak-gate')
     on conflict (key) do update set value = excluded.value,
       updated_by = 'demo-no-leak-gate', updated_at = now()`,
  [k, JSON.stringify(v)]);

// 1. Capture. Everything after this must be undone.
const captured = {
  demoMode: await readSetting('demo.mode'),
  demoAddress: await readSetting('demo.address'),
  recipients: (await readSetting('notify.lead_recipients')) || [],
  cc: (await readSetting('notify.lead_cc')) || [],
};
/**
 * THE LEAK SET IS `notify.lead_recipients`, NOT the CC list, and the difference is the
 * whole point of the gate rather than a loosening of it.
 *
 * `notify.lead_cc` is AMTECH's own oversight address, and `demo.address` is deliberately
 * the same address - Ben's. So "no real address received this" cannot mean "nobody in
 * recipients-plus-cc received it": that is false by construction the moment demo mail is
 * sent anywhere AMTECH can read it, and a gate that can never pass tells you nothing.
 *
 * What must never happen is a message reaching the CLIENT. That is `lead_recipients`, and
 * it is what the falsifier names: one delivery to the owner's inbox during a demo run.
 *
 * The configuration check below is what keeps this honest - if demo.address is ever set to
 * one of the client's own addresses, the gate refuses instead of passing vacuously.
 */
const leakSet = new Set(captured.recipients.map((a) => String(a).toLowerCase()));

console.log(`  captured: demo.mode=${captured.demoMode}, ` +
            `${captured.recipients.length} client recipient(s) + ${captured.cc.length} cc, ` +
            `demo.address=${captured.demoAddress ?? '(unset)'}`);
console.log(`  a leak means: any message reaching ${[...leakSet].join(' or ')}`);

if (!leakSet.size) {
  console.log('  UNKNOWN  notify.lead_recipients is empty, so there is no client address ' +
              'this gate could leak to. Nothing was measured.');
  await c.end();
  process.exit(1);
}
if (captured.demoAddress && leakSet.has(String(captured.demoAddress).toLowerCase())) {
  console.log(`  UNKNOWN  demo.address (${captured.demoAddress}) is one of the client's own ` +
              `recipients, so demo mode sends TO the client by design and this gate could ` +
              `only ever pass vacuously. Point demo.address at an AMTECH address.`);
  await c.end();
  process.exit(1);
}
if (!captured.demoAddress) {
  console.log('  UNKNOWN  demo.address is unset, so demo mode has nowhere to send. Set it first.');
  await c.end();
  process.exit(1);
}

let sendEmail;
const restore = async () => {
  await writeSetting('demo.mode', captured.demoMode === true);
  const back = await readSetting('demo.mode');
  console.log(`  restored: demo.mode=${back}`);
};

try {
  compileServer();
  ({ sendEmail } = await import(`../.gate-build/server/lib/notify.js?t=${Date.now()}`));

  await writeSetting('demo.mode', true);
  if ((await readSetting('demo.mode')) !== true) throw new Error('could not turn demo mode on');

  const sinceId = Number((await c.query('select coalesce(max(id),0)::bigint n from outbox')).rows[0].n);

  // ------------------------------------------------------------------ stage 1
  // No credential in the environment, so nothing can be posted. This measures the rewrite,
  // which is the property, not the send.
  const realKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const dryClasses = [
    ['lead', { purpose: 'lead', recipients: { settingKey: 'notify.lead_recipients' },
               ccSettingKey: 'notify.lead_cc' }],
    ['contact', { purpose: 'contact', recipients: { settingKey: 'notify.lead_recipients' },
                  ccSettingKey: 'notify.lead_cc' }],
    ['admin_login', { purpose: 'admin_login',
                      recipients: { explicit: [String(captured.recipients[0])] } }],
  ];

  for (const [label, args] of dryClasses) {
    await sendEmail({ ...args, subject: `${MARK} ${label} (no network)`,
                      html: '<p>gate</p>', mark: MARK });
  }

  const { rows: dryRows } = await c.query(
    `select id, purpose, demo, state, payload from outbox where id > $1 order by id`, [sinceId]);

  if (dryRows.length !== 3) {
    no('stage 1 wrote one row per class', `expected 3 rows, got ${dryRows.length}`);
  } else {
    ok('stage 1 wrote one row per class', '3 rows, one each for lead, contact, admin_login');
  }

  const leaked = dryRows.filter((r) => {
    const addrs = [...(r.payload.to || []), ...(r.payload.cc || [])].map((a) => String(a).toLowerCase());
    return addrs.some((a) => leakSet.has(a));
  });
  leaked.length
    ? no('no resolved address is a real recipient',
         `${leaked.length} row(s) resolved to a real address BEFORE any network call — ` +
         `demo mode does not rewrite. Stage 2 is NOT run.`)
    : ok('no resolved address is a real recipient', `0 leaked of ${dryRows.length} rows`);

  const wrongTarget = dryRows.filter(
    (r) => JSON.stringify(r.payload.to) !== JSON.stringify([captured.demoAddress]));
  wrongTarget.length
    ? no('every message is addressed to demo.address',
         `${wrongTarget.length} row(s) went somewhere else`)
    : ok('every message is addressed to demo.address', String(captured.demoAddress));

  const notStamped = dryRows.filter((r) => r.demo !== true || r.payload.demo !== true);
  notStamped.length
    ? no('every row is stamped demo', `${notStamped.length} row(s) unstamped`)
    : ok('every row is stamped demo', 'so demo-clear.mjs can remove exactly them');

  const keptRequested = dryRows.filter(
    (r) => Array.isArray(r.payload.requested_to) && r.payload.requested_to.length > 0);
  keptRequested.length === dryRows.length
    ? ok('the row records who it WOULD have gone to', 'so a demo send is still auditable')
    : no('the row records who it WOULD have gone to',
         `${dryRows.length - keptRequested.length} row(s) lost requested_to`);

  process.env.RESEND_API_KEY = realKey;

  // ------------------------------------------------------------------ stage 2
  if (fail > 0) {
    console.log('  SKIPPED stage 2 (a real send) because stage 1 did not prove the rewrite');
  } else if (!usableKey) {
    console.log('  UNKNOWN  stage 2 not run: RESEND_API_KEY is not a usable Resend credential ' +
                '(no re_ prefix). Re-run with --env-file=../../.env after .env.local.');
    console.log('  Stage 1 passed, so the rewrite is proven; the real send is unmeasured.');
  } else if (!force && (await c.query(
      `select count(*)::int n from outbox
        where payload->>'mark' = $1 and demo = true and provider_id is not null
          and created_at > now() - ($2 || ' hours')::interval`,
      [MARK, String(FRESH_HOURS)])).rows[0].n > 0) {
    const { rows: cached } = await c.query(
      `select state, provider_id, payload,
              extract(epoch from (now() - created_at)) / 3600 as age_hours
         from outbox
        where payload->>'mark' = $1 and demo = true and provider_id is not null
        order by created_at desc limit 3`, [MARK]);
    const age = Number(cached[0].age_hours);
    const when = age < 1 ? `${Math.round(age * 60)} minutes ago` : `${age.toFixed(1)} hours ago`;
    const cachedLeak = cached.filter((r) => {
      const addrs = [...(r.payload.to || []), ...(r.payload.cc || [])].map((a) => String(a).toLowerCase());
      return addrs.some((a) => leakSet.has(a));
    });
    console.log(`  cached: stage 2 measured ${when} — nothing sent this run (--force to re-send)`);
    cachedLeak.length
      ? no('stage 2: 0 leaked', `${cachedLeak.length} real send(s) reached a real recipient, ${when}`)
      : ok('stage 2: 0 leaked', `${cached.length} real send(s) ${when}, all to demo.address`);
  } else {
    const beforeLive = Number((await c.query('select coalesce(max(id),0)::bigint n from outbox')).rows[0].n);
    for (const [label, args] of dryClasses) {
      await sendEmail({ ...args, subject: `${MARK} ${label} (real send, demo on)`,
                        html: '<p>gate — demo mode on. Nothing here is a customer.</p>',
                        mark: MARK });
    }
    const { rows: liveRows } = await c.query(
      `select id, purpose, state, payload, provider_id from outbox where id > $1 order by id`,
      [beforeLive]);

    const liveLeak = liveRows.filter((r) => {
      const addrs = [...(r.payload.to || []), ...(r.payload.cc || [])].map((a) => String(a).toLowerCase());
      return addrs.some((a) => leakSet.has(a));
    });
    liveLeak.length
      ? no('stage 2: 0 leaked', `${liveLeak.length} real send(s) reached a real recipient`)
      : ok('stage 2: 0 leaked', `${liveRows.length} real send(s), all to demo.address`);

    const accepted = liveRows.filter((r) => r.state === 'delivering' && r.provider_id);
    accepted.length === liveRows.length
      ? ok('stage 2: the provider accepted every message',
           `${accepted.length}/${liveRows.length} carry a provider id, state=delivering`)
      : no('stage 2: the provider accepted every message',
           `${accepted.length}/${liveRows.length} accepted — ` +
           liveRows.filter((r) => r.state !== 'delivering')
                   .map((r) => `${r.purpose}:${r.state}:${r.payload.reason || ''}`).join(', '));

    const claimedDelivered = liveRows.filter((r) => r.state === 'delivered');
    claimedDelivered.length
      ? no('no row claims delivered from the send call',
           `${claimedDelivered.length} row(s) say delivered on a 200, which means accepted`)
      : ok('no row claims delivered from the send call', 'a 200 is accepted, not delivered');
  }
} catch (e) {
  no('the gate ran to completion', e.message);
} finally {
  await restore();
  cleanupCompile();
}

// The gate's own rows are demo rows and demo-clear.mjs removes them by the demo stamp.
const { rows: left } = await c.query(
  `select count(*)::int n from outbox where payload->>'mark' = $1`, [MARK]);
console.log(`  ${left[0].n} gate row(s) left in outbox — removed by scripts/demo-clear.mjs`);

await c.end();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'PASS — 0 leaked' : 'FAIL');
process.exit(fail === 0 ? 0 : 1);
