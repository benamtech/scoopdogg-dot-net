-- Scoop Dogg — a particular job gets a quote, and the quote takes money.
--
-- WHAT WAS MISSING. The price list tops out at $269 while the owner bills $1,000 in a day on large
-- yard and property work. Nine tiers already say "we'll quote it", and every one of them ended in a
-- contact form that writes to contact_messages: no photos, no amount, nothing that can become
-- money. `subscriptions.state` has allowed 'quote_ready' and 'quote_accepted' since migration 001
-- and nothing has ever written either. R21 is the evidence for every column below.
--
-- THE SHAPE.
--   leads          the request: what needs doing, when, how to reach them, and a capability token
--                  for the page that shows them where it is. `first_response_at` is the number
--                  R21 says to measure, because no conversion benchmark says what Josue's is.
--   lead_photos    the customer's photos of the job. Same storage decision as visit_photos (029).
--   quotes         one priced offer to one lead. Every timestamp R21 §3 says to instrument.
--                  `is_improvement` is the one switch: a job that builds or installs something is
--                  a California home-improvement contract, and its deposit is capped in code.
--   quote_lines    what it is made of. `optional` lines are the customer's to tick.
-- The JOB is a `subscriptions` row (frequency one_time), created when the quote is sent, and it
-- walks the states migration 001 declared: quote_ready -> quote_accepted -> deposit_pending ->
-- active, or cancelled.

-- rehearse: select count(*) = 0 from quotes
-- rehearse: select count(*) = 0 from lead_photos
-- rehearse: select (select value from settings where key = 'quote.deposit_percent') = '25'::jsonb
-- rehearse: select count(*) > 0 from leads where kind = 'standard'

begin;

alter table leads add column if not exists kind text not null default 'standard'
  check (kind in ('standard', 'custom'));
alter table leads add column if not exists job_kinds text[] not null default '{}';
alter table leads add column if not exists timing text check (timing in ('asap', 'month', 'flexible'));
alter table leads add column if not exists contact_pref text check (contact_pref in ('text', 'call', 'email'));
alter table leads add column if not exists postal_code text;
alter table leads add column if not exists request_token text;
alter table leads add column if not exists first_response_at timestamptz;
create unique index if not exists leads_request_token_idx on leads (request_token) where request_token is not null;
comment on column leads.request_token is
  'Capability for /quote/<token>: holding the link is the permission, as with a completion photo. '
  '24 random bytes, base64url. Null on leads that were never a custom request.';
comment on column leads.first_response_at is
  'When the owner first answered: a quote sent, or the lead marked contacted. R21 §3 — the one '
  'response-time number that is his own and not a benchmark.';

create table lead_photos (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid        not null references leads(id) on delete cascade,
  bytes       bytea       not null,
  mime        text        not null check (mime in ('image/jpeg', 'image/webp', 'image/png')),
  byte_size   integer     not null check (byte_size > 0),
  sha256      text        not null,
  created_at  timestamptz not null default now()
);
create index lead_photos_lead_idx on lead_photos (lead_id);
create unique index lead_photos_dedupe_idx on lead_photos (lead_id, sha256);

create sequence quote_number_seq start 1001;

create table quotes (
  id                    uuid primary key default gen_random_uuid(),
  number                integer     not null unique default nextval('quote_number_seq'),
  lead_id               uuid        not null references leads(id),
  customer_id           uuid        references customers(id),
  subscription_id       uuid        references subscriptions(id),
  state                 text        not null default 'draft'
                          check (state in ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired')),
  title                 text        not null default '',
  message               text        not null default '',
  is_improvement        boolean     not null default false,
  deposit_mode          text        not null default 'percent' check (deposit_mode in ('percent', 'fixed', 'none')),
  deposit_percent       integer     check (deposit_percent between 0 and 100),
  deposit_fixed_cents   integer     check (deposit_fixed_cents >= 0),
  approx_start          text        not null default '',
  approx_completion     text        not null default '',
  valid_until           date,
  sent_at               timestamptz,
  first_viewed_at       timestamptz,
  last_viewed_at        timestamptz,
  view_count            integer     not null default 0,
  accepted_at           timestamptz,
  accepted_name         text,
  accepted_ip           text,
  accepted_user_agent   text,
  accepted_terms        text,
  total_cents           integer     check (total_cents >= 0),
  deposit_cents         integer     check (deposit_cents >= 0),
  deposit_checkout      text,
  deposit_paid_at       timestamptz,
  payment_method_id     text,
  stripe_customer_id    text,
  completed_at          timestamptz,
  balance_checkout      text,
  balance_paid_at       timestamptz,
  declined_at           timestamptz,
  decline_reason        text,
  livemode              boolean,
  account_id            text,
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- The one rule the database holds as well as the code: an accepted home-improvement quote never
  -- carries a deposit above California's cap (B&P §7159.5(a)(3)): $1,000 or 10%, whichever is less.
  constraint quotes_improvement_deposit_cap check (
    not is_improvement or deposit_cents is null or total_cents is null
    or deposit_cents <= least(100000, total_cents / 10))
);
create index quotes_lead_idx on quotes (lead_id, created_at desc);
create index quotes_state_idx on quotes (state, sent_at desc);
comment on table quotes is
  'One priced offer to one lead. A revision is a new row; a sent quote is never edited under the '
  'customer. The totals and the deposit are frozen at acceptance, like a subscription price.';

create table quote_lines (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid        not null references quotes(id) on delete cascade,
  sort          integer     not null default 0,
  description   text        not null check (length(description) between 1 and 300),
  detail        text        not null default '',
  amount_cents  integer     not null check (amount_cents >= 0),
  optional      boolean     not null default false,
  chosen        boolean,
  created_at    timestamptz not null default now()
);
create index quote_lines_quote_idx on quote_lines (quote_id, sort);

-- A job that came from a quote says so.
alter table subscriptions drop constraint subscriptions_source_check;
alter table subscriptions add constraint subscriptions_source_check
  check (source in ('online', 'admin', 'import', 'quote'));

insert into settings (key, value, updated_by) values
  ('quote.deposit_percent', '25'::jsonb, 'migration:042'),
  ('quote.valid_days', '30'::jsonb, 'migration:042'),
  ('quote.reply_promise', '"within one business day"'::jsonb, 'migration:042'),
  ('quote.typical_range', '"Custom jobs usually start around $500."'::jsonb, 'migration:042'),
  ('quote.photos_max', '6'::jsonb, 'migration:042'),
  ('quote.photo_max_bytes', '900000'::jsonb, 'migration:042'),
  ('business.license_number', 'null'::jsonb, 'migration:042'),
  ('business.license_class', 'null'::jsonb, 'migration:042'),
  -- An install job over $500 is a California home-improvement contract, and §7159 fills it from
  -- facts about the business the site does not hold yet: the name on the licence, a mailing
  -- address for a Notice of Cancellation, and which insurance and workers' compensation statements
  -- are true. Null means unknown, and an install contract cannot be sent until each is known.
  ('business.legal_name', 'null'::jsonb, 'migration:042'),
  ('business.mailing_address', 'null'::jsonb, 'migration:042'),
  ('contract.cgl', 'null'::jsonb, 'migration:042'),
  ('contract.workers_comp', 'null'::jsonb, 'migration:042')
on conflict (key) do nothing;

commit;
