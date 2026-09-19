-- Revert 026. The catch-up goes back to being an optional add-on.
--
-- This restores `offer_optional`, which is what the funnel did until 2026-09-19, rather than
-- deleting the setting: a booking flow with no policy row at all would fall back to a code
-- default, and the whole point of the column is that the rule is a row.
begin;

update settings set value = '"offer_optional"', updated_by = 'amtech-revert', updated_at = now()
 where key = 'booking.initial_cleanup_policy';

alter table service_tiers drop column if exists covers_last_cleaned;

delete from _migrations where name = '026_catch_up_is_not_optional.sql';
commit;
