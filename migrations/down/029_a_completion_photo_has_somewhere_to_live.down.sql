-- Revert 029. Photo storage goes away and visit.complete goes back to refusing every completion
-- while visit.require_completion_photo is true — which is what it did before, and it says so.
--
-- THE PHOTOS ARE DELETED. There is nowhere else they exist. If any visit has been completed with
-- one, its visits.photo_urls entries become links to nothing, so this down migration also clears
-- those entries rather than leaving a row that points at a 404.
begin;

update visits
   set photo_urls = '{}'::text[], updated_at = now()
 where exists (select 1 from visit_photos p where p.visit_id = visits.id);

drop table if exists visit_photos;

delete from settings
 where key in ('visit.photo_max_bytes', 'visit.photo_retention_days', 'visit.photos_per_visit_max')
   and updated_by = 'migration:029';

delete from _migrations where name = '029_a_completion_photo_has_somewhere_to_live.sql';
commit;
