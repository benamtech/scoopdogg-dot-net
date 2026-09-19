-- Revert 021. The sessions go with it, and the growth board falls back to saying so: its funnel
-- metrics report `measured: false` rather than zero the moment this table is absent.
begin;
drop table if exists funnel_sessions;
delete from _migrations where name = '021_funnel_sessions.sql';
commit;
