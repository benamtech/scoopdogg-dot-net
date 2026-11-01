-- Scoop Dogg — a line-by-line check of 046 against Josue's note (2026-11-01). The note decides; an
-- old price is not a reason for anything.
--   Turf Deep Clean   "start at 300 at least": a one-time job from $300, quoted. 046 had moved the
--                     $179/$350/$500 sizes onto turf, which the note never says.
--   Yard Deep Clean   the note gives those sizes here and also says "no specific price, custom
--                     quote": so they are shown as starting points and every job goes to a quote.
--   Scooping          the note stops at 4 dogs: "4 dogs" at $30, five or more is a quote.
--   Litter exchange   "$20 per box", with no plan in the note: 1-4 boxes at $20 each a visit, and the
--                     monthly plans (never Josue's) are retired. Five or more is a quote.
--   Litter robot      "very careful technical maintenance" goes in what every cleaning includes.
--   Custom quote      "usually start around $500" came before the note and disagrees with it.

-- rehearse: select price_cents = 30000 and price_is_from from service_tiers where service_slug = 'turf-deep-clean' and status = 'active'
-- rehearse: select count(*) = 3 from service_tiers where service_slug = 'yard-deep-clean' and status = 'active' and price_is_from
-- rehearse: select count(*) = 0 from packages where service_slug = 'kitty-litter-exchange' and status = 'active'

begin;

create temp table _before on commit drop as
  select 'tier' as entity, id, label, price_cents as cents from service_tiers
  union all select 'package', id, name, monthly_price_cents from packages;

-- ---- deep cleans
update service_tiers set service_slug = 'yard-deep-clean', price_is_from = true, sort_order = 10, updated_by = 'josue' where id = 'be225a4c-d403-483b-9737-370eb4f22aaa';
update service_tiers set service_slug = 'yard-deep-clean', price_is_from = true, sort_order = 20, updated_by = 'josue' where id = '0691e980-0241-446d-9dfd-b2758ad74a9f';
update service_tiers set service_slug = 'yard-deep-clean', price_is_from = true, sort_order = 30, updated_by = 'josue' where service_slug = 'turf-deep-clean' and label = 'Large yard (500-800 sq ft)';
update service_tiers set service_slug = 'yard-deep-clean', sort_order = 40, updated_by = 'josue' where service_slug = 'turf-deep-clean' and label = 'Over 800 sq ft';
update service_tiers set status = 'retired', updated_by = 'josue' where id = 'c92a7e68-477d-47b2-96b3-14afdf04818b';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by)
values ('turf-deep-clean', 'Turf deep clean', null, null, 30000, '', false, true, 10, 180, 'josue');
update services set price_basis = 'flat', basis_label = 'Tell us about the turf',
  pricing_note = 'A one-time job, quoted to your turf. Call or send the details and you get one price. For weekly care after, sign up for Turf Deodorizing.',
  meta_description = 'One-time artificial turf deep clean: brush, vacuum, pressure wash and heavy deodorizer. Ideal for seasonal resets and new homeowners. Call or send the details for one price.',
  updated_by = 'josue' where slug = 'turf-deep-clean';
update services set price_basis = 'sqft', basis_label = 'Roughly how big is the yard?',
  pricing_note = 'No set price: every yard is different. These are starting points. Call or send the details and you get one price.',
  updated_by = 'josue' where slug = 'yard-deep-clean';

-- ---- four dogs is where the note stops
update service_tiers set label = '4 dogs', max_qty = 4, updated_by = 'josue' where id = 'fd0ea69a-aaae-4210-8c4d-66742bb07495';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by)
values ('weekly-pooper-scooper-service', '5+ dogs', 5, null, null, '', true, false, 50, 30, 'josue');
update packages set name = 'Weekly poop scooping · 4 dogs', short_label = '4 dogs', updated_by = 'josue' where slug = 'scoop-weekly-4-plus-dogs';

-- ---- twenty dollars a box
update packages set status = 'retired', updated_by = 'josue' where service_slug = 'kitty-litter-exchange';
update service_tiers set label = '3 litter boxes', max_qty = 3, price_cents = 6000, price_suffix = '/visit', requires_quote = false, updated_by = 'josue' where id = 'c50ab406-254a-40a8-8de3-f10f5c5933c2';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by) values
  ('kitty-litter-exchange', '4 litter boxes', 4, 4, 8000, '/visit', false, false, 35, 30, 'josue'),
  ('kitty-litter-exchange', '5+ litter boxes', 5, null, null, '', true, false, 40, 40, 'josue');
update services set pricing_note = 'Priced per box, per visit. Litter not included unless requested.', updated_by = 'josue' where slug = 'kitty-litter-exchange';

-- ---- the robot, and the old custom-job line
update services set what_includes = array_prepend('Very careful technical maintenance', what_includes), updated_by = 'josue' where slug = 'kitty-litter-robot-cleaning';
update settings set value = '""'::jsonb where key = 'quote.typical_range';

insert into catalog_changes (entity, entity_id, entity_label, field, old_value, new_value, changed_by)
select b.entity, b.id, b.label, 'price_cents', b.cents::text, a.cents::text, 'josue (his note, line by line, 2026-11-01)'
  from _before b join (select 'tier' as entity, id, price_cents as cents from service_tiers
                       union all select 'package', id, monthly_price_cents from packages) a using (entity, id)
 where a.cents is distinct from b.cents;

commit;
