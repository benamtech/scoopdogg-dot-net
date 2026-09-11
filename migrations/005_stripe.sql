-- Scoop Dogg — the Stripe connection, and why the catalog is NOT synced into Stripe.
--
-- Ben, 2026-09-10: "we need him to set up stripe connect via AMTECH stripe account, done
-- through his site admin panel (where he also could connect existing stripe account
-- which would also go through AMTECH stripe connect)" and "make sure everything like
-- that can be set through the admin dashboard and is integrated with stripe."
--
-- ONBOARDING: Connect Onboarding for Standard accounts, NOT OAuth.
--
-- Stripe's own guidance: "OAuth isn't recommended for new Connect platforms. We
-- recommend using Connect Onboarding for Standard accounts instead." AMTECH's platform
-- does not exist yet, so it is a new platform and OAuth is the wrong door - even though
-- it is the one every search result points at.
--
-- Standard is also what Ben's requirement forces. It is the account type where the user
-- brings their own Stripe account, has their own dashboard, and is the merchant of
-- record. Josue clicking "Connect Stripe" in his admin either signs into the account he
-- already has or makes one, in the same hosted flow, and either way it lands as a
-- connected account under AMTECH with a 4% application fee.
--
-- WHY THE RATE CARD IS NOT MIRRORED INTO STRIPE PRODUCTS/PRICES
--
-- It would be the obvious move and it is a trap. Three reasons:
--
--   1. Stripe Price objects are IMMUTABLE. Every time Josue edits a price in the admin
--      we would have to create a new Price and migrate anything pointing at the old one.
--      He is meant to be able to raise prices freely; that is the whole point of the CMS.
--   2. A scooping month is VARIABLE - four visits or five, a skipped week, an add-on
--      deep clean, a custom quote. Stripe Subscriptions model a fixed recurring amount.
--      Ours is "sum of what actually happened", which is an invoice, not a plan.
--   3. Nine of eleven services have a "custom quote" tier. A per-customer negotiated
--      number has no Product to belong to.
--
-- So: the catalog is the single source of pricing truth, and Stripe is the rail. We
-- charge computed amounts and carry our own ids in metadata. There is no two-way sync
-- to drift, which is the headache this avoids.

begin;

-- ---------------------------------------------------------------------------
-- stripe_connection — one row. What is TRUE about the connected account, probed.
-- ---------------------------------------------------------------------------
create table stripe_connection (
  id                    boolean primary key default true check (id),  -- exactly one row
  account_id            text,                       -- acct_… . NOT a secret.
  connected_at          timestamptz,
  connected_by          text,
  -- probed from Stripe, never assumed from "onboarding finished"
  charges_enabled       boolean     not null default false,
  payouts_enabled       boolean     not null default false,
  details_submitted     boolean     not null default false,
  requirements_due      jsonb       not null default '[]'::jsonb,
  disabled_reason       text,
  last_probed_at        timestamptz,
  probe_error           text,
  -- AMTECH's cut, frozen onto each payment at charge time
  platform_fee_bps      integer     not null default 400,
  livemode              boolean     not null default false,
  updated_at            timestamptz not null default now()
);
insert into stripe_connection (id) values (true);

comment on table stripe_connection is
  'One row, and it holds only the connected ACCOUNT ID, which is not a secret. The '
  'platform secret key lives in the server environment and never reaches this database, '
  'this repo, or a model''s context.';
comment on column stripe_connection.charges_enabled is
  'Probed from Stripe, not inferred from the user finishing onboarding. A credential in '
  'a file is a claim; a live call is a fact. Every money verb refuses, visibly, when this '
  'is false - a booking that silently fails to charge is worse than one that says why.';

-- ---------------------------------------------------------------------------
-- stripe_events — the webhook log. Idempotent by Stripe's own event id.
-- ---------------------------------------------------------------------------
create table stripe_events (
  id            text primary key,           -- Stripe's evt_… . The dedupe key.
  type          text        not null,
  account_id    text,
  payload       jsonb       not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);
create index stripe_events_unprocessed_idx on stripe_events (received_at)
  where processed_at is null;
comment on table stripe_events is
  'Stripe retries webhooks and can deliver the same event more than once. Inserting on '
  'the event id makes replay a no-op rather than a double refund.';

-- ---------------------------------------------------------------------------
-- payment_methods — cards on file, held ON THE CONNECTED ACCOUNT
-- ---------------------------------------------------------------------------
create table payment_methods (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid        not null references customers(id),
  stripe_customer_id  text        not null,   -- lives on the CONNECTED account, not the platform
  stripe_pm_id        text        not null,
  brand               text, last4 text, exp_month integer, exp_year integer,
  is_default          boolean     not null default false,
  created_at          timestamptz not null default now(),
  detached_at         timestamptz
);
create unique index payment_methods_pm_idx on payment_methods (stripe_pm_id);
create index payment_methods_customer_idx on payment_methods (customer_id) where detached_at is null;
comment on column payment_methods.stripe_customer_id is
  'With DIRECT charges the Customer and its payment methods belong to the CONNECTED '
  'account. A SetupIntent saved on the platform account is not usable here without '
  'cloning, so card-on-file must be created on Josue''s account from the first customer.';

-- ---------------------------------------------------------------------------
-- Existing customers keep paying how they already pay.
-- ---------------------------------------------------------------------------
alter table customers
  add column preferred_payment text not null default 'unset'
    check (preferred_payment in ('unset','card','cash','venmo','zelle','check','other'));

comment on column customers.preferred_payment is
  'Josue is paid in cash and Venmo today. Stripe is being ADDED, not substituted. The '
  'seven existing customers must never be forced to enter a card to keep their service, '
  'so an offline method is a first-class value and `payments.kind = manual` records it.';

alter table invoices
  add column stripe_invoice_id text,
  add column collection_method text not null default 'auto'
    check (collection_method in ('auto','send_invoice','offline'));

commit;
