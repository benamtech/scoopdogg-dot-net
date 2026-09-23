/**
 * The growth board (P18 §4) and the speed-to-lead block (P16 §7).
 *
 * WHY THIS FILE IS SHORT AND WHY IT REFUSES TO GUESS. R8 §0 names the only scoreboard there is:
 * net adds, sessions, conversion. P19 counted what exists instead - 26 leads in the site's entire
 * life and FOUR rows in `events` - and concluded the gap to 100 customers in six months is about
 * twenty times, which is a demand problem and not a funnel-tuning one. You cannot engineer what
 * you cannot see, so this is the seeing.
 *
 * EVERY NUMBER CARRIES WHETHER IT WAS MEASURED. A conversion rate of 0% and a conversion rate
 * nobody has instrumented look identical on a screen and mean opposite things - the first is a
 * broken funnel, the second is a broken measurement. `measured: false` is the difference, and it
 * is why nothing here coalesces a missing count to zero. The funnel's writer arrives with
 * migration 020; until `funnel_sessions` exists, the top of the funnel says so in words.
 *
 * No analytics vendor, no third-party script, no cookie banner: these are our own rows.
 */
import { db } from './db.js';
import { routeDensity, waitlistZips } from './density.js';
import { VERIFIER_SOURCES } from './funnel.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export type Metric = { value: number | null; measured: boolean; note?: string };

const metric = (value: number | null, measured: boolean, note?: string): Metric =>
  ({ value: measured ? value : null, measured, ...(note ? { note } : {}) });

async function instrumented(q: Queryable = db()): Promise<boolean> {
  const { rows } = await q.query(`select to_regclass('public.funnel_sessions') is not null as present`);
  return Boolean(rows[0]?.present);
}

/**
 * Can this database tell OUR traffic from a customer's? (migration 033)
 *
 * MEASURED 2026-09-23, and it is why every number below carries a filter: `funnel_sessions` held
 * 25 rows and all 25 were AMTECH's own gate runs — four ZIPs, no names, no email addresses, every
 * one inside a build window. The board's headline "booking-intent starts" was a count of our
 * continuous integration, and it grew every time we tested more carefully.
 *
 * Asked rather than asserted, so a database that predates 033 still answers honestly instead of
 * erroring on a column it has never had.
 */
