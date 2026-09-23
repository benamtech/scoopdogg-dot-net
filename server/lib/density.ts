/**
 * density.ts — what it costs to serve one more customer, and therefore where the next one should
 * come from.
 *
 * THE QUESTION THIS FILE EXISTS TO ANSWER. A lead arrives from Malibu and a lead arrives from
 * Oxnard. Nothing on this project could tell them apart. They are not the same lead, they are not
 * close to the same lead, and the difference is arithmetic rather than opinion.
 *
 * THE ARITHMETIC. Beardwood, Halton and Hammersley (1959) proved that the length of the optimal
 * tour through n points scattered in a region of area A grows like sqrt(n*A); Daganzo's
 * distribution form adds the depot and gives, for a route out of a depot r away,
 *
 *     route distance  ~=  2r  +  k * sqrt(n * A)
 *
 * Divide by n and the whole business model falls out: driving PER STOP falls like 1/n in the
 * line-haul term and like 1/sqrt(n) in the local term. Doubling the customers in a city cuts the
 * driving per customer by more than half in the first term and by 29% in the second. Daganzo also
 * showed that elongated regions cost more than compact ones at equal area and density — which is
 * the shape of this business: measured 2026-09-22, the 31 served ZIPs span 73.1 miles from
 * Ventura (93001) to Simi Valley (93063), and Santa Barbara holds 7 of the 31 at 27 miles out.
 *
 * SO THE MARGINAL COST OF A CUSTOMER DEPENDS ON HOW MANY ARE ALREADY NEXT DOOR. That makes route
 * density a go-to-market variable and not only an operations one: the cheapest customer to acquire
 * and the cheapest customer to serve are different customers, and only one of those was ever
 * visible here.
 *
 * ==========================================================================================
 * WHAT THIS FILE WILL NOT DO, AND IT IS THE MOST IMPORTANT PART.
 *
 * It will not put a dollar figure on any of this. Nobody has asked Josue what an hour of his time
 * or a mile of his van costs, so `routing.cost_per_hour_cents` and `routing.cost_per_mile_cents`
 * are deliberately NOT seeded by migration 031, and every money-denominated figure here reports
 * `measured: false`. It would take one plausible-looking $25/hour to start printing per-city
 * margins that are claims about a business nobody asked, and this project has a standing rule
 * about that (AGENTS.md 7, 14) and a growth board built around `measured` for exactly this reason.
 *
 * WHAT IT REPORTS INSTEAD NEEDS NO COST AT ALL: DRIVING MINUTES, against the service minutes
 * already recorded on every tier as `est_minutes`. "One more customer in Malibu costs 110 minutes
 * of driving for 15 minutes of work" is a complete decision input and it is made of facts —
 * Census coordinates, Google's placement of the business, and Josue's own est_minutes. Ranking
 * cities needs only that.
 *
 * The two speeds, the circuity factor and the BHH constant ARE model parameters, they are rows,
 * and `parameters` is returned alongside every answer so a reader can see what was assumed. The
 * first time anybody times a real route day, those rows change and this file does not.
 * ==========================================================================================
 */
import { db } from './db.js';
import { loadCatalog } from './catalog-db.js';
import { ENOUGH_TIMED_STOPS, stopDurations } from './visits.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Same shape as growth.ts, so the admin board renders one kind of number. */
export type Metric = { value: number | null; measured: boolean; note?: string };
const metric = (value: number | null, measured: boolean, note?: string): Metric =>
  ({ value: measured ? value : null, measured, ...(note ? { note } : {}) });

export type RouteParameters = {
  depot: { lat: number; lon: number; source: string | null };
  circuity: number;
  linehaulMph: number;
  localMph: number;
  bhhK: number;
  /** The reference stop this file measures against. Josue's flagship package, from his own rows. */
  referenceServiceMinutes: number;
  /** Where that number came from: a median of timed stops, or the estimate. Never assumed. */
  referenceBasis: string;
  referenceTier: string;
};

/** Great-circle miles. Straight-line; `circuity` is what turns it into road miles. */
export function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Minutes of driving for a route day serving `n` customers in one area.
 *
 * n = 0 IS ZERO, not 2r. If nobody is there you do not drive there, and a model that charges the
 * line haul for an empty city makes the marginal-customer figure below wrong at exactly the point
 * it matters most — the first customer in a new city, which is the decision this is for.
 */
