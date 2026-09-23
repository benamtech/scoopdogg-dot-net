-- Scoop Dogg — a visit gets a clock, so the price can stop being argued from a recollection.
--
-- WHAT IS BROKEN, AND IT IS THE LARGEST UNKNOWN ON THIS PROJECT. `visits.en_route_at` has been in
-- the schema since migration 001. **Nothing has ever written it.** `completeVisit()` sets
-- `completed_at` and nothing else, and there is no `arrived_at` at all. So no visit's duration
-- has ever been recorded, and nothing here can say what an hour of Josue's day actually contains.
--
-- WHY THAT MATTERS MORE THAN IT SOUNDS (R14 §B). `service_tiers.est_minutes` carries its own
-- confession in its column comment: "ESTIMATE by claude:cmo 2026-09-18; replace with the median
-- of real visit durations." Migration 016 then DERIVED the price ladder from `est_minutes`, and
-- `gates/price-clears-the-floor.mjs` CHECKS the ladder against `est_minutes`. One estimate is
-- both the input to the price and the standard the price is held to, so the two agree by
-- construction and neither can be wrong independently of the other. The gate is green and cannot
-- be anything else. It is the same shape as a verifier reading from the producer's own path, and
-- it is the second time this project has paid for it.
--
-- And it is not only the price. `server/lib/density.ts` measures every city's marginal customer
-- against `referenceServiceMinutes`, which is the same estimate — so the growth board's entire
-- ranking, the parity thresholds, and "where should the next customer come from" all inherit it.
-- One writer fixes the pricing gate and the density ranking at the same time.
--
-- WHAT THIS ADDS. One column, and the pair it completes:
--
--   en_route_at   exists since 001, written from now on. The van leaves for this stop.
--   arrived_at    NEW. The van is at the property. Travel ends, work begins.
--   completed_at  exists and is written. The work ends.
--
-- Two intervals fall out and they answer different questions:
--   arrived_at -> completed_at   SERVICE minutes. What the work takes. The price argument.
--   en_route_at -> arrived_at    DRIVE minutes. What the route costs. density.ts's own model
--                                predicts this, so measuring it is how the model gets checked
--                                against reality rather than against its own assumptions.
--
-- NOTHING IS REQUIRED. Every column is nullable and `completeVisit()` still accepts a visit that
-- was never marked en route or arrived — because a one-man operator standing in a yard with a
-- phone in his pocket is the normal case, and a verb that refuses him is a verb that gets worked
-- around. A stop with no clock is a stop we learn nothing from, not a stop that cannot be closed.
-- The medians simply ignore it, and `measured_visits` is how anyone sees how many there are.
--
-- THIS IS STILL NOT THE CREW APP. P18 §4 and STANDARD.md §6 leave that unsettled and nothing here
-- schedules, assigns or routes. Two more verbs on the screen that already exists.
--
-- THE ORDER IS ENFORCED BY THE DATABASE, because a clock that can run backwards is a clock that
-- will, and a negative median is the kind of number that gets noticed six weeks later.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'visits' and column_name = 'arrived_at'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'visits' and column_name = 'en_route_at'
-- rehearse: select count(*) = 1 from pg_constraint where conrelid = 'visits'::regclass and conname = 'visits_stop_clock_in_order'
-- rehearse: select count(*) = 0 from visits where arrived_at is not null and en_route_at is not null and arrived_at < en_route_at
-- rehearse: select count(*) = 0 from visits where completed_at is not null and arrived_at is not null and completed_at < arrived_at
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'visits' and indexname = 'visits_measured_idx'

begin;

alter table visits add column arrived_at timestamptz;

-- A clock that can run backwards will. `is distinct from` rather than a null check on each side:
-- every one of these is allowed to be absent, and only the ORDER of the ones present is claimed.
alter table visits
  add constraint visits_stop_clock_in_order
  check (
    (en_route_at is null or arrived_at is null or arrived_at >= en_route_at)
    and (arrived_at is null or completed_at is null or completed_at >= arrived_at)
    and (en_route_at is null or completed_at is null or completed_at >= en_route_at)
  );

comment on column visits.en_route_at is
  'The van left for this stop. In the schema since migration 001 and written by nothing until '
  '035 — which is why no visit duration has ever been recorded on this project.';
comment on column visits.arrived_at is
  'The van is at the property: travel ends and work begins. arrived_at -> completed_at is the '
  'SERVICE time that service_tiers.est_minutes is an estimate of, and en_route_at -> arrived_at '
  'is the DRIVE time that server/lib/density.ts models. Nullable on purpose: a stop closed '
  'without a clock is one we learn nothing from, not one that cannot be closed.';

-- The medians read exactly these rows, and there will be few of them for a long time.
create index visits_measured_idx on visits (completed_at)
  where state = 'completed' and arrived_at is not null and completed_at is not null;

commit;
