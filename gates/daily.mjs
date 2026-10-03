/**
 * Nothing waits for someone to open a screen: the daily run does what is due, and says what it did.
 *
 *   node gates/daily.mjs
 *
 * A. THE STEPS, each through its shipped function with this gate's client inside a transaction
 *    that is always rolled back, on rows the gate plants, reading back what each one changed:
 *      - a sent quote past its date expires (and its placeholder subscription is cancelled);
 *        one still in date does not;
 *      - a quote opened three days ago and not approved goes on the follow-up list, with a text
 *        written and an sms: link; one opened today does not; marking it done takes it off; the
 *        run does not list it twice;
 *      - a custom job done and paid is eligible for the review ask; one done and not paid is not;
 *      - the growth card counts what the list holds.
 * B. THE ROUTE, api/cron.ts compiled and called the way Vercel Cron calls it:
 *      - no CRON_SECRET on the deployment -> 503, it does not run for whoever finds the URL;
 *      - a wrong token -> 401;
 *      - the right token -> it runs, and against a database it cannot reach every step reports its
 *        own error and the rest still run (one failing step must not stop the others). That run
 *        happens in a child process with an unreachable DATABASE_URL, so it writes nothing.
 *
 * WHY THE REAL RUN IS NOT CALLED HERE. It sends email to real customers (the review asks) and
 * records each as sent once per customer; a gate firing it would both mail people and use up the
 * one ask each customer gets. Production runs it from Vercel Cron after the merge; the after-merge
 * check reads `settings.daily.last_run` the next morning.
 */
import pg from 'pg';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const out = compileServer();
const D = await import(path.resolve(out, 'server/lib/daily.js'));
const C = await import(path.resolve(out, 'server/lib/comms.js'));
const G = await import(path.resolve(out, 'server/lib/growth.js'));
const { db } = await import(path.resolve(out, 'server/lib/db.js'));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const STAMP = Date.now().toString().slice(-7);

