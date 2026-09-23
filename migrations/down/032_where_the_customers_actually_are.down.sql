-- Revert 032. The route model goes back to reading the ZCTA internal point as if it were where
-- the customers are, which puts Ventura 93001 — the depot's own city — 39.9 miles offshore and
-- ranks it the most expensive place in the network to serve one more customer.
--
-- The columns are DROPPED rather than nulled: `server/lib/density.ts` asks
-- `populatedCentres()` whether they exist and falls back to the polygon when they do not, so
-- their absence reads as "this database predates 032" while four null columns would read as
-- "the population centre of Ventura is unknown". Those are different sentences and only the
-- first one is true.
--
-- Nothing in 031 is touched. `latitude`, `longitude` and `land_sq_mi` were never modified by
-- 032 and are the correct answer to their own question.
begin;

alter table area_postal_codes
  drop column if exists populated_lat,
  drop column if exists populated_lon,
  drop column if exists populated_sq_mi,
  drop column if exists zcta2020_sq_mi,
  drop column if exists population,
  drop column if exists populated_tracts,
  drop column if exists populated_geo_source,
  drop column if exists populated_retrieved_on;

delete from _migrations where name = '032_where_the_customers_actually_are.sql';
commit;
