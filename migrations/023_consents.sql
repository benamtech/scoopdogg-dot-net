-- Scoop Dogg — the consent record California's Automatic Renewal Law requires us to keep.
--
-- P16 §6. AB 2863 has been in force since 2025-07-01 and it expanded "automatic renewal" to cover
-- FREE-TO-PAY CONVERSIONS, which is exactly what lane B is: a card saved today, charged the day
-- after the first visit. So both lanes need express affirmative consent to the renewal terms,
-- separately from the rest of the transaction, and the record has to survive.
--
-- (A law firm's public summary, read 2026-09-18, not legal advice. AMTECH is not a law firm.)
--
-- THE RETENTION RULE IS WHY THIS IS A TABLE AND NOT A COLUMN: three years, or one year past
-- termination, whichever is longer. A boolean on `subscriptions` would be deleted or overwritten
-- by the first cancellation; the thing that has to survive is WHAT THE CUSTOMER WAS SHOWN, word
-- for word, on the day they agreed to it.
--
-- `text_shown` is the sentence as rendered, with the amount in it. The amount is rendered from
-- the package row and never typed, and gates/consent.mjs compares this column to the sentence the
-- review step produces - byte for byte - so the two cannot drift apart. A consent record that
-- does not match what was on the screen is evidence of the wrong thing.

-- rehearse: select count(*) = 0 from consents
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'consents' and column_name = 'text_shown' and is_nullable = 'NO'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'consents' and column_name = 'price_cents' and is_nullable = 'NO'
-- rehearse: select pg_get_constraintdef(oid) like '%renewal%' from pg_constraint where conname = 'consents_kind_check'
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'consents' and indexname = 'consents_subscription_idx'

begin;

create table consents (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid        references customers(id),
  subscription_id  uuid        references subscriptions(id),
  /** What was being agreed to. 'renewal' is the ARL one; the others are named now so a later
      kind does not arrive as a free-text string nobody can query. */
  kind             text        not null default 'renewal'
                     check (kind in ('renewal','price_change','marketing')),
  text_shown       text        not null,
  price_cents      integer     not null,
  lane             text        check (lane is null or lane in ('prepay','payafter','onetime')),
  agreed_at        timestamptz not null default now(),
  ip               text,
  user_agent       text,
  created_at       timestamptz not null default now()
);
create index consents_subscription_idx on consents (subscription_id);
create index consents_customer_idx on consents (customer_id, agreed_at desc);

comment on table consents is
  'California AB 2863. Kept three years, or one year past termination, whichever is longer - so '
  'nothing in this table is deleted by a cancellation, and demo-clear.mjs must not remove a real '
  'one. The row is written in the SAME transaction as the booking that created it: a Checkout '
  'session with no consent row is the failure gates/consent.mjs exists to catch.';
comment on column consents.text_shown is
  'The sentence the customer actually read, with the amount already in it. Rendered from the '
  'package row, never typed. If this and the review step ever disagree, the consent record is '
  'evidence of something that was never on the screen.';

commit;
