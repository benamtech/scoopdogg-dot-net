/**
 * The onboarding checklist (P18 §2): the facts only the owner can give, as state rather than
 * as a form he has ticked.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: **done means a row exists.** Nothing here stores whether
 * an item was "completed"; every item is a query over the rows the site actually reads, so the
 * checklist cannot drift from the thing it describes. A checklist with its own state is a
 * second source of truth, and the first time they disagree the admin is lying politely.
 *
 * THE SECOND RULE: an item that cannot be measured says so. It never reports `done: false` when
 * the honest answer is "there is nothing here to read yet" - `area_postal_codes` does not exist
 * until migration 019 and photo storage is not connected at all, and both of those are
 * `measurable: false`, not "not done". Rule 14 in the brain's own words: a blank field is not a
 * fact, and an absence of evidence is not evidence of absence.
 *
 * Every item states WHAT IT CHANGES, in Josue's words, because a checklist that only says what
 * it wants is a nag. "Set your route days and the site can tell a customer their actual day
 * instead of 'we'll be in touch'" is the difference.
 */
import { db } from './db.js';

export type ChecklistItem = {
  key: 'stripe' | 'route_days' | 'business_facts' | 'prices' | 'where_you_work' | 'photos';
  title: string;
  what_it_changes: string;
  /** True only when the row it writes exists. Null when nothing can be read yet. */
  done: boolean | null;
  measurable: boolean;
  detail: string;
  /** Set when something outside the owner's control stops this being answerable. */
  blocked_reason?: string;
};

const tableExists = async (name: string): Promise<boolean> => {
  const { rows } = await db().query(`select to_regclass($1) is not null as present`, [`public.${name}`]);
  return Boolean(rows[0]?.present);
};

export type ChecklistArea = { slug: string; name: string; bookable: boolean; service_weekdays: number[] };

/**
 * The checklist, plus the rows its editors write into. They travel together because the grid
 * that sets route days must show what is set NOW - content/catalog.json is a build artefact and
 * would show the owner the state as of the last publish, which is the same class of mistake as a
 * gate reading the built file instead of the database.
 */