export function driveMinutes(n: number, rMi: number, areaSqMi: number, p: RouteParameters): number {
  if (n <= 0) return 0;
  const linehaul = 2 * rMi * p.circuity;
  const local = p.bhhK * Math.sqrt(n * areaSqMi) * p.circuity;
  return (linehaul / p.linehaulMph + local / p.localMph) * 60;
}

/** What ONE more customer in this area adds to the driving. The acquisition number. */
export function marginalDriveMinutes(n: number, rMi: number, areaSqMi: number, p: RouteParameters): number {
  return driveMinutes(n + 1, rMi, areaSqMi, p) - driveMinutes(n, rMi, areaSqMi, p);
}

/**
 * How many customers an area needs before the driving per visit costs less than the visit.
 *
 * THIS IS AVERAGE DRIVING, NOT MARGINAL, and the first version of this function got it wrong in a
 * way that only `gates/route-density.mjs` could see: it asked when the MARGINAL customer costs
 * less than a visit, and the answer was 2 for every city in the county, eight miles or thirty-four.
 * Of course it was. The line haul is paid once for the whole route day, so the second customer in
 * Malibu adds almost nothing — the 144 minutes were already spent getting there. Marginal cost is
 * the right number for "is this lead worth having"; it is the wrong number for "is this city worth
 * a route day", and the two questions were sharing a function.
 *
 * So parity is `driveMinutes(n) / n <= referenceServiceMinutes`: the point at which a day spent in
 * this city is more work than travel. Below it the van is the product.
 *
 * Capped at `schedule.day_capacity`, and NULL above it — because "this city cannot pay for itself
 * as a standalone route day" is a different sentence from "this city needs 20", and a function
 * that returned the cap would say the second while meaning the first.
 */
export function customersForParity(rMi: number, areaSqMi: number, p: RouteParameters, cap: number): number | null {
  for (let n = 1; n <= cap; n++) {
    if (driveMinutes(n, rMi, areaSqMi, p) / n <= p.referenceServiceMinutes) return n;
  }
  return null;
}

/**
 * THE `routing.%` ROWS ARE READ WITH SQL, NOT THROUGH loadCatalog().
 *
 * Two reasons and both are deliberate. First, `loadCatalog()` filters settings to an allowlist of
 * prefixes and publishes what it finds to the built site — and the depot coordinate has no
 * business being in a public bundle, whatever Google already shows. Second, reading through the
 * pool would make this function unable to see rows inside a caller's transaction, which is
 * exactly what `gates/route-density.mjs` needs in order to apply migration 031 and roll it back.
 *
 * The reference TIER still comes from `loadCatalog()`: `est_minutes` is Josue's own published row,
 * it is unaffected by 031, and it is the one number here that is a fact about his work.
 */
async function parameters(q: Queryable): Promise<RouteParameters | null> {
  const { tiers } = await loadCatalog();
  const { rows: srows } = await q.query(
    `select key, value #>> '{}' as v from settings where key like 'routing.%'`);
  const raw = new Map<string, string>(srows.map((r: any) => [r.key, r.v]));
  const num = (k: string) => Number(raw.get(k));
  const lat = num('routing.depot_lat'), lon = num('routing.depot_lon');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // The reference stop is Josue's own row, not a number in this file. `weekly-pooper-scooper-
  // service` at 1 dog is the flagship package and its est_minutes is 15.
  const ref = (tiers ?? []).find((t: any) => t.service_slug === 'weekly-pooper-scooper-service' && Number(t.min_qty) <= 1)
    ?? (tiers ?? []).find((t: any) => t.service_slug === 'weekly-pooper-scooper-service');
  if (!ref || !Number.isFinite(Number(ref.est_minutes))) return null;

  /**
   * THE REFERENCE STOP, MEASURED IF IT CAN BE (migration 035).
   *
   * Every number this file produces is denominated in the reference stop: the marginal ratio, the
   * parity threshold, "one more customer in Malibu costs 110 minutes of driving for 15 minutes of
   * work". Until 035 that 15 was `est_minutes`, whose own column comment asks to be replaced with
   * "the median of real visit durations" — so the growth board's whole ranking rested on a guess
   * that nothing could check. `stopDurations()` is the median; it is used once there are enough
   * stops behind it, and `referenceBasis` says which was used rather than leaving a reader to
   * assume.
   */
  const timed = await stopDurations(q).catch(() => null);
  const measuredEnough = !!timed && timed.service_measured >= ENOUGH_TIMED_STOPS && timed.service_minutes !== null;

  return {
    depot: { lat, lon, source: raw.get('routing.depot_source') ?? null },
    circuity: Number.isFinite(num('routing.road_circuity')) ? num('routing.road_circuity') : 1.3,
    linehaulMph: Number.isFinite(num('routing.speed_linehaul_mph')) ? num('routing.speed_linehaul_mph') : 40,
    localMph: Number.isFinite(num('routing.speed_local_mph')) ? num('routing.speed_local_mph') : 22,
    bhhK: Number.isFinite(num('routing.bhh_k')) ? num('routing.bhh_k') : 0.75,
    referenceServiceMinutes: measuredEnough ? Number(timed!.service_minutes) : Number(ref.est_minutes),
    referenceBasis: measuredEnough
      ? `median of ${timed!.service_measured} timed stops`
      : `service_tiers.est_minutes — an estimate; ${timed?.service_measured ?? 0} of ${ENOUGH_TIMED_STOPS} stops timed so far`,
    referenceTier: `${ref.service_slug} / ${ref.label}`,
  };
}

