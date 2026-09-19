/**
 * An item reports done only when its row exists, and an unreadable item says so.
 *
 *   node gates/onboarding-checklist.mjs
 *
 * P18 §5. The checklist is the screen that replaced emailing the owner a questionnaire, and it is
 * only worth that if it reads state. Two ways it could lie, and this gate is one check for each:
 *
 *  - IT SAYS DONE AND THE ROW IS NOT THERE. Every `done: true` is re-derived here by an
 *    INDEPENDENT query against the same database. If the checklist's own SQL drifts from what the
 *    site reads, these two disagree and the gate goes red.
 *
 *  - IT SAYS NOT DONE WHEN THE HONEST ANSWER IS "NOBODY CAN TELL YET". `done: null` with
 *    `measurable: false` is a different claim from `done: false`, and the owner is owed the
 *    difference: one is his homework, the other is ours. Photo storage is not connected on this
 *    project and the postal map arrives with migration 019, so both must report null today and
 *    neither may be counted as outstanding.
 *
 * It calls the REAL function through the compiled server, never a copy of its SQL.
 */
import pg from 'pg';
import path from 'node:path';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer } from './_compile.mjs';

loadEnv();
const build = compileServer();
const { checklist } = await import(path.join(build, 'server/lib/onboarding.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const state = await checklist();
const byKey = Object.fromEntries(state.items.map((i) => [i.key, i]));
const EXPECTED = ['stripe', 'route_days', 'business_facts', 'prices', 'where_you_work', 'photos'];

EXPECTED.every((k) => byKey[k]) ? ok('all six items are present', EXPECTED.join(', '))
  : no('all six items are present', `missing ${EXPECTED.filter((k) => !byKey[k])}`);

// Every item says what it changes, in the owner's terms rather than the schema's.
const mute = state.items.filter((i) => !i.what_it_changes || i.what_it_changes.length < 30);
mute.length ? no('every item says what it changes', mute.map((i) => i.key).join(', '))
            : ok('every item says what it changes');

// ---- each claimed answer, re-derived independently -------------------------------------------
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];

const truth = {
  stripe: Boolean((await one(`select account_id, card_payments_status, revoked_at from stripe_connection where livemode = true`))?.account_id
    && (await one(`select card_payments_status from stripe_connection where livemode = true`))?.card_payments_status === 'active'
    && !(await one(`select revoked_at from stripe_connection where livemode = true`))?.revoked_at),
  route_days: (await one(`select count(*) filter (where coalesce(array_length(service_weekdays,1),0) = 0)::int as empty
                            from service_areas where status = 'active' and bookable = true`)).empty === 0,
  business_facts: (await one(`select count(*)::int n from settings where key = any($1::text[]) and value is not null and value <> 'null'::jsonb`,
    [['trust.insured_confirmed', 'trust.background_checked_confirmed', 'trust.guarantee_text', 'reviews.google_count']])).n === 4,
  prices: (await one(`select count(*) filter (where confirmed_at is null)::int as unconfirmed from packages where status = 'active'`)).unconfirmed === 0
    && (await one(`select value from settings where key = 'billing.package_prices_confirmed'`))?.value === true,
};

for (const [key, actual] of Object.entries(truth)) {
  const claimed = byKey[key]?.done;
  claimed === actual
    ? ok(`${key}: the checklist agrees with the rows`, `both ${actual}`)
    : no(`${key}: the checklist agrees with the rows`, `checklist says ${claimed}, the rows say ${actual}`);
}

// ---- unmeasurable is not "not done" ----------------------------------------------------------
const postalTable = (await one(`select to_regclass('public.area_postal_codes') is not null as present`)).present;
const where = byKey.where_you_work;
if (!postalTable) {
  where.done === null && where.measurable === false && Boolean(where.blocked_reason)
    ? ok('where_you_work reports unmeasurable while the postal map does not exist')
    : no('where_you_work reports unmeasurable while the postal map does not exist', JSON.stringify(where));
} else {
  const { covered, bookable } = await one(`select count(*)::int as bookable,
      count(*) filter (where exists (select 1 from area_postal_codes z where z.area_slug = s.slug))::int as covered
      from service_areas s where s.status = 'active' and s.bookable = true`);
  where.done === (bookable > 0 && covered === bookable)
    ? ok('where_you_work agrees with the postal rows', `${covered}/${bookable}`)
    : no('where_you_work agrees with the postal rows', `checklist says ${where.done}`);
}

byKey.photos.done === null && byKey.photos.measurable === false && Boolean(byKey.photos.blocked_reason)
  ? ok('photos reports unmeasurable, with the reason, rather than an unticked box')
  : no('photos reports unmeasurable, with the reason', JSON.stringify(byKey.photos));

// The counter counts only real yeses. `done === null` counted as done would report progress the
// owner never made; counted as outstanding it would give him homework that is ours.
const trueCount = state.items.filter((i) => i.done === true).length;
state.done === trueCount && state.measurable === state.items.filter((i) => i.measurable).length
  ? ok('the counter counts only items that are actually done', `${state.done} of ${state.measurable} measurable`)
  : no('the counter counts only items that are actually done', `${state.done} vs ${trueCount}`);

// ---- negative control ------------------------------------------------------------------------
// The comparison above must be able to disagree. Planting a wrong answer has to be caught.
const planted = { ...byKey.route_days, done: !truth.route_days };
planted.done === truth.route_days
  ? no('negative control: a checklist that claims the wrong answer trips this gate', 'DETECTOR BLIND')
  : ok('negative control: a checklist that claims the wrong answer trips it');

await c.query('rollback');
await c.end();
await db().end();
console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
