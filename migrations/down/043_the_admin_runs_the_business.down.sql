-- Reverts 043. Only safe while no manual payment or job date has been written.
begin;
alter table payments drop column if exists recorded_by;
alter table payments drop column if exists note;
alter table payments drop column if exists method;
drop index if exists quotes_scheduled_idx;
alter table quotes drop column if exists scheduled_for;
commit;
