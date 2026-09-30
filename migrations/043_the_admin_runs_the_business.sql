-- Scoop Dogg — the admin runs the business the site brings in (2026-09-30, §4 of the final session).
--
-- Two gaps, both additive:
--
-- 1. A custom job had no date. `quotes` records when it was approved, when the deposit landed and
--    when it was completed, but not when Josue is going to do it — so the Jobs screen could not tell
--    "deposit paid, to schedule" from "on the calendar for Tuesday". `scheduled_for` is the day he
--    books it for, written from the Jobs screen (server/lib/business.ts scheduleJob).
--
-- 2. A cash or Venmo payment had nowhere to say HOW it was paid. `payments.kind = 'manual'` has
--    been allowed since migration 001 and nothing has ever written it. The fee report
--    (server/lib/growth.ts) already sums only charge/deposit/refund, so a manual payment carries no
--    AMTECH fee by construction. `method` and `note` are what he writes down; `recorded_by` is who.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'quotes' and column_name = 'scheduled_for'
-- rehearse: select count(*) = 3 from information_schema.columns where table_name = 'payments' and column_name in ('method', 'note', 'recorded_by')

begin;

alter table quotes add column if not exists scheduled_for date;
create index if not exists quotes_scheduled_idx on quotes (scheduled_for) where scheduled_for is not null;

alter table payments add column if not exists method      text check (method is null or method in ('card', 'cash', 'venmo', 'zelle', 'check', 'other'));
alter table payments add column if not exists note        text not null default '';
alter table payments add column if not exists recorded_by text;
comment on column payments.method is
  'How a MANUAL payment was paid. Null for Stripe rows, whose method Stripe holds. A manual row carries '
  'no platform fee and is not in the fee report (growth.ts sums charge, deposit and refund only).';

commit;