/** Are the coordinates there at all? Asked rather than assumed, like photos.available(). */
export async function geocoded(q: Queryable = db()): Promise<boolean> {
  try {
    const { rows } = await q.query(
      `select count(*)::int as n from information_schema.columns
        where table_name = 'area_postal_codes' and column_name in ('latitude', 'longitude', 'land_sq_mi')`);
    return Number(rows[0]?.n) === 3;
  } catch {
    return false;
  }
}

/**
 * Has migration 032 given us the POPULATION centre as well as the polygon's internal point?
 *
 * WHY THIS IS A QUESTION AND NOT AN ASSUMPTION. Migration 031 wrote the ZCTA internal point, and
 * its own column comment said what that is: a representative coordinate inside the polygon, "not
 * a population centroid". This file used it as the place the customers are anyway — and for ZCTA
 * 93001, which is Ventura PLUS the Channel Islands, the internal point is in the ocean 39.9 miles
 * from a depot inside Ventura. The growth board ranked the depot's own city as the most expensive
 * in the network to serve, and `where_next` is the recommendation that number drives.
 *
 * Asking rather than asserting is the same discipline `photos.available()` keeps: on a database
 * that predates 032 this returns false and the ranking still works off the polygon, saying so.
 */
export async function populatedCentres(q: Queryable = db()): Promise<boolean> {
  try {
    const { rows } = await q.query(
      `select count(*)::int as n from information_schema.columns
        where table_name = 'area_postal_codes' and column_name in ('populated_lat', 'populated_lon', 'populated_sq_mi', 'population')`);
    return Number(rows[0]?.n) === 4;
  } catch {
    return false;
  }
}

/**
 * The SQL for "where is this ZIP and how much ground do its people cover", in whichever of the
 * two vocabularies the database actually has.
 *
 * THE AVERAGE IS POPULATION-WEIGHTED, and that is a second fix rather than a detail. An area's
 * centre was `avg(latitude)` over its ZIPs — every ZIP counting the same whether 37,000 people
 * live in it or 63 do. Ventura's own 90263 (Pepperdine, 63 residents) pulled as hard as 93001
 * (37,236). With `population` on the row there is no reason to keep guessing.
 *
 * AREA falls back per ZIP: `populated_sq_mi` is null where the tract decomposition was too coarse
 * to see a population footprint at all (migration 032 says which, and why), and the polygon's
 * land area is the honest answer there rather than a fabricated one.
 */
function geoColumns(populated: boolean) {
  return populated
    ? {
      basis: 'population' as const,
      lat: 'sum(z.populated_lat * z.population)::float8 / nullif(sum(z.population), 0)::float8',
      lon: 'sum(z.populated_lon * z.population)::float8 / nullif(sum(z.population), 0)::float8',
      land: 'sum(coalesce(z.populated_sq_mi, z.land_sq_mi))::float8',
      zipLat: 'populated_lat::float8', zipLon: 'populated_lon::float8',
      zipLand: 'coalesce(populated_sq_mi, land_sq_mi)::float8',
    }
    : {
      basis: 'polygon' as const,
      lat: 'avg(z.latitude)::float8', lon: 'avg(z.longitude)::float8', land: 'sum(z.land_sq_mi)::float8',
      zipLat: 'latitude::float8', zipLon: 'longitude::float8', zipLand: 'land_sq_mi::float8',
    };
}

