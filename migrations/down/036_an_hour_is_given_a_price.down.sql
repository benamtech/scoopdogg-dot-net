-- Revert 036. The growth board goes back to printing no dollar figure at all: density.ts reads a
-- missing `routing.cost_per_hour_cents` as "not set" and every margin is `measured: false` again.
-- Nothing is lost but the two rows — no measurement rests on them.
begin;

delete from settings where key in ('routing.cost_per_hour_cents', 'routing.cost_per_hour_basis')
  and updated_by = 'migration:036';

delete from _migrations where name = '036_an_hour_is_given_a_price.sql';
commit;
