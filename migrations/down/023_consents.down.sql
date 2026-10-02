-- Revert 023. The table goes; there is nothing else to undo.
--
-- A NOTE FOR WHOEVER RUNS THIS: if it has real rows, it is a legal record with a retention period
-- attached (three years, or one year past termination). Dropping it is not a schema change in
-- that case - take a dump first.
begin;
drop table if exists consents;
delete from _migrations where name = '023_consents.sql';
commit;
