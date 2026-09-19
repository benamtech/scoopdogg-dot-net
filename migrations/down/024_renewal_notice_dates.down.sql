-- Revert 024. Additive columns and one index, so the revert is a clean drop.
--
-- It is NOT conditional on the columns being empty, and that is deliberate. The dates here are
-- derived facts - when a promo ends, when a term renews, when the plan activated - all of which
-- can be recomputed from Stripe and from the events log. Dropping them loses a query surface,
-- not evidence. `consents` is the table where losing rows would be losing evidence, and nothing
-- in this migration or its revert touches it.
begin;

drop index if exists subscriptions_notice_due_idx;
alter table subscriptions drop column if exists promo_ends_on;
alter table subscriptions drop column if exists term_renews_on;
alter table subscriptions drop column if exists activated_at;
alter table offers drop column if exists promo_months;

delete from _migrations where name = '024_renewal_notice_dates.sql';
commit;
