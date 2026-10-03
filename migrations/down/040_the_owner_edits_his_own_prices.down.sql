-- Reverse of 040. The owner goes back to needing a pull request to change a price.
--
-- catalog_changes is DROPPED and its history goes with it. That history has no other home — it
-- is not derivable from the catalog rows, which only ever hold the current value — so a revert
-- after the rate card has been used loses the answer to "what was this before". Said here rather
-- than discovered.
--
-- service_tiers.status is dropped, which UN-RETIRES every retired tier. A tier the owner took
-- off the site comes back onto it. Check for retired rows before reverting.

begin;

drop table if exists catalog_changes;

alter table service_tiers drop constraint if exists service_tiers_status_check;
alter table service_tiers drop column if exists status;

alter table services      drop column if exists updated_by;
alter table service_tiers drop column if exists updated_by;
alter table packages      drop column if exists updated_by;

delete from settings
 where key = 'catalog.public_pages_need_publish'
   and updated_by = 'migration:040';

commit;