try {
  console.log('A. the steps, on planted rows');
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');
  const { rows: [cu] } = await c.query(`insert into customers (name, phone, email) values ($1, $2, 'gate-daily@example.invalid') returning id`, [`DEMO—Gate daily ${STAMP}`, `80554${STAMP.slice(-5)}`]);
  const lead = async (tag) => (await c.query(
    `insert into leads (id, name, phone, email, city, customer_id, kind, created_at, request_token) values (gen_random_uuid(), $1, $2, 'gate-daily@example.invalid', 'Ventura', $3, 'custom', now(), $4) returning id`,
    [`DEMO—Gate ${tag} ${STAMP}`, `80554${STAMP.slice(-5)}`, cu.id, `gate${tag}${STAMP}`.padEnd(32, 'x')])).rows[0].id;
  const quote = async (tag, cols) => {
    const l = await lead(tag);
    const keys = Object.keys(cols), vals = Object.values(cols);
    const { rows: [q] } = await c.query(
      `insert into quotes (lead_id, customer_id, title, total_cents, ${keys.join(', ')}) values ($1, $2, $3, 40000, ${keys.map((_, i) => `$${i + 4}`).join(', ')}) returning id, number`,
      [l, cu.id, `Gate ${tag}`, ...vals]);
    return q;
  };
  const stale = await quote('stale', { state: 'sent', sent_at: new Date(Date.now() - 40 * 864e5), valid_until: new Date(Date.now() - 3 * 864e5) });
  const fresh = await quote('fresh', { state: 'sent', sent_at: new Date(), valid_until: new Date(Date.now() + 20 * 864e5) });
  const opened = await quote('opened', { state: 'sent', sent_at: new Date(Date.now() - 4 * 864e5), valid_until: new Date(Date.now() + 20 * 864e5), first_viewed_at: new Date(Date.now() - 3 * 864e5), view_count: 2 });
  const today = await quote('today', { state: 'sent', sent_at: new Date(), valid_until: new Date(Date.now() + 20 * 864e5), first_viewed_at: new Date(), view_count: 1 });

  const ex = await D.expireDueQuotes(c);
  const state = async (q) => (await c.query(`select state from quotes where id = $1`, [q.id])).rows[0].state;
  check(ex.numbers.includes(stale.number) && await state(stale) === 'expired', 'a sent quote past its date is expired by the run', `#${stale.number}`);
  check(await state(fresh) === 'sent' && !ex.numbers.includes(fresh.number), 'NEGATIVE CONTROL: a quote still in date is left open');
  const { rows: evx } = await c.query(`select 1 from events where subject_kind = 'quote' and subject_id = $1 and event_type = 'quote.expired'`, [stale.id]);
  check(evx.length === 1, 'the expiry is on the event spine, from the system');

  const fu = await D.quoteFollowUps(c, 'https://scoopdogg.net', { email: false });
  check(fu.numbers.includes(opened.number), 'a quote opened three days ago and not approved goes on the follow-up list', `#${opened.number}`);
  check(!fu.numbers.includes(today.number), 'NEGATIVE CONTROL: one opened today does not');
  const list = await D.nudgeList(c);
  const mine = list.find((n) => n.id === opened.id);
  check(!!mine && /^sms:\+1\d{10}\?&body=/.test(mine.sms_href) && /quote/.test(mine.text), 'the list carries a written text and a link that opens Messages with it', mine?.sms_href.slice(0, 40));
  const again = await D.quoteFollowUps(c, 'https://scoopdogg.net', { email: false });
  check(!again.numbers.includes(opened.number), 'the next run does not list it a second time');
  const card = await G.whereTimeGoes(c);
  check(card.quotes_to_nudge >= 1, 'the growth card counts the quotes waiting on a follow-up', `${card.quotes_to_nudge}`);
  await D.markNudged(c, opened.id, 'gate+daily@example.invalid');
  check(!(await D.nudgeList(c)).some((n) => n.id === opened.id), 'marking it done takes it off the list');

  const paid = await quote('paid', { state: 'accepted', accepted_at: new Date(), completed_at: new Date(Date.now() - 5 * 864e5), balance_paid_at: new Date(Date.now() - 5 * 864e5) });
  const unpaid = await quote('unpaid', { state: 'accepted', accepted_at: new Date(), completed_at: new Date(Date.now() - 5 * 864e5) });
  const el = await C.eligibleForJobReview(c, 2);
  check(el.some((r) => r.customer_id === cu.id && r.title === 'Gate paid'), 'a custom job done and paid two days ago is due the review ask', `#${paid.number}`);
  check(!el.some((r) => r.title === 'Gate unpaid'), `NEGATIVE CONTROL: a job done and not paid is not (#${unpaid.number})`);
  const el0 = await C.eligibleForJobReview(c, 30);
  check(!el0.some((r) => r.customer_id === cu.id), 'NEGATIVE CONTROL: with a 30-day delay it is not due yet');
  await c.query('rollback');

  console.log('\nB. the route, as Vercel Cron calls it');
  const probe = (env, auth) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { default: h } = await import(${JSON.stringify(path.resolve(out, 'api/cron.js'))});
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { console.log(JSON.stringify({ status: this.statusCode, body: JSON.parse(b) })); } };
    await h({ headers: ${JSON.stringify(auth ? { authorization: auth, host: 'scoopdogg.net' } : { host: 'scoopdogg.net' })} }, res);
    process.exit(0);
  `], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 90_000 }).trim().split('\n').pop();
  const secret = `gate-${STAMP}-${Math.random().toString(36).slice(2)}`;
  const none = JSON.parse(probe({}, `Bearer ${secret}`));
  check(none.status === 503, 'with no CRON_SECRET on the deployment the route refuses to run', `${none.status}`);
  const wrong = JSON.parse(probe({ CRON_SECRET: secret }, 'Bearer not-the-secret'));
  check(wrong.status === 401, 'a wrong token is refused', `${wrong.status}`);
  const unreachable = 'postgres://gate:gate@127.0.0.1:9/nowhere?sslmode=disable';
  const run = JSON.parse(probe({ CRON_SECRET: secret, DATABASE_URL: unreachable, SD_FORCE_DEMO: '1' }, `Bearer ${secret}`));
  const steps = Object.keys(run.body.results ?? {});
  check(run.status === 200 && ['pauses', 'quote_expiry', 'quote_follow_ups', 'job_review', 'comms'].every((k) => steps.includes(k)),
    'the right token runs every step', steps.join(', '));
  check(steps.length === 5 && steps.every((k) => run.body.results[k]?.error === true), 'a step that fails reports it, and the steps after it still ran', `${steps.filter((k) => run.body.results[k]?.error).length} of ${steps.length} reported an error against an unreachable database`);
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  await db().end().catch(() => {});
  cleanupCompile(out);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
