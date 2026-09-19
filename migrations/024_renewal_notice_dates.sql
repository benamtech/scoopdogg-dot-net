-- Scoop Dogg — the three dates California's renewal law measures its notices from.
--
-- §17602(b) makes two notices mandatory, and both are triggered by a DURATION that this schema
-- does not currently record anywhere:
--
--   (b)(1)  a promotional or discounted price whose applicability is MORE THAN 31 DAYS needs a
--           notice 3 to 21 days before it expires.
--   (b)(2)  an initial term of ONE YEAR OR LONGER needs a notice 15 to 45 days before it renews.
--
-- MEASURED 2026-09-19, BEFORE WRITING THIS: neither is owed today. `server/lib/stripe.ts:219`
-- creates every offer coupon with `duration: 'once'`, so "first month half off" lasts exactly one
-- billing cycle - at most 31 days, one day short of the trigger. And
-- `subscriptions_frequency_check` (migration 011) permits only twice_weekly, weekly, biweekly,
-- monthly and one_time, so no term of a year can exist to renew.
--
-- SO WHY ADD THE COLUMNS NOW. Because the fact the statute turns on is not recorded at all.
-- `offers` has `first_n_visits`, and it is NULL on both live offers: the duration of the discount
-- lives only inside a Stripe coupon parameter. That means the day somebody ships "first two
-- months half off" - an obvious growth lever under P19 - or the annual option P15 §9 puts on
-- /pricing, NOTHING IN THIS DATABASE CHANGES SHAPE, no query can find the customers who are owed
-- a notice, and the omission is invisible. A rule that only a person can notice is not a rule.
--
-- With these columns, `gates/consent.mjs` can read the rows and fail the build when a product
-- crosses either threshold with no notice wired, and `server/lib/lifecycle.ts` has something real
-- to query. That is the difference between a paragraph in a plan and a reader.
--
-- `activated_at` is the third: §17602(h)'s annual reminder is measured from activation, and the
-- only record of that moment today is an `events` row. An event log is the right place for what
-- happened and the wrong place for a date a scheduled job has to filter on every day.
--
-- All three are NULLABLE and all three stay NULL for every row that exists. Nothing is
-- backfilled, because a date invented for a subscription is a fact invented about a customer.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'subscriptions' and column_name = 'promo_ends_on'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'subscriptions' and column_name = 'term_renews_on'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'subscriptions' and column_name = 'activated_at'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'offers' and column_name = 'promo_months'
-- rehearse: select count(*) = 0 from subscriptions where promo_ends_on is not null or term_renews_on is not null
-- rehearse: select count(*) = 0 from offers where promo_months is not null and promo_months > 1
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'subscriptions' and indexname = 'subscriptions_notice_due_idx'

begin;

alter table subscriptions add column promo_ends_on  date;
alter table subscriptions add column term_renews_on date;
alter table subscriptions add column activated_at   timestamptz;

comment on column subscriptions.promo_ends_on is
  'The last day a promotional or discounted price applies to THIS subscription. NULL when the '
  'discount is a single billing cycle, which is every offer today (Stripe coupons are created '
  'with duration: once). Set it whenever a promotional price will run longer than one cycle: '
  'past 31 days it triggers the notice in BPC 17602(b)(1), 3 to 21 days before this date.';
comment on column subscriptions.term_renews_on is
  'The day a committed term renews. NULL for month-to-month, which is everything today. A term '
  'of a year or longer triggers the notice in BPC 17602(b)(2), 15 to 45 days before this date.';
comment on column subscriptions.activated_at is
  'When the subscription first became active. BPC 17602(h) measures the annual reminder from '
  'this moment. The events log holds the same fact as history; this column is what a daily job '
  'can filter on.';

-- The one query lifecycle.ts runs every day. Partial, because almost every row is NULL on both.
create index subscriptions_notice_due_idx
  on subscriptions (promo_ends_on, term_renews_on)
  where promo_ends_on is not null or term_renews_on is not null;

alter table offers add column promo_months integer check (promo_months is null or promo_months >= 1);

comment on column offers.promo_months is
  'How many monthly cycles the discounted price applies for. 1, or NULL meaning 1, is the '
  'Stripe coupon duration: once that every offer uses today. Anything above 1 means the '
  'promotional price lasts more than 31 days, which makes BPC 17602(b)(1) apply - and '
  'gates/consent.mjs fails the build if such an offer exists while the notice is not wired. '
  'The existing column first_n_visits counts VISITS and is a different question; this one is '
  'about calendar time, because the statute is.';

commit;
