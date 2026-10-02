-- Scoop Dogg — the rows step 4 needs: the crew role, a revocable connection, and invites.
--
-- Ben, 2026-09-19: "josue connecting his stripe account isnt a step in the development plan, its
-- a feature." So SPEC step 3 is a feature of the admin's Payments screen and this migration
-- carries what that feature and the rest of the admin need. Nothing here is a screen; screens
-- read rows, and P18 §2's rule is that an item is done when its ROW exists, never when a box is
-- ticked. That is why there is no checklist table: a checklist with its own state can disagree
-- with the thing it describes, and then the admin lies politely.
--
-- THREE CHANGES.
--
-- 1. THE CREW ROLE. `team_members.role` has admitted ('superadmin','admin','team') since 001 and
--    nothing has ever written 'team' — the word appears in no screen, no route and no query.
--    P18 §4 names two roles, owner and crew, and crew exists so the crew loop has somewhere to
--    land when it ships. Renaming the unused value is cheaper than carrying two names for one
--    idea, so 'team' becomes 'crew' and the default moves with it. There are four rows today,
--    two superadmin and two admin, and none of them is touched.
--
--    JOSUE ALREADY HAS AN ADMIN ACCOUNT. Measured 2026-09-19: team_members holds
--    josue@scoopdogg.net and scoopdogg129@gmail.com, both role 'admin', both active, and
--    admin-auth.ts's startLogin admits them. P18 §4 and SPEC step 4 both say nobody has ever
--    created it. That was stale, and no migration is needed for it.
--
-- 2. A CONNECTION THAT CAN BE REVOKED. P18 §1.4 wrote the disconnect as OAuth deauthorize. This
--    integration creates Accounts v2 with a full dashboard, and Stripe's own close endpoint
--    answers `stripe_loss_liable_cannot_be_deleted` for exactly that shape — measured against the
--    API reference 2026-09-19. So disconnecting is not deleting anything of Josue's: the platform
--    fee comes off every live subscription first (P17 §8, scripts/remove-platform-fee.mjs), and
--    then THIS row records that we stopped. The account stays his, which was always the point.
--
-- 3. INVITES, WHICH ARE LEVER 1. P18 §3: his existing cash and Venmo customers come onto the rail
--    at THEIR price, not the published ladder. The token is stored as an HMAC and never in plain
--    text, the same shape verification_codes already uses, because an invite link is a sign-in.

-- rehearse: select pg_get_constraintdef(oid) like '%crew%' from pg_constraint where conname = 'team_members_role_check'
-- rehearse: select pg_get_constraintdef(oid) not like '%''team''%' from pg_constraint where conname = 'team_members_role_check'
-- rehearse: select count(*) = 0 from team_members where role = 'team'
-- rehearse: select count(*) = 4 from team_members where role in ('superadmin','admin')
-- rehearse: select count(*) = 2 from information_schema.columns where table_name = 'stripe_connection' and column_name in ('revoked_at','revoked_by')
-- rehearse: select count(*) = 0 from stripe_connection where revoked_at is not null
-- rehearse: select count(*) = 0 from customer_invites
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'customer_invites' and column_name = 'token_hash' and is_nullable = 'NO'
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'customer_invites' and indexdef like '%token_hash%'
-- rehearse: select (select value from settings where key = 'booking.lanes_enabled') = '"prepay,payafter"'::jsonb
-- rehearse: select (select value from settings where key = 'booking.payafter_charge_offset_days') = '1'::jsonb
-- rehearse: select (select value from settings where key = 'booking.onetime_enabled') = 'true'::jsonb
-- rehearse: select (select value from settings where key = 'growth.review_request_after_visits') = '3'::jsonb

begin;

-- 1. the crew role ---------------------------------------------------------------------------
update team_members set role = 'crew', updated_at = now() where role = 'team';
alter table team_members drop constraint team_members_role_check;
alter table team_members alter column role set default 'crew';
alter table team_members add constraint team_members_role_check
  check (role in ('superadmin','admin','crew'));

comment on column team_members.role is
  'superadmin is AMTECH, admin is the owner, crew is the person in the truck. A crew session '
  'sees today''s stops and nothing about money, customers or settings - gates/admin-roles.mjs '
  'is what keeps that true rather than this comment.';

-- 2. a connection that can be revoked ---------------------------------------------------------
alter table stripe_connection add column if not exists revoked_at timestamptz;
alter table stripe_connection add column if not exists revoked_by text;

comment on column stripe_connection.revoked_at is
  'When AMTECH stopped charging through this account. Set by the admin disconnect, and only '
  'after remove-platform-fee has cleared application_fee_percent from every live subscription '
  '(P17 §8: Stripe keeps collecting it otherwise). The connected account itself is NOT closed - '
  'Stripe refuses to close a full-dashboard account it is loss-liable for, and it is the '
  'client''s account anyway.';

-- 3. invites ----------------------------------------------------------------------------------
create table customer_invites (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid        not null references customers(id),
  property_id     uuid        references properties(id),
  subscription_id uuid        references subscriptions(id),
  email           text        not null,
  phone           text,
  price_cents     integer     not null check (price_cents > 0),
  package_id      uuid        references packages(id),
  token_hash      text        not null,
  created_by      text        not null,
  sent_at         timestamptz,
  accepted_at     timestamptz,
  expires_at      timestamptz not null default now() + interval '30 days',
  created_at      timestamptz not null default now()
);
create unique index customer_invites_token_idx on customer_invites (token_hash);
create index customer_invites_open_idx on customer_invites (created_at desc) where accepted_at is null;

comment on table customer_invites is
  'P18 §3. Josue is paid in cash and Venmo today; each customer who moves onto the rail is 9% '
  'that did not exist, and it starts the month they move. THE PRICE ON THIS ROW IS THE PRICE '
  'HE TYPED, never the published ladder - "a price change applies to new customers only" '
  'protects his existing customers here too.';
comment on column customer_invites.token_hash is
  'An HMAC of the link token, never the token. The link signs a customer in, so it is a '
  'credential and is stored the way verification_codes stores one.';

-- 4. the settings step 5 reads ------------------------------------------------------------------
-- Seeded now, with the admin, so the funnel reads ROWS on its first run rather than a constant
-- somebody means to move into settings later.
insert into settings (key, value, updated_by) values
  ('booking.lanes_enabled',             '"prepay,payafter"'::jsonb, 'migration:018'),
  ('booking.payafter_charge_offset_days','1'::jsonb,                'migration:018'),
  ('booking.onetime_enabled',           'true'::jsonb,              'migration:018'),
  ('growth.review_request_after_visits','3'::jsonb,                 'migration:018')
on conflict (key) do nothing;

commit;