async function attributed(q: Queryable = db()): Promise<boolean> {
  const { rows } = await q.query(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'funnel_sessions' and column_name = 'source'`);
  return Number(rows[0]?.n) === 1;
}

/**
 * `and <this>` — the clause that keeps our own runs out of a client's numbers.
 *
 * `alias` is not decoration: `unfinished()` joins packages and service_areas, so a bare `source`
 * there is ambiguous and Postgres says so. It said so, and this is the fix.
 */
const notOurs = (attributedNow: boolean, alias = '') => {
  const col = alias ? `${alias}.source` : 'source';
  return attributedNow ? `and (${col} is null or ${col} <> all ('{${VERIFIER_SOURCES.join(',')}}'::text[]))` : '';
};

/**
 * `q` IS HOW THIS BECOMES CHECKABLE. `gates/funnel-source.mjs` plants a session inside a
 * transaction, asks THIS function what the board now says, and rolls back — so the negative
 * control ("a verifier's row does not move the owner's number") is run against the shipped query
 * rather than against a copy of it. Every caller in the product passes nothing and gets the pool.
 */
export async function growthBoard(q: Queryable = db()) {
  const funnel = await instrumented(q);
  const attributedNow = funnel && await attributed(q);
  const note = 'The funnel does not write sessions yet, so this has never been measured.';

  let starts: Metric = metric(null, false, note);
  let priced: Metric = metric(null, false, note);
  let ours = 0;
  let bySource: { source: string; sessions: number; priced: number }[] = [];
  if (funnel) {
    const { rows } = await q.query(`
      select count(*)::int as starts,
             count(*) filter (where price_cents_seen is not null)::int as priced
        from funnel_sessions where started_at >= date_trunc('month', now()) ${notOurs(attributedNow)}`);
    starts = metric(rows[0].starts, true);
    priced = metric(rows[0].priced, true);

    if (attributedNow) {
      // What we excluded, said out loud. A silent filter is how a number becomes untrustworthy
      // in the other direction — nobody can tell a quiet month from a broken one.
      const { rows: [o] } = await q.query(
        `select count(*)::int as n from funnel_sessions
          where started_at >= date_trunc('month', now())
            and source = any ('{${VERIFIER_SOURCES.join(',')}}'::text[])`);
      ours = o.n;

      /**
       * WHERE THE MONTH'S SESSIONS CAME FROM. R16 found the top of the funnel is this business's
       * constraint — a close rate near 1.0 means everyone who arrives decided somewhere else —
       * and until migration 033 nothing anywhere recorded where they arrived from. 'direct' is a
       * real answer (a typed URL, a QR code, a message app that strips the referrer), not a gap.
       */
      const { rows: src } = await q.query(`
        select coalesce(source, 'direct') as source, count(*)::int as sessions,
               count(*) filter (where price_cents_seen is not null)::int as priced
          from funnel_sessions
         where started_at >= date_trunc('month', now()) ${notOurs(true)}
         group by 1 order by 2 desc, 1`);
      bySource = src;
    }
  }

  // The money rows exist whatever the funnel does, so these are always measured.
  const { rows: [m] } = await q.query(`
    select count(*) filter (where state = 'active')::int as customers_now,
           count(*) filter (where source = 'online' and state = 'active'
                              and created_at >= date_trunc('month', now()))::int as booked_this_month,
           count(*) filter (where state = 'active' and created_at >= date_trunc('month', now()))::int as new_this_month,
           coalesce(sum(monthly_price_cents) filter (where state = 'active'), 0)::int as mrr_cents
      from subscriptions
     where customer_id not in (select id from customers where name like 'DEMO—%')`);

  const conversion = funnel && starts.value
    ? metric(Math.round((m.booked_this_month / (starts.value || 1)) * 1000) / 10, true)
    : metric(null, false, funnel ? 'No booking-intent sessions this month yet.' : note);

  // P17 §9: Josue's 1099-K reports GROSS, so his accountant needs our fee as a number, by month
  // and by year. Build the column now, not in January.
  const { rows: byMonth } = await q.query(`
    select to_char(date_trunc('month', created_at), 'YYYY-MM') as period,
           sum(amount_cents)::int as collected_cents, sum(platform_fee_cents)::int as fee_cents, count(*)::int as payments
      from payments where state = 'succeeded' and kind = 'charge'
     group by 1 order by 1 desc limit 24`);
  const { rows: byYear } = await q.query(`
    select to_char(date_trunc('year', created_at), 'YYYY') as period,
           sum(amount_cents)::int as collected_cents, sum(platform_fee_cents)::int as fee_cents, count(*)::int as payments
      from payments where state = 'succeeded' and kind = 'charge'
     group by 1 order by 1 desc`);

  /**
   * WHERE THE NEXT CUSTOMER SHOULD COME FROM (server/lib/density.ts).
   *
   * The metrics above count what happened. This is the only block on the board that says what to
   * DO, and it is here rather than in a document because the answer changes every time a customer
   * is added: the marginal cost of a stop in a city falls as that city fills, so the ranking is a
   * function of the book of business and not of anybody's opinion about target markets.
   *
   * It ranks on MINUTES OF DRIVING, which are facts through a model. The one money figure in it,
   * `margin_per_visit`, prices those minutes at migration 036's assumed $70 hour and comes back
   * `measured: false, assumed: true` with its basis — the same discipline the rest of this file
   * keeps, with the assumption named instead of hidden.
   */
  const density = await routeDensity(q).catch(() => ({ measured: false, areas: [], note: 'density unavailable' }));
  const waitlist = await waitlistZips(q).catch(() => ({ measured: false, zips: [], note: 'density unavailable' }));

  return {
    instrumented: funnel,
    /** False on a database that predates 033: the numbers then include AMTECH's own gate runs. */
    attributed: attributedNow,
    /** How many sessions this month were ours and are NOT in the counts above. */
    verifier_sessions_excluded: attributedNow ? ours : null,
    by_source: bySource,
    month: new Date().toISOString().slice(0, 7),
    metrics: {
      booking_intent_starts: starts,
      price_step_reached: priced,
      booked: metric(m.booked_this_month, true),
      conversion_pct: conversion,
      new_customers_this_month: metric(m.new_this_month, true),
      customers_now: metric(m.customers_now, true),
      mrr_cents: metric(m.mrr_cents, true),
      platform_fee_this_month_cents: metric(byMonth[0]?.period === new Date().toISOString().slice(0, 7) ? byMonth[0].fee_cents : 0, true),
    },
    fees_by_month: byMonth,
    fees_by_year: byYear,
    // Cheapest marginal customer first. The top of this list is where a flyer, a neighbourhood
    // page or an hour of Josue's attention is worth the most.
    where_next: density,
    waitlist: waitlist,
  };
}

/**
 * Loop 1, speed to lead (P16 §7). HBR, Oldroyd & McElheran across 2,241 firms: a reply inside
 * the hour makes a lead ~7x more likely to qualify, 60x against a day. So the admin's top block
 * is whoever started and stopped, and one tap opens Josue's own SMS app with the message
 * already written - no Twilio, no 10DLC, no cost, and it comes from the number they already have.
 */
export async function unfinished(withinMinutes = 60, q: Queryable = db()) {
  if (!(await instrumented(q))) {
    return { measured: false, note: 'The funnel does not write sessions yet.', rows: [] as UnfinishedRow[] };
  }
  const { rows } = await q.query(`
    select f.id, f.postal_code, f.city_name, f.step, f.price_cents_seen, f.name, f.phone, f.email,
           f.started_at, f.last_seen_at, p.name as package_name, a.name as area_name
      from funnel_sessions f
      left join packages p on p.id = f.package_id
      left join service_areas a on a.slug = f.area_slug
     where f.subscription_id is null
       and f.last_seen_at > now() - ($1 || ' minutes')::interval
       ${notOurs(await attributed(q), 'f')}
     order by f.last_seen_at desc limit 50`, [String(withinMinutes)]);
  return { measured: true, rows: rows.map(toUnfinished) };
}

export type UnfinishedRow = ReturnType<typeof toUnfinished>;

function toUnfinished(r: Record<string, unknown>) {
  const first = String(r.name ?? '').trim().split(' ')[0];
  const where = r.area_name ?? r.city_name ?? r.postal_code ?? 'your area';
  const price = r.price_cents_seen ? `$${Math.round(Number(r.price_cents_seen) / 100)}/mo` : null;
  const plan = r.package_name ? `${r.package_name}${price ? ` (${price}, first month half off)` : ''}` : 'weekly service';
  const body = `Hi${first ? ` ${first}` : ''} — Josue from Scoop Dogg. I saw you were looking at ${plan} in ${where}. Want me to get you on this week's route?`;
  const phone = String(r.phone ?? '').replace(/\D/g, '');
  return {
    id: r.id, postal_code: r.postal_code, step: r.step, price_cents_seen: r.price_cents_seen,
    name: r.name, phone: r.phone, email: r.email, area: where, plan: r.package_name,
    started_at: r.started_at, last_seen_at: r.last_seen_at,
    // A blank href when there is no number, rather than an sms: link that opens an empty message.
    sms_href: phone.length >= 10 ? `sms:+1${phone.slice(-10)}?&body=${encodeURIComponent(body)}` : null,
    sms_body: body,
  };
}
