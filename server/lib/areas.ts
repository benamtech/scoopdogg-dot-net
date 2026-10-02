/**
 * areas.ts — the service areas as the owner runs them: which cities he serves, on which days.
 *
 * The writers for route days and bookable already exist (server/lib/onboarding.ts setRouteDays,
 * setAreaBookable). This file is the read the Areas screen and the admin's city pickers use, so no
 * admin screen carries a copy of the area list in its JavaScript.
 */
import { db } from './db.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export async function listAreas(q: Queryable = db()) {
  const { rows } = await q.query(
    `select a.slug, a.name, a.bookable, a.market, a.market_label, a.service_weekdays, a.status, a.sort_order,
            (select count(distinct s.customer_id)::int from subscriptions s
              where s.area_slug = a.slug and s.state in ('active', 'paused')) as customers,
            (select count(*)::int from visits v join subscriptions s on s.id = v.subscription_id
              where s.area_slug = a.slug and v.scheduled_for between current_date and current_date + 14
                and v.state not in ('cancelled', 'rescheduled')) as visits_next_14
       from service_areas a
      where a.status = 'active'
      order by a.sort_order, a.name`);
  return rows;
}
