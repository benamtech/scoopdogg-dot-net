-- Scoop Dogg — monthly packages, Stripe per mode, and service days per city.
--
-- Ben, 2026-09-16: "the whole point is that they can book directly ... the goal of course
-- is to get them to pay the deposit for the month of service. you can make custom stripe
-- whatever you need using our keys and all the pricing info on the site ... and we need
-- monthly packages for poop scooper, yard cleanup".
--
-- THREE THINGS, AND WHAT EACH ONE SUPERSEDES.
--
-- 1. PACKAGES. migrations/005_stripe.sql argued the rate card must NOT be mirrored into
--    Stripe Prices because "a scooping month is VARIABLE". A monthly package makes the
--    month fixed - that is what a package is - so the argument no longer applies to the
--    recurring services. `service_tiers` stays the published rate card; a package is a
--    row DERIVED from a tier, carrying the arithmetic that produced its price, and a
--    Stripe Price is a versioned copy of that row per mode. The database stays the source.
--
-- 2. STRIPE PER MODE. `stripe_connection` was exactly one row while carrying `livemode`,
--    so a test connected account and a live one could not both exist - and a test acct_
--    does not exist in live mode at all. One row per mode, and every call resolves its key
--    and its acct_ from the same row (NEXT-SESSION-2026-09-12-0930, e-key-and-account-same-row).
--
-- 3. SERVICE DAYS PER CITY. portal/P6-SCHEDULING-AND-CAPACITY.md: a customer is a slot on
--    Tuesdays forever, so the days belong to the area, not to a route optimiser. Empty
--    means "no route yet", which booking treats as "any service day" rather than refusing.

-- rehearse: select count(*) = 2 from stripe_connection
-- rehearse: select exists(select 1 from stripe_connection where livemode) and exists(select 1 from stripe_connection where not livemode)
-- rehearse: select (select value from settings where key='billing.charge_timing') = '"at_booking_monthly_prepaid"'::jsonb
-- rehearse: select count(*) = 2 from offers where status = 'active' and kind = 'percent_off'
-- rehearse: select count(*) = 16 from service_areas where market_label <> ''
-- rehearse: select count(distinct market) = 4 from service_areas
-- rehearse: select count(*) = 0 from packages

begin;

-- ---------------------------------------------------------------------------------------
-- 1. stripe_connection: one row per mode
-- ---------------------------------------------------------------------------------------
alter table stripe_connection drop constraint stripe_connection_pkey;
alter table stripe_connection drop column id;
alter table stripe_connection add primary key (livemode);
insert into stripe_connection (livemode) values (false) on conflict (livemode) do nothing;
insert into stripe_connection (livemode) values (true)  on conflict (livemode) do nothing;

-- A cache of what the Accounts v2 API last said, with its age. Never render these bare:
-- requirements change without warning, so a screen shows the probe and when it ran.
alter table stripe_connection add column if not exists display_name        text;
alter table stripe_connection add column if not exists card_payments_status text;
alter table stripe_connection add column if not exists requirements_status  text;

comment on table stripe_connection is
  'One row per Stripe mode. The platform key for a mode comes from the environment and the '
  'connected acct_ for that mode comes from this row, resolved together on every call. A '
  'live key with a test account id fails with an error that names neither.';

-- A Customer lives ON THE CONNECTED ACCOUNT for direct charges, once per mode.
create table stripe_customers (
  customer_id         uuid        not null references customers(id),
  livemode            boolean     not null,
  account_id          text        not null,
  stripe_customer_id  text        not null,
  created_at          timestamptz not null default now(),
  primary key (customer_id, livemode, account_id)
);
create unique index stripe_customers_sc_idx on stripe_customers (stripe_customer_id);

