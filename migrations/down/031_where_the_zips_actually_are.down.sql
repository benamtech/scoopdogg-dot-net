-- Revert 031. The coordinates go away and the route economics go back to being a feeling.
--
-- server/lib/density.ts reads `to_regclass`-style presence via the column list, so a database
-- without these columns reports `measured: false` for every density figure rather than crashing.
-- Nothing else on the site reads them.
begin;

alter table area_postal_codes
  drop column if exists latitude,
  drop column if exists longitude,
  drop column if exists land_sq_mi,
  drop column if exists geo_source,
  drop column if exists geo_retrieved_on;

delete from settings
 where key in ('routing.depot_lat', 'routing.depot_lon', 'routing.depot_source',
               'routing.road_circuity', 'routing.speed_linehaul_mph', 'routing.speed_local_mph',
               'routing.bhh_k')
   and updated_by = 'migration:031';

delete from _migrations where name = '031_where_the_zips_actually_are.sql';
commit;
