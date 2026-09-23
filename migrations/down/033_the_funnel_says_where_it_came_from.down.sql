-- Revert 033. The funnel goes back to being unable to say where a visitor came from, and the
-- growth board goes back to counting AMTECH's own gate runs as this client's booking-intent
-- sessions — all 25 of them, at the time of writing.
--
-- The column is dropped rather than nulled. `server/lib/growth.ts` filters on it and would read a
-- table of nulls as "every session is a customer", which is the state this migration exists to
-- end; its absence at least reads as "this database predates 033".
begin;

drop index if exists funnel_sessions_source_idx;
alter table funnel_sessions drop constraint if exists funnel_sessions_source_shape;
alter table funnel_sessions drop column if exists source;

delete from _migrations where name = '033_the_funnel_says_where_it_came_from.sql';
commit;
