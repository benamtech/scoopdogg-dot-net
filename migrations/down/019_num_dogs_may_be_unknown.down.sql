-- Revert 019. Anything unknown becomes 1 again, which is what the constraint used to force.
begin;
update properties set num_dogs = 1 where num_dogs is null;
alter table properties alter column num_dogs set default 1;
alter table properties alter column num_dogs set not null;
comment on column properties.num_dogs is null;
delete from _migrations where name = '019_num_dogs_may_be_unknown.sql';
commit;