alter table payment_methods add column if not exists livemode   boolean;
alter table payment_methods add column if not exists account_id text;
alter table payments        add column if not exists livemode   boolean;
alter table invoices        add column if not exists livemode   boolean;
alter table invoices        add column if not exists account_id text;
alter table invoices        add column if not exists hosted_invoice_url text;
alter table invoices        add column if not exists subscription_id uuid references subscriptions(id);
create unique index if not exists invoices_stripe_invoice_idx on invoices (stripe_invoice_id) where stripe_invoice_id is not null;

-- ---------------------------------------------------------------------------------------
-- 2. packages, and their Stripe Prices
-- ---------------------------------------------------------------------------------------
create table packages (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text        not null unique,
  service_slug         text        not null references services(slug),
  tier_id              uuid        references service_tiers(id),
  name                 text        not null,
  short_label          text        not null default '',    -- "2 dogs"
  frequency            text        not null
                         check (frequency in ('twice_weekly','weekly','biweekly','monthly')),
  visits_per_month     numeric(5,2) not null check (visits_per_month > 0),
  monthly_price_cents  integer     not null check (monthly_price_cents > 0),
  -- The working, in words, so the admin can show Ben WHY a number is what it is.
  derivation           text        not null,
  -- 'derived_from_published' until Ben (or Josue, through the admin) confirms the number.
  source               text        not null default 'derived_from_published'
                         check (source in ('derived_from_published','confirmed')),
  confirmed_by         text,
  confirmed_at         timestamptz,
  -- A Stripe Price is immutable, so a price change is a new version, never an edit.
  version              integer     not null default 1,
  featured             boolean     not null default false,
  sort_order           integer     not null default 100,
  status               text        not null default 'active'
                         check (status in ('draft','active','retired')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index packages_service_idx on packages (service_slug, sort_order) where status = 'active';

comment on column packages.source is
  'derived_from_published: arithmetic on a price Josue already publishes, shown to customers '
  'in test mode and flagged in the admin until somebody with authority confirms it. Ben sets '
  'the final price (AGENTS.md rule 4); this column is how that rule is visible in the data.';

create or replace function packages_bump_version() returns trigger language plpgsql as $$
begin
  if new.monthly_price_cents is distinct from old.monthly_price_cents then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger packages_version before update on packages
  for each row execute function packages_bump_version();

create table stripe_prices (
  package_id    uuid        not null references packages(id),
  livemode      boolean     not null,
  version       integer     not null,
  account_id    text        not null,
  product_id    text        not null,
  price_id      text        not null unique,
  lookup_key    text        not null,
  unit_amount   integer     not null,
  created_at    timestamptz not null default now(),
  primary key (package_id, livemode, account_id, version)
);

-- The published first-month offer, which until now lived only in page copy.
insert into offers (code, name, description, kind, value, applies_to_slugs, requires_slugs, first_n_visits, status)
select null, 'First month half off',
       'Published on the site: "First month is half off." Applies to the first monthly payment of a scooping package.',
       'percent_off', 50, array['weekly-pooper-scooper-service'], '{}', null, 'active'
where not exists (select 1 from offers where name = 'First month half off');

insert into offers (code, name, description, kind, value, applies_to_slugs, requires_slugs, first_n_visits, status)
select null, 'Turf maintenance: first month half off with scooping',
       'Published on the site: "First month half off when combined with weekly poop scooping."',
       'percent_off', 50, array['weekly-turf-maintenance'], array['weekly-pooper-scooper-service'], null, 'active'
where not exists (select 1 from offers where name = 'Turf maintenance: first month half off with scooping');

alter table offers add column if not exists stripe_coupon_ids jsonb not null default '{}'::jsonb;
comment on column offers.stripe_coupon_ids is
  'Keyed "<livemode>:<acct_>" -> coupon id. A coupon, like a price, lives on the connected account.';

-- ---------------------------------------------------------------------------------------
-- 3. subscriptions carry the package, the Stripe objects and the money state
-- ---------------------------------------------------------------------------------------
alter table subscriptions drop constraint if exists subscriptions_frequency_check;
alter table subscriptions add constraint subscriptions_frequency_check
  check (frequency in ('twice_weekly','weekly','biweekly','monthly','one_time'));

alter table subscriptions add column if not exists package_id             uuid references packages(id);
alter table subscriptions add column if not exists package_version        integer;
alter table subscriptions add column if not exists monthly_price_cents    integer;
alter table subscriptions add column if not exists livemode               boolean;
alter table subscriptions add column if not exists account_id             text;
alter table subscriptions add column if not exists stripe_subscription_id text;
alter table subscriptions add column if not exists stripe_customer_id     text;
alter table subscriptions add column if not exists area_slug              text references service_areas(slug);
alter table subscriptions add column if not exists current_period_end     timestamptz;
alter table subscriptions add column if not exists cancel_at_period_end   boolean not null default false;
alter table subscriptions add column if not exists payment_state          text not null default 'none'
  check (payment_state in ('none','pending','ok','past_due','unpaid'));
alter table subscriptions add column if not exists extras                 jsonb not null default '[]'::jsonb;
alter table subscriptions add column if not exists discount               jsonb;
alter table subscriptions add column if not exists booking_answers        jsonb not null default '{}'::jsonb;
alter table subscriptions add column if not exists source                 text not null default 'admin'
  check (source in ('online','admin','import'));
create unique index if not exists subscriptions_stripe_sub_idx on subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column subscriptions.extras is
  'One-time services added at booking and charged on the first invoice, FROZEN as shown: '
  '[{"tier_id","service_slug","label","price_cents"}]. A later price change never rewrites it.';
comment on column subscriptions.discount is
  'The offer applied at booking, frozen: {"offer_id","name","percent_off","first_charge_cents"}.';

-- ---------------------------------------------------------------------------------------
-- 4. service days per city, and the market a city belongs to (P6, R1)
-- ---------------------------------------------------------------------------------------
alter table service_areas add column if not exists service_weekdays integer[] not null default '{}';
alter table service_areas add column if not exists market_label     text not null default '';
comment on column service_areas.service_weekdays is
  '0=Sunday..6=Saturday. Empty means no route yet: booking offers any day in '
  'schedule.service_days rather than refusing. Josue clusters a city by ticking days.';

update service_areas set market = 'ventura-county', market_label = 'Ventura County'
 where slug in ('ventura','oxnard','camarillo','ojai','oak-view','santa-paula','fillmore','moorpark','simi-valley');
update service_areas set market = 'conejo-valley', market_label = 'the Conejo Valley'
 where slug in ('thousand-oaks','newbury-park','westlake-village','agoura-hills');
update service_areas set market = 'south-coast', market_label = 'the South Coast'
 where slug in ('santa-barbara','carpinteria');
update service_areas set market = 'malibu-coast', market_label = 'Malibu'
 where slug in ('malibu');

insert into settings (key, value, updated_by) values
  ('schedule.day_capacity', '20'::jsonb, 'seed'),
  ('booking.start_window_days', '14'::jsonb, 'seed'),
  ('booking.initial_cleanup_policy', '"offer_optional"'::jsonb, 'seed'),
  ('booking.card_required', 'true'::jsonb, 'seed'),
  ('billing.monthly_factor', '"52/12"'::jsonb, 'seed'),
  ('billing.package_prices_confirmed', 'false'::jsonb, 'seed')
  on conflict (key) do nothing;

-- Ben, 2026-09-16: the first month is paid at booking. These three rows were the old
-- defaults and they are the ones this engagement now contradicts. Updated, not deleted,
-- and the reason is written where the next reader looks.
update settings set value = '"at_booking_monthly_prepaid"'::jsonb, updated_by = 'ben:2026-09-16'
 where key = 'billing.charge_timing';
update settings set value = '"first_month"'::jsonb, updated_by = 'ben:2026-09-16'
 where key = 'billing.deposit_mode';
update settings set value = 'true'::jsonb, updated_by = 'ben:2026-09-16'
 where key = 'billing.card_on_file_required';

commit;