export type AreaDensity = {
  slug: string;
  name: string;
  bookable: boolean;
  zips: number;
  /** Straight-line miles from the depot to the area's own centroid. A fact. */
  depot_miles: number;
  /** Census land area summed over the area's ZCTAs. A fact. */
  area_sq_mi: number;
  /** Active subscriptions whose property sits in one of this area's ZIPs. A fact. */
  customers_now: number;
  /** Driving minutes the NEXT customer here adds. Facts through a model. */
  marginal_drive_minutes: number;
  /** That, divided by the reference service time. Below 1.0 the stop is worth the drive. */
  marginal_ratio: number;
  /** Customers needed before the marginal ratio reaches 1.0, or null if it never does inside a day. */
  customers_for_parity: number | null;
  /** Total driving per visit at today's count, which is what a route day actually feels like. */
  drive_minutes_per_visit_now: number | null;
  /** Anything denominated in money. Unmeasured until somebody asks Josue what an hour costs. */
  margin_per_visit: Metric;
};

/**
 * Every area, with the marginal cost of one more customer in it, cheapest first.
 *
 * This ordering IS the recommendation: it is the order in which leads are worth having, and the
 * order in which a flyer drop or a neighbourhood page earns its keep. It changes as customers
 * arrive, which is the property a static "target market" list does not have.
 */
export async function routeDensity(q: Queryable = db()): Promise<{
  measured: boolean;
  note?: string;
  /** `population` once migration 032 is applied, `polygon` before it. Printed, not assumed. */
  geo_basis?: 'population' | 'polygon';
  parameters?: RouteParameters;
  day_capacity?: number;
  /** How many active subscriptions the whole ranking rests on. See `note`. */
  total_customers?: number;
  areas: AreaDensity[];
}> {
  if (!(await geocoded(q))) {
    return { measured: false, areas: [], note: 'area_postal_codes has no coordinates yet (migration 031 has not been applied here).' };
  }
  const p = await parameters(q);
  if (!p) {
    return { measured: false, areas: [], note: 'routing.depot_lat/lon are not set, or no reference tier carries est_minutes.' };
  }
  const { settings } = await loadCatalog();
  const cap = Number(settings.get('schedule.day_capacity')) || 20;
  const g = geoColumns(await populatedCentres(q));

  // One query: the geometry per area and the customers actually on it. `properties.postal_code`
  // is joined through `area_postal_codes` rather than through `properties.city` — a typed city
  // name is not a join key, and the ZIP already has a row with a source on it.
  const { rows } = await q.query(`
    select a.slug, a.name, a.bookable,
           count(distinct z.postal_code)::int                as zips,
           ${g.lat}                                          as lat,
           ${g.lon}                                          as lon,
           ${g.land}                                         as land,
           coalesce(cust.n, 0)::int                          as customers_now
      from service_areas a
      join area_postal_codes z on z.area_slug = a.slug
      left join (
        select z2.area_slug, count(distinct s.id) as n
          from subscriptions s
          join properties p on p.id = s.property_id
          join area_postal_codes z2 on z2.postal_code = p.postal_code
          join customers c on c.id = s.customer_id
         where s.state = 'active' and c.name not like 'DEMO—%'
         group by z2.area_slug
      ) cust on cust.area_slug = a.slug
     group by a.slug, a.name, a.bookable, cust.n
     order by a.slug`);

  const areas: AreaDensity[] = rows.map((r) => {
    const rMi = miles(p.depot, { lat: r.lat, lon: r.lon });
    const land = Number(r.land);
    const n = Number(r.customers_now);
    const marginal = marginalDriveMinutes(n, rMi, land, p);
    return {
      slug: r.slug,
      name: r.name,
      bookable: r.bookable,
      zips: r.zips,
      depot_miles: Math.round(rMi * 10) / 10,
      area_sq_mi: Math.round(land * 10) / 10,
      customers_now: n,
      marginal_drive_minutes: Math.round(marginal),
      marginal_ratio: Math.round((marginal / p.referenceServiceMinutes) * 100) / 100,
      customers_for_parity: customersForParity(rMi, land, p, cap),
      drive_minutes_per_visit_now: n > 0 ? Math.round(driveMinutes(n, rMi, land, p) / n) : null,
      margin_per_visit: metric(null, false,
        'routing.cost_per_hour_cents is not set. Nobody has asked Josue what his hour costs, so this is unknown rather than estimated.'),
    };
  }).sort((a, b) => a.marginal_drive_minutes - b.marginal_drive_minutes);

  /**
   * HOW MANY CUSTOMERS THE ORDER RESTS ON, said out loud.
   *
   * The arithmetic is right at any count, but its MEANING is not. With one customer in the book,
   * that one row moves its town to the top — correctly, because the second stop in a town you
   * already drive to genuinely is the cheapest next customer. A reader who does not know the
   * count will read "Santa Barbara first" as a market judgement instead of as one subscription.
   *
   * Measured 2026-09-22: exactly one active subscription exists, in Santa Barbara 93101, and it
   * belongs to a row named BEN PALASKAS — a test booking. It put Santa Barbara at the top of the
   * board at 13 minutes against Oak View's 36. The board was not wrong; the input was not a
   * customer. The query already excludes `DEMO—%` names and this row is not marked that way, so
   * the honest move is to report the count rather than to invent a filter for test rows nobody
   * has agreed the shape of.
   */
  const total = areas.reduce((t, a) => t + a.customers_now, 0);
  const note = total === 0
    ? 'No customers yet, so this is purely distance and area — the order will change as people sign up.'
    : total <= 3
      ? `This order rests on ${total} active ${total === 1 ? 'subscription' : 'subscriptions'}. `
        + 'One customer is enough to move their town to the top, which is correct arithmetic and a '
        + 'thin basis for a decision. Check the Customers column before acting on the order.'
      : undefined;

  return { measured: true, geo_basis: g.basis, parameters: p, day_capacity: cap, total_customers: total, areas, ...(note ? { note } : {}) };
}

