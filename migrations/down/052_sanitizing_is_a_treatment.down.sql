begin;
update packages set status = 'active' where service_slug = 'yard-sanitizing';
update service_tiers set price_suffix = '/week' where service_slug = 'yard-sanitizing' and not requires_quote;
commit;
