-- Scoop Dogg — a yard over 800 sq ft has an answer for sanitizing too: a custom quote, like the rest.

-- rehearse: select count(*) = 1 from service_tiers where service_slug = 'yard-sanitizing' and requires_quote

begin;
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by)
values ('yard-sanitizing', 'Over 800 sq ft', 800, null, null, '', true, false, 40, 30, 'josue');
commit;