export async function checklist(): Promise<{
  items: ChecklistItem[]; done: number; measurable: number;
  areas: ChecklistArea[]; facts: Record<string, unknown>;
}> {
  const items: ChecklistItem[] = [];

  // 1. Stripe. `charges_enabled` is what Stripe says, re-read on every admin load by
  // probeAccount(); a stored boolean would go stale the day a document expires.
  {
    const { rows } = await db().query(
      `select account_id, card_payments_status, revoked_at from stripe_connection where livemode = true`);
    const c = rows[0];
    const done = Boolean(c?.account_id) && c?.card_payments_status === 'active' && !c?.revoked_at;
    items.push({
      key: 'stripe', title: 'Connect Stripe', measurable: true, done,
      what_it_changes: 'Customers can pay on the site. Until this is done every booking is saved as a request and you confirm it yourself.',
      detail: !c?.account_id ? 'No account connected yet.'
        : c.revoked_at ? 'Disconnected.'
        : c.card_payments_status === 'active' ? 'Card payments are on.'
        : `Stripe says card payments are ${c.card_payments_status ?? 'not ready'}.`,
    });
  }

  // 2. Route days. The hinge: the day picker, "same day every week", and ~16 question pages.
  {
    const { rows } = await db().query(
      `select count(*)::int as bookable,
              count(*) filter (where coalesce(array_length(service_weekdays, 1), 0) > 0)::int as set
         from service_areas where status = 'active' and bookable = true`);
    const { bookable, set } = rows[0];
    items.push({
      key: 'route_days', title: 'Which days do you run each city?', measurable: true, done: bookable > 0 && set === bookable,
      what_it_changes: 'The site can tell a customer their actual day instead of "we\'ll be in touch", and it can promise the same day every week.',
      detail: `${set} of ${bookable} cities have their days set.`,
    });
  }

  // 3. The claims about his business. Item 3 is the ONLY place a claim may be entered, so no
  // page ever hard-codes "insured" again.
  {
    const KEYS = ['trust.insured_confirmed', 'trust.background_checked_confirmed', 'trust.guarantee_text', 'reviews.google_count'];
    const { rows } = await db().query(
      `select key from settings where key = any($1::text[]) and value is not null and value <> 'null'::jsonb`, [KEYS]);
    const have = rows.map((r) => r.key);
    const missing = KEYS.filter((k) => !have.includes(k));
    items.push({
      key: 'business_facts', title: "What's true about your business?", measurable: true, done: missing.length === 0,
      what_it_changes: 'Insured, background-checked, your guarantee and your real review count appear on every page. While one is empty the site simply does not claim it.',
      detail: missing.length ? `Still to answer: ${missing.map(shortKey).join(', ')}.` : 'All four answered.',
    });
  }

  // 4. The prices. `billing.package_prices_confirmed` is what the from-price gate reads.
  //
  // WHO CONFIRMED THEM IS PART OF THE ANSWER. Migration 016 set confirmed_by to AMTECH when it
  // raised the ladder to clear the $85/hour floor, so this item is legitimately "done" - the row
  // exists and the from-price gate is satisfied - while Josue has never looked at it. Reporting a
  // bare tick would tell him he had done something he had not, so the detail names the confirmer
  // and the button stays available for him to make them his.
  {
    const { rows } = await db().query(
      `select count(*)::int as active, count(*) filter (where confirmed_at is not null)::int as confirmed,
              max(confirmed_by) filter (where confirmed_at is not null) as by,
              max(confirmed_at)::date::text as at
         from packages where status = 'active'`);
    const { active, confirmed, by, at } = rows[0];
    const { rows: flag } = await db().query(`select value from settings where key = 'billing.package_prices_confirmed'`);
    const done = active > 0 && confirmed === active && flag[0]?.value === true;
    const amtech = typeof by === 'string' && !by.includes('@scoopdogg') && !by.includes('scoopdogg129');
    items.push({
      key: 'prices', title: 'Your prices', measurable: true, done,
      what_it_changes: 'Every price a customer sees is one somebody confirmed. A price nobody has confirmed is shown as a starting figure, never as the price.',
      detail: !done ? `${confirmed} of ${active} plans confirmed.`
        : amtech ? `All ${active} plans are set, confirmed by AMTECH on ${at}. Press the button to make them yours.`
        : `All ${active} plans confirmed by you on ${at}.`,
    });
  }

  // 5. Where you work. area_postal_codes arrives with migration 019; until then there is
  // nothing to read and the item says that rather than reporting a failure.
  {
    if (!(await tableExists('area_postal_codes'))) {
      items.push({
        key: 'where_you_work', title: 'Where you work', measurable: false, done: null,
        what_it_changes: 'A household types its ZIP and hears yes, or hears a straight "not yet" with a date - instead of "somewhere else".',
        detail: 'The postal code map has not been built yet.',
        blocked_reason: 'Waiting on the postal code data (migration 019).',
      });
    } else {
      const { rows } = await db().query(
        `select count(*)::int as bookable,
                count(*) filter (where exists (select 1 from area_postal_codes z where z.area_slug = s.slug))::int as covered
           from service_areas s where s.status = 'active' and s.bookable = true`);
      const { bookable, covered } = rows[0];
      items.push({
        key: 'where_you_work', title: 'Where you work', measurable: true, done: bookable > 0 && covered === bookable,
        what_it_changes: 'A household types its ZIP and hears yes, or hears a straight "not yet" - instead of "somewhere else".',
        detail: `${covered} of ${bookable} cities have postal codes.`,
      });
    }
  }

  // 6. Photos. There is no storage bucket on this project - measured 2026-09-19 against the
  // Vercel project's own variables - so the honest answer is that we cannot take them yet.
  // A drag-and-drop box that silently drops the file would be worse than saying so.
  items.push({
    key: 'photos', title: 'Photos', measurable: false, done: null,
    what_it_changes: 'Your own yards on the city pages and the gallery. It is the strongest thing on the site.',
    detail: 'Photo storage is not connected yet, so there is nowhere for an upload to land.',
    blocked_reason: 'AMTECH has to connect a storage bucket first.',
  });

  const { rows: areas } = await db().query(
    `select slug, name, bookable, service_weekdays from service_areas where status = 'active' order by sort_order`);
  const { rows: factRows } = await db().query(
    `select key, value from settings where key = any($1::text[])`, [OWNER_SETTING_KEYS as unknown as string[]]);

  const measurable = items.filter((i) => i.measurable).length;
  return {
    items, done: items.filter((i) => i.done === true).length, measurable,
    areas: areas as ChecklistArea[],
    facts: Object.fromEntries(factRows.map((r) => [r.key, r.value])),
  };
}

