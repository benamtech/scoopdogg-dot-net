-- Revert 020: the postal map goes away entirely and the funnel falls back to the city list.
begin;
drop table if exists area_postal_codes;
delete from _migrations where name = '020_postal_codes.sql';
commit;
