-- Puts 049 back.
begin;
delete from service_tiers where service_slug = 'turf-deep-clean' and label = 'Turf deep clean';
update service_tiers set service_slug = 'turf-deep-clean', price_is_from = false where id in ('be225a4c-d403-483b-9737-370eb4f22aaa', '0691e980-0241-446d-9dfd-b2758ad74a9f');
update service_tiers set service_slug = 'turf-deep-clean', price_is_from = false where service_slug = 'yard-deep-clean' and label in ('Large yard (500-800 sq ft)', 'Over 800 sq ft');
update service_tiers set status = 'active' where id = 'c92a7e68-477d-47b2-96b3-14afdf04818b';
update services set price_basis = 'sqft' where slug = 'turf-deep-clean';
update services set price_basis = 'flat' where slug = 'yard-deep-clean';
update service_tiers set label = '4+ dogs', max_qty = null where id = 'fd0ea69a-aaae-4210-8c4d-66742bb07495';
delete from service_tiers where service_slug = 'weekly-pooper-scooper-service' and label = '5+ dogs';
update packages set name = 'Weekly poop scooping · 4+ dogs', short_label = '4+ dogs' where slug = 'scoop-weekly-4-plus-dogs';
update packages set status = 'active' where service_slug = 'kitty-litter-exchange';
delete from service_tiers where service_slug = 'kitty-litter-exchange' and label in ('4 litter boxes', '5+ litter boxes');
update service_tiers set label = '3+ litter boxes', max_qty = null, price_cents = null, price_suffix = '', requires_quote = true where id = 'c50ab406-254a-40a8-8de3-f10f5c5933c2';
update services set what_includes = array_remove(what_includes, 'Very careful technical maintenance') where slug = 'kitty-litter-robot-cleaning';
update settings set value = '"Custom jobs usually start around $500."'::jsonb where key = 'quote.typical_range';
commit;
