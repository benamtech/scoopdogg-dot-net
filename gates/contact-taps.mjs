/**
 * A TAP ON THE PHONE NUMBER OR TEXT LINK IS COUNTED, AND IS NOT A BOOKING START.
 *
 * Calls and texts are where Josue's cash and Venmo jobs start, and until 2026-10-02 a tap left no
 * row. Base.astro's listener posts step 'call' or 'text' to /api/booking/track; funnel.ts writes
 * one `contact.*` event and no funnel_sessions row; growth.ts counts the events. This gate runs
 * that path against the real schema inside a transaction that is rolled back, and checks:
 *   - a tap writes one event, and a second tap of the same kind in the same tab writes none;
 *   - it creates no funnel session, so "Started a price" still means a ZIP was typed;
 *   - the growth board counts a customer's tap and not a verifier's.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const check = (c, w, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${w}${d ? ` — ${d}` : ''}`); };

const base = readFileSync('src/layouts/Base.astro', 'utf8');
check(/a\[href\^="tel:"\], a\[href\^="sms:"\]/.test(base), 'every page listens for tel: and sms: taps', 'src/layouts/Base.astro');
check(/window\.gtag = gtag/.test(base), 'gtag is reachable from outside its define:vars wrapper', 'or no conversion event ever reaches GA');

const out = compileServer();
const mod = (f) => import(`${process.cwd()}/${out}/server/lib/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const { track } = await mod('funnel.js');
const { growthBoard } = await mod('growth.js');

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');
  const before = (await growthBoard(c)).metrics;
  const tab = randomUUID();
  const a = await track({ session_id: tab, step: 'call', source: 'gbp', entry: '/ventura' }, c);
  const b = await track({ session_id: tab, step: 'call', source: 'gbp', entry: '/ventura' }, c);
  await track({ session_id: tab, step: 'text', source: 'gbp', entry: '/ventura' }, c);
  await track({ session_id: randomUUID(), step: 'call', source: 'gate', trusted: true }, c);
  check(a.recorded && !b.recorded, 'one tap, one event; the second tap in the tab writes nothing', JSON.stringify([a, b]));
  const { rows: fs } = await c.query('select 1 from funnel_sessions where id = $1', [tab]);
  check(fs.length === 0, 'a tap creates no funnel session');
  const { rows: [ev] } = await c.query(
    `select payload from events where subject_kind = 'contact' and subject_id = $1 and event_type = 'contact.call_tapped'`, [tab]);
  check(ev?.payload?.source === 'gbp' && ev?.payload?.entry === '/ventura', 'the event keeps where they came from and which page', JSON.stringify(ev?.payload));
  const after = (await growthBoard(c)).metrics;
  check(after.calls_tapped.value - before.calls_tapped.value === 1, 'the board counts the customer call and not the verifier one',
    `${before.calls_tapped.value} -> ${after.calls_tapped.value}`);
  check(after.texts_tapped.value - before.texts_tapped.value === 1, 'and the text', `${before.texts_tapped.value} -> ${after.texts_tapped.value}`);
  check(after.booking_intent_starts.value === before.booking_intent_starts.value, 'booking starts are unchanged by taps');
} catch (e) {
  check(false, 'the gate ran to the end', String(e.message ?? e));
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  cleanupCompile();
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
