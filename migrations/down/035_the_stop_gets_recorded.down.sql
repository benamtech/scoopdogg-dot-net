-- Revert 035. Visits go back to having no clock, `est_minutes` goes back to being both the input
-- to the price ladder and the standard the ladder is checked against, and the growth board's
-- whole ranking goes back to resting on one estimate that cannot be wrong independently of
-- itself.
--
-- THIS DESTROYS MEASUREMENTS. `arrived_at` is dropped, and every recorded arrival with it. That
-- is unavoidable — the column is the record — and it is the reason to think before reverting
-- rather than a reason not to be able to. `en_route_at` is left alone: it predates this
-- migration and dropping it would take migration 001's column with it.
begin;

drop index if exists visits_measured_idx;
alter table visits drop constraint if exists visits_stop_clock_in_order;
alter table visits drop column if exists arrived_at;

delete from _migrations where name = '035_the_stop_gets_recorded.sql';
commit;
