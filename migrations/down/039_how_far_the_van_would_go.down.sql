-- Reverse of 039. Drops the measured road legs and the two rows that bound the offer.
--
-- WHAT REVERTING COSTS, said plainly: the legs were measured once against the road network on a
-- dated pull, and putting them back means re-running scripts/build-corridor-postal-codes.mjs and
-- re-routing every ZIP. Nothing else in the schema points at this table, so the drop is clean —
-- but it is not free, and it is not data any other writer reproduces.
--
-- The two settings rows are deleted only if migration 039 is still their author. If the owner has
-- since moved how far he will travel, or what share of a job mobilisation may be, that is his
-- number and a revert of this migration has no business discarding it.

begin;

drop table if exists postal_road_legs;

delete from settings
 where key in ('routing.corridor_max_road_miles', 'routing.mobilisation_share')
   and updated_by = 'migration:039';

commit;
