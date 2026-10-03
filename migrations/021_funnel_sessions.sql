-- Scoop Dogg — the measurement spine. One row per person who started asking for a price.
--
-- P19 §2: R8 calls net adds, sessions and conversion "the only scoreboard", and the middle number
-- has never been measured. The funnel emits `booking.created` when a row is written and
-- `subscription.activated` when it is paid; everything before that is invisible, so the site
-- cannot say whether 26 leads in its life is a traffic problem or a funnel problem. Four rows in
-- `events` is not a measurement.
--
-- WHY A TABLE AND NOT JUST EVENTS. `events.subject_id` is `uuid not null` and every event needs a
-- subject that exists. A ZIP typed into a box has no subscription, no customer and no booking —
-- the whole point of measuring it is that it happens BEFORE any of those exist. This row is the
-- subject. Its id is the idempotency key the browser already mints at the start of a session, so
-- the thing being measured and the thing being deduplicated are the same thing rather than two
-- ids that have to be kept in step.
--
-- IT IS ALSO THE HOUR BLOCK. P16 §7: a response inside the hour makes a lead ~7x more likely to
-- qualify (HBR, Oldroyd & McElheran, 2,241 firms), so the admin's top block is whoever started
-- and stopped, with one tap that opens Josue's own SMS app. That block reads exactly these rows,
-- which is why `last_seen_at` and the price they were looking at are columns rather than payload.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD: no cookie, no device id, no third-party identifier, no
-- referrer chain. The contact columns fill in only when the customer types them into the booking
-- form, and `subscription_id` is how a session that converted stops being "unfinished".

-- rehearse: select count(*) = 0 from funnel_sessions
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'funnel_sessions' and column_name = 'id' and data_type = 'uuid'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'funnel_sessions' and column_name = 'last_seen_at' and is_nullable = 'NO'
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'funnel_sessions' and indexname = 'funnel_sessions_unfinished_idx'
-- rehearse: select count(*) = 1 from pg_constraint where conrelid = 'funnel_sessions'::regclass and pg_get_constraintdef(oid) like '%postal_code%'

begin;

create table funnel_sessions (
  id                uuid primary key,                   -- the browser's own idempotency key
  postal_code       text        check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  area_slug         text        references service_areas(slug),
  city_name         text,                               -- what we told them, even when unserved
  service_slug      text,
  package_id        uuid        references packages(id),
  price_cents_seen  integer,                            -- the number that was actually on screen
  lane              text        check (lane is null or lane in ('prepay','payafter','onetime','request')),
  step              text,                               -- the furthest step reached
  name              text, email text, phone text,       -- only once they type them
  subscription_id   uuid        references subscriptions(id),
  started_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);
create index funnel_sessions_unfinished_idx on funnel_sessions (last_seen_at desc) where subscription_id is null;
create index funnel_sessions_month_idx on funnel_sessions (started_at);

comment on table funnel_sessions is
  'One row per booking-intent session: somebody typed a ZIP. The growth board''s top number and '
  'the "unfinished in the last hour" block both read this table, and events/booking.* point at '
  'these ids. No cookie, no device id, no third-party script - this is the whole of the '
  'analytics for this site.';
comment on column funnel_sessions.price_cents_seen is
  'The price that was ON SCREEN, not one recomputed later. A conversion rate measured against a '
  'price nobody saw is measuring the wrong funnel.';

commit;