const shortKey = (k: string) =>
  ({ 'trust.insured_confirmed': 'insured', 'trust.background_checked_confirmed': 'background checks',
     'trust.guarantee_text': 'your guarantee', 'reviews.google_count': 'your Google review count' } as Record<string, string>)[k] ?? k;

/** The only settings keys the OWNER may write. Everything else stays superadmin. */
export const OWNER_SETTING_KEYS = [
  'trust.insured_confirmed', 'trust.background_checked_confirmed', 'trust.guarantee_text',
  'reviews.google_count', 'reviews.google_profile_url', 'business.years_in_business',
] as const;

export async function setOwnerSetting(key: string, value: unknown, by: string) {
  if (!(OWNER_SETTING_KEYS as readonly string[]).includes(key)) throw new Error('setting_not_owner_writable');
  const { rows } = await db().query(
    `insert into settings (key, value, updated_by) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, updated_by = $3, updated_at = now()
     returning key, value`, [key, JSON.stringify(value), by]);
  return rows[0];
}

/** The 16x7 grid. Days are 0-6, Sunday first, the same convention as src/shared/pricing.ts. */
export async function setRouteDays(slug: string, weekdays: number[], by: string) {
  const clean = [...new Set(weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const { rows } = await db().query(
    `update service_areas set service_weekdays = $2::int[], updated_at = now()
      where slug = $1 and status = 'active' returning slug, name, service_weekdays`, [slug, clean]);
  if (!rows.length) throw new Error('unknown_area');
  await db().query(
    `insert into settings (key, value, updated_by) values ('schedule.route_days_updated_at', to_jsonb(now()), $1)
       on conflict (key) do update set value = to_jsonb(now()), updated_by = $1, updated_at = now()`, [by]);
  return rows[0];
}

export async function setAreaBookable(slug: string, bookable: boolean) {
  const { rows } = await db().query(
    `update service_areas set bookable = $2, updated_at = now() where slug = $1 and status = 'active'
     returning slug, name, bookable`, [slug, bookable]);
  if (!rows.length) throw new Error('unknown_area');
  return rows[0];
}

/**
 * Confirm the published prices. This is the owner saying "these are my prices", which is what
 * `billing.package_prices_confirmed` means to the from-price gate - not a claim that AMTECH
 * derived them correctly.
 */
export async function confirmPrices(by: string) {
  const { rowCount } = await db().query(
    `update packages set confirmed_at = now(), confirmed_by = $1, source = 'confirmed', updated_at = now()
      where status = 'active' and (confirmed_at is null or source <> 'confirmed')`, [by]);
  await db().query(
    `insert into settings (key, value, updated_by) values ('billing.package_prices_confirmed', 'true'::jsonb, $1)
       on conflict (key) do update set value = 'true'::jsonb, updated_by = $1, updated_at = now()`, [by]);
  return { confirmed: rowCount };
}
