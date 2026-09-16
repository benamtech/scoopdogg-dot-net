-- Scoop Dogg — demo mode, and the outbox becoming a mechanism.
--
-- Two things happen here and they are the same thing.
--
-- 1. ONE setting, `demo.mode`, over four surfaces: mail, the client pages, the booking
--    journey and Stripe. Four half-modes behind four switches is how one gets left on.
--    It defaults to FALSE, so a missing row means LIVE. That is the right direction to
--    fail: a demo that accidentally goes live is a bad afternoon, a live system that
--    silently swallows a customer's booking confirmation is a lost job.
--
-- 2. `outbox` gets the columns it needs to be written to. It was created in 001_core.sql
--    with five states and a retry budget and has never held a row, so "did that message
--    arrive" has never been answerable from this database. The columns added here are the
--    ones that make the answer come from OBSERVED provider state rather than from the
--    send call's 200 — which means accepted, not delivered, and cannot see a bounce.

begin;

-- ---------------------------------------------------------------------------
-- demo mode — one setting, four surfaces
-- ---------------------------------------------------------------------------
insert into settings (key, value, updated_by) values
  ('demo.mode', 'false'::jsonb, 'seed')
  on conflict (key) do nothing;

-- Where every outbound message goes instead while demo mode is on. AMTECH's oversight
-- address, which is already on notify.lead_cc. Ben's to change; it is a row, not a rewrite.
insert into settings (key, value, updated_by) values
  ('demo.address', '"ben@amtechai.com"'::jsonb, 'seed')
  on conflict (key) do nothing;

-- A mode you cannot see from the screen is a mode that ships. This is the words.
insert into settings (key, value, updated_by) values
  ('demo.banner_text',
   '"DEMO MODE — this is a demonstration of the Scoop Dogg system. Bookings made here are not real appointments and no message reaches a customer."'::jsonb,
   'seed')
  on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- outbox — enough columns to have a writer, and to take its terminal state from
-- an observed event instead of from the send call
-- ---------------------------------------------------------------------------
alter table outbox add column if not exists purpose       text;
alter table outbox add column if not exists provider      text;
alter table outbox add column if not exists provider_id   text;
alter table outbox add column if not exists demo          boolean not null default false;
alter table outbox add column if not exists last_event    text;
alter table outbox add column if not exists last_event_at timestamptz;

comment on column outbox.provider_id is
  'The provider''s own id for this message. It is the second copy of the receipt: with it, '
  'delivery can be read back from the provider''s index long after the send call returned.';
comment on column outbox.last_event is
  'The last OBSERVED provider event - email.delivered, email.bounced, email.complained. '
  'Never written from the send call''s status code.';

-- One outbox row per provider message, so reconciling twice cannot fork the history.
create unique index if not exists outbox_provider_msg_idx
  on outbox (provider, provider_id) where provider_id is not null;

-- The rows a reconciler has to look at: accepted but not yet resolved either way.
create index if not exists outbox_unresolved_idx
  on outbox (state) where state in ('pending', 'delivering');

-- ---------------------------------------------------------------------------
-- suppressions — a complaint is not a retryable failure
-- ---------------------------------------------------------------------------
create table if not exists email_suppressions (
  address    text primary key,
  reason     text        not null,
  event      text        not null,
  outbox_id  bigint      references outbox(id),
  created_at timestamptz not null default now()
);
comment on table email_suppressions is
  'An address that bounced hard or complained. Sending to it again costs the sending '
  'domain its reputation, which is shared with every other message this business sends.';

commit;
