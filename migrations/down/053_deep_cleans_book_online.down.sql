begin;
update service_tiers set price_is_from = true where service_slug = 'yard-deep-clean' and status = 'active' and price_cents is not null;
delete from service_tiers where service_slug = 'turf-deep-clean' and status = 'active';
update service_tiers set status = 'active' where service_slug = 'turf-deep-clean' and label = 'Turf deep clean';
commit;