/**
 * The ZIPs we know and do not serve, ranked by what a route there would cost per stop once it hit
 * parity — i.e. which waitlist ZIP is worth opening next.
 *
 * `area_slug is null` in `area_postal_codes` means KNOWN AND NOT SERVED, which migration 020
 * deliberately made a row rather than a lookup miss. This is the reader that makes it a growth
 * asset instead of a note in a migration header.
 */
export async function waitlistZips(q: Queryable = db()): Promise<{
  measured: boolean;
  note?: string;
  geo_basis?: 'population' | 'polygon';
  zips: {
    postal_code: string; city_name: string; depot_miles: number; area_sq_mi: number;
    /** The POLYGON's distance, always. See below — 93042 is why this is a second column. */
    polygon_miles: number;
    customers_for_parity: number | null;
  }[];
}> {
  if (!(await geocoded(q))) return { measured: false, zips: [], note: 'no coordinates yet (migration 031).' };
  const p = await parameters(q);
  if (!p) return { measured: false, zips: [], note: 'routing.depot_lat/lon are not set.' };
  const { settings } = await loadCatalog();
  const cap = Number(settings.get('schedule.day_capacity')) || 20;

  /**
   * TWO DISTANCES, AND 93042 IS WHY.
   *
   * ZIP 93042 is San Nicolas Island, sixty miles out to sea, and migration 031's header names it
   * as the reason land area cannot be used to derive coverage. Its POLYGON sits in the ocean. Its
   * PEOPLE do not: the 2020 ZCTA also covers the Point Mugu end of the naval air station, and all
   * 1,075 of them live there, 16 miles from the depot. Both sentences are true and they are about
   * different things, so the row carries both rather than one overwriting the other.
   *
   * The RANKING uses the population centre, because "is this ZIP worth opening next" is a question
   * about customers and driving. `polygon_miles` is what lets a reader — and
   * `gates/route-density.mjs` — still tell an island from a suburb.
   */
  const w = geoColumns(await populatedCentres(q));
  const { rows } = await q.query(
    `select postal_code, city_name, ${w.zipLat} as lat, ${w.zipLon} as lon, ${w.zipLand} as land,
            latitude::float8 as poly_lat, longitude::float8 as poly_lon
       from area_postal_codes where area_slug is null order by postal_code`);

  return {
    measured: true,
    geo_basis: w.basis,
    zips: rows.map((r) => {
      const rMi = miles(p.depot, { lat: r.lat, lon: r.lon });
      return {
        postal_code: r.postal_code,
        city_name: r.city_name,
        depot_miles: Math.round(rMi * 10) / 10,
        polygon_miles: Math.round(miles(p.depot, { lat: r.poly_lat, lon: r.poly_lon }) * 10) / 10,
        area_sq_mi: Math.round(Number(r.land) * 10) / 10,
        customers_for_parity: customersForParity(rMi, Number(r.land), p, cap),
      };
    }).sort((a, b) => a.depot_miles - b.depot_miles),
  };
}
