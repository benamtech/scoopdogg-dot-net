-- Scoop Dogg — the core schema, built from scratch.
--
-- Ben, 2026-09-10: "if you just copy the supabase exactly you will copy the errors.
-- just copy the data to json, verify its the same as the original. create a new
-- database from scratch that is totally fixed and keeps all the leads."
--
-- So nothing here is inherited. The 24 leads are migrated in 002 from a JSON file that
-- was verified field-by-field against the live database on 2026-09-10.
--
-- WHAT IS DELIBERATELY ABSENT, AND WHY
--
-- 1. No RLS. The old database needed it because the browser held a database credential
--    and could talk to PostgREST directly. That is the defect, not the design. Here the
--    browser has no credential at all: every write goes through a verb running on the
--    server, and the only role that can reach Postgres is the application. RLS with one
--    all-access application role is theatre - a policy that says `true` protects nothing
--    and hides that fact behind a green checkmark.
--    If a future change gives an untrusted party a connection string, RLS is not the fix.
--    Taking the connection string back is.
--
-- 2. No `anon` or `authenticated` roles. Those are Supabase's. Their absence is what
--    makes this schema portable, and their presence in the old dump is why 8 of its
--    statements could not be restored anywhere else.
--
-- 3. No keepalive table. That existed to stop a free tier pausing. Neon suspends and
--    resumes on its own.
--
-- THE RULE THAT PREVENTS THE WORST FUTURE HEADACHE
--
--   Settings are current config. Money is frozen at the moment it is agreed or charged.
--
-- When Josue raises weekly service from $15 to $18, the setting changes and every
-- existing subscription keeps what it was sold at, because the rate is COPIED onto the
-- subscription at signup and onto the invoice at charge time. A price stored only as a
-- pointer to config rewrites history every time the config moves.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- settings — every policy question, one row each. See planning/01-SETTINGS.md
-- ---------------------------------------------------------------------------
create table settings (
  key         text primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
comment on table settings is
  'Current configuration. Never read this to decide what an EXISTING subscription or '
  'invoice is worth - those carry their own frozen amounts.';

-- ---------------------------------------------------------------------------
-- leads — the enquiry log. Preserved from the old system, verbatim.
-- ---------------------------------------------------------------------------
create table leads (
  id            uuid primary key,           -- original id kept, so nothing is renamed
  name          text        not null,
  phone         text        not null,
  email         text        not null,
  address       text        not null default '',
  city          text        not null,
  service_slug  text        not null default '',
  yard_size     text,
  num_dogs      integer,
  frequency     text,
  notes         text        not null default '',
  source_page   text        not null default '',
  status        text        not null default 'new'
                  check (status in ('new','contacted','quoted','active','declined')),
  customer_id   uuid,                       -- set when Josue promotes a lead. Never guessed.
  created_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);
create index leads_status_idx  on leads (status, created_at desc);
create index leads_phone_idx   on leads (phone);
comment on column leads.customer_id is
  'Null until a human promotes this lead. The 24 migrated leads include 7 marked active, '
  'and which of those are really current customers - and on what schedule and price - is '
  'Josue''s to confirm. Guessing it would invent facts about real people.';

-- ---------------------------------------------------------------------------
-- customers, properties
-- ---------------------------------------------------------------------------
create table customers (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  phone        text        not null,        -- the natural key in a phone-first business
  email        text,
  notes        text        not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                  -- soft delete. A customer with history is never removed
);
create unique index customers_phone_live_idx on customers (phone) where deleted_at is null;

create table properties (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid        not null references customers(id),
  address       text        not null,
  city          text        not null,
  postal_code   text,
  yard_size     text        check (yard_size in ('small','medium','large')),
  num_dogs      integer     not null default 1 check (num_dogs >= 0),
  gate_code     text,                       -- see settings.visit.gate_code_visible_to
  access_notes  text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index properties_customer_idx on properties (customer_id) where deleted_at is null;
comment on table properties is
  'A customer can move, or own two houses. The property is what gets serviced, not the '
  'person, which is why a subscription points here and not at the customer.';

-- ---------------------------------------------------------------------------
-- team — never deleted, so a completed visit keeps naming who did it
-- ---------------------------------------------------------------------------
create table team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  phone       text        not null unique,
  role        text        not null default 'team' check (role in ('superadmin','admin','team')),
  status      text        not null default 'active' check (status in ('invited','active','inactive')),
  started_at  date,
  ended_at    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table team_members is
  'No delete. Somebody who leaves gets status=inactive and an ended_at. Visits they '
  'completed must keep naming them for as long as those visits exist.';

-- ---------------------------------------------------------------------------
-- subscriptions — the recurring arrangement, with its price frozen
-- ---------------------------------------------------------------------------
create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid        not null references customers(id),
  property_id        uuid        not null references properties(id),
  service_slug       text        not null,   -- validated against the content corpus by the verb
  state              text        not null default 'draft'
                       check (state in ('draft','quote_ready','quote_accepted',
                                        'deposit_pending','active','paused','cancelled')),
  -- FROZEN AT SIGNUP. Never re-read from settings.
  price_cents        integer,                -- null means "needs a quote from Josue"
  price_basis        text,                   -- 'dogs' | 'sqft' | 'boxes' | 'units'
  price_quantity     integer,
  price_tier_label   text,                   -- e.g. '2 dogs'. What the customer was shown
  priced_at          timestamptz,
  -- schedule
  frequency          text        not null default 'weekly'
                       check (frequency in ('weekly','biweekly','monthly','one_time')),
  service_weekday    integer     check (service_weekday between 0 and 6),
  starts_on          date,
  paused_from        date,
  paused_until       date,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index subscriptions_active_idx  on subscriptions (state, service_weekday)
  where state = 'active';
create index subscriptions_customer_idx on subscriptions (customer_id);
comment on column subscriptions.price_cents is
  'The rate this customer was actually sold, in cents, copied from the rate card at '
  'signup. Raising the published price must never change this row.';

-- ---------------------------------------------------------------------------
-- visits — one per occurrence. The unit of work and the unit of proof.
-- ---------------------------------------------------------------------------
create table visits (
  id                uuid primary key default gen_random_uuid(),
  subscription_id   uuid        not null references subscriptions(id),
  property_id       uuid        not null references properties(id),
  scheduled_for     date        not null,
  state             text        not null default 'scheduled'
                      check (state in ('scheduled','assigned','en_route','completed',
                                       'skipped','rescheduled','failed_access','cancelled')),
  assigned_to       uuid        references team_members(id),
  en_route_at       timestamptz,
  eta_at            timestamptz,
  completed_at      timestamptz,
  completed_by      uuid        references team_members(id),
  photo_urls        text[]      not null default '{}',
  crew_notes        text        not null default '',
  customer_note     text        not null default '',
  -- FROZEN. What this visit is worth, copied from the subscription when it is created.
  charge_cents      integer,
  chargeable        boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index visits_no_double_booking_idx
  on visits (subscription_id, scheduled_for)
  where state not in ('cancelled','rescheduled');
create index visits_day_idx      on visits (scheduled_for, state);
create index visits_assigned_idx on visits (assigned_to, scheduled_for)
  where state in ('scheduled','assigned','en_route');
comment on index visits_no_double_booking_idx is
  'A subscription cannot have two live visits on one day. This is the cheapest possible '
  'guard against a scheduler bug billing somebody twice for one Tuesday.';

-- ---------------------------------------------------------------------------
-- money — invoices and payments are append-only in spirit. A refund is a row.
-- ---------------------------------------------------------------------------
create table invoices (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid        not null references customers(id),
  period_start       date,
  period_end         date,
  subtotal_cents     integer     not null,
  platform_fee_cents integer     not null default 0,   -- AMTECH's 4%, frozen at issue
  total_cents        integer     not null,
  state              text        not null default 'draft'
                       check (state in ('draft','open','paid','void','uncollectible')),
  issued_at          timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz not null default now()
);

create table invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid    not null references invoices(id) on delete cascade,
  visit_id      uuid    references visits(id),
  description   text    not null,          -- the words the customer reads, frozen
  amount_cents  integer not null
);

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid        not null references customers(id),
  invoice_id          uuid        references invoices(id),
  kind                text        not null check (kind in ('charge','refund','deposit','manual')),
  amount_cents        integer     not null,     -- negative for a refund
  currency            text        not null default 'usd',
  stripe_payment_id   text,
  stripe_account_id   text,                     -- the connected account it was taken on
  platform_fee_cents  integer     not null default 0,
  state               text        not null default 'pending'
                        check (state in ('pending','succeeded','failed','refunded')),
  failure_reason      text,
  created_at          timestamptz not null default now()
);
create unique index payments_stripe_idx on payments (stripe_payment_id)
  where stripe_payment_id is not null;
comment on table payments is
  'Append only. A refund is a new row with a negative amount, never an edit to the '
  'charge. The balance is a sum, so it can always be explained line by line.';

-- ---------------------------------------------------------------------------
-- messages — the customer/owner thread. "are you on your way?"
-- ---------------------------------------------------------------------------
create table messages (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid        not null references customers(id),
  visit_id      uuid        references visits(id),
  direction     text        not null check (direction in ('inbound','outbound')),
  channel       text        not null check (channel in ('portal','sms','email')),
  author_kind   text        not null check (author_kind in ('customer','team','owner','system','agent')),
  author_id     uuid,
  body          text        not null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index messages_customer_idx on messages (customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- events — the spine. Append-only, hash-chained, one row per state change.
-- ---------------------------------------------------------------------------
create table events (
  id             bigserial primary key,
  subject_kind   text        not null,      -- 'subscription' | 'visit' | 'invoice' | ...
  subject_id     uuid        not null,
  seq            integer     not null,
  event_type     text        not null,      -- validated against server/events/schemas/
  from_state     text,
  to_state       text,
  actor_kind     text        not null check (actor_kind in ('customer','team','owner','system','agent')),
  actor_id       uuid,
  payload        jsonb       not null default '{}'::jsonb,
  prev_hash      text,
  hash           text        not null,
  created_at     timestamptz not null default now(),
  unique (subject_kind, subject_id, seq)
);
create index events_subject_idx on events (subject_kind, subject_id, seq);
create index events_type_idx    on events (event_type, created_at desc);

create or replace function events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'events is append-only; write a new event instead of editing one';
end;
$$;
create trigger events_no_update before update on events
  for each row execute function events_append_only();
create trigger events_no_delete before delete on events
  for each row execute function events_append_only();

-- ---------------------------------------------------------------------------
-- outbox — the side effect, written in the SAME transaction as its event.
-- ---------------------------------------------------------------------------
create table outbox (
  id            bigserial primary key,
  event_id      bigint      references events(id),
  kind          text        not null,      -- 'email' | 'sms' | 'stripe.charge' | ...
  payload       jsonb       not null,
  state         text        not null default 'pending'
                  check (state in ('pending','delivering','delivered','failed','abandoned')),
  attempts      integer     not null default 0,
  last_error    text,
  next_retry_at timestamptz not null default now(),
  delivered_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index outbox_due_idx on outbox (next_retry_at) where state = 'pending';
comment on table outbox is
  'Charging a card and sending an email are not part of a database transaction. Writing '
  'the intent here, in the same transaction as the event, is what stops a crash from '
  'leaving one done and the other not.';

-- ---------------------------------------------------------------------------
-- idempotency — protects effects, not failures
-- ---------------------------------------------------------------------------
create table idempotency_keys (
  key           text primary key,
  verb          text        not null,
  request_hash  text        not null,
  response      jsonb,
  state         text        not null default 'claimed'
                  check (state in ('claimed','succeeded')),
  created_at    timestamptz not null default now()
);
comment on table idempotency_keys is
  'Released on a throw or a 5xx. A customer who met a transient outage must not have '
  'that outage replayed at them forever by their own retry.';

-- ---------------------------------------------------------------------------
-- auth — sessions in Postgres. Ported from McGrath's. No JWT in a browser.
-- ---------------------------------------------------------------------------
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  actor_kind    text        not null check (actor_kind in ('customer','team','admin','superadmin')),
  customer_id   uuid        references customers(id),
  team_id       uuid        references team_members(id),
  token_hash    text        not null unique,
  ip_hash       text,
  ua_hash       text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
create index sessions_expiry_idx on sessions (expires_at) where revoked_at is null;

create table verification_codes (
  id            uuid primary key default gen_random_uuid(),
  target_hash   text        not null,      -- hmac of the phone or email. Never the value
  code_hash     text        not null,
  purpose       text        not null,
  attempts      integer     not null default 0,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index verification_codes_lookup_idx
  on verification_codes (target_hash, created_at desc) where consumed_at is null;

create table rate_limits (
  key         text primary key,
  count       integer     not null default 0,
  reset_at    timestamptz not null
);

-- ---------------------------------------------------------------------------
-- updated_at, once, for every table that has one
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['leads','customers','properties','team_members',
                           'subscriptions','visits'] loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()',
      t, t);
  end loop;
end $$;

commit;
