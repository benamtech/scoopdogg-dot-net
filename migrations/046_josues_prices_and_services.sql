-- Scoop Dogg — Josue's prices and services, 2026-11-01 (his notes, relayed by Ben).
--
-- Every number below is his. What moved:
--   Scooping          $20 / $25 / $28 / $30 a week; a month is four weeks ($80 / $100 / $112 / $120).
--   Turf Deodorizing  is the old Weekly Turf Maintenance, renamed, at $35 / $50 / $60 a week. The old
--                     one-time Artificial Turf Deodorizing ($25) is gone; its URL redirects here.
--   Yard Sanitizing   an add-on to weekly scooping, $25 / $35 / $45 by yard size. Not sold alone.
--   Turf Deep Clean   a one-time job of its own: $179 / $350 / $500, a quote over 800 sq ft.
--   Yard Deep Clean   overgrowth and heavy clean-ups: no set price, custom quote.
--   Yard Maintenance  $60 a visit for a small or medium yard, one price. Extra work $60 an hour.
--   Litter exchange   $20 a box a visit, so a weekly month is four visits ($80 / $160).
-- One size language everywhere: small up to 300 sq ft, medium 300-500, large 500-800.
-- The URLs stay (the weekly turf page ranks for "turf maintenance"), so the slug is not renamed.

-- rehearse: select count(*) = 1 from services where slug = 'turf-deep-clean' and status = 'active'
-- rehearse: select count(*) = 1 from services where slug = 'yard-sanitizing' and kind = 'addon'
-- rehearse: select count(*) = 1 from services where slug = 'artificial-turf-deodorizing' and status = 'retired'
-- rehearse: select monthly_price_cents = 8000 from packages where slug = 'scoop-weekly-1-dog'

begin;

create temp table _before on commit drop as
  select 'tier' as entity, id::text as id, label, price_cents as cents from service_tiers
  union all select 'package', id::text, name, monthly_price_cents from packages;

-- ---- scooping
update service_tiers set price_cents = 2000, updated_by = 'josue' where id = 'c20d2bba-0759-487a-88ed-c6296947af79';
update service_tiers set price_cents = 2500, updated_by = 'josue' where id = 'c1f8b8ce-757c-4eec-9ab4-e1f84eccf3c4';
update service_tiers set price_cents = 2800, updated_by = 'josue' where id = 'a2530a29-7bf1-4089-8ef8-5953a5430af5';
update service_tiers set price_cents = 3000, updated_by = 'josue' where id = 'fd0ea69a-aaae-4210-8c4d-66742bb07495';
update packages set monthly_price_cents = 8000,  visits_per_month = 4, derivation = 'Josue, 2026-11-01: $20 a week, four weeks', updated_by = 'josue' where slug = 'scoop-weekly-1-dog';
update packages set monthly_price_cents = 10000, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $25 a week, four weeks', updated_by = 'josue' where slug = 'scoop-weekly-2-dogs';
update packages set monthly_price_cents = 11200, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $28 a week, four weeks', updated_by = 'josue' where slug = 'scoop-weekly-3-dogs';
update packages set monthly_price_cents = 12000, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $30 a week, four weeks', updated_by = 'josue' where slug = 'scoop-weekly-4-plus-dogs';
update services set pricing_note = 'One price a week by how many dogs you have, billed monthly. No sign-up fees. Cancel or pause anytime.',
  related_slugs = '{yard-sanitizing,one-time-dog-poop-cleanup,weekly-turf-maintenance}', updated_by = 'josue'
 where slug = 'weekly-pooper-scooper-service';

-- ---- the add-ons
insert into services (slug, name, short_name, kind, price_basis, basis_label, pricing_note, sort_order, status,
                      meta_title, meta_description, h1, intro, what_includes, who_its_for, faqs, related_slugs, updated_by)
values ('yard-sanitizing', 'Yard Sanitizing', 'Sanitizing', 'addon', 'sqft', 'Roughly how big is the yard?',
  'An add-on to weekly poop scooping, priced by the size of your yard.', 25, 'active',
  'Yard Sanitizing Add-On for Weekly Scooping | Scoop Dogg',
  'Add yard sanitizing to your weekly poop scooping. Pet-safe treatment that kills odor and germs where your dog goes. Priced by the size of your yard.',
  'Yard Sanitizing for Weekly Scooping Customers',
  'Scooping takes away what you can see. Sanitizing takes care of what you cannot. We treat the areas your dog uses most with a pet-safe sanitizer that breaks down odor and germs, so the yard smells as clean as it looks. It is an add-on to weekly poop scooping: pick your dogs, pick your yard size, and it is done on your first visit. Want it again later? Just ask Josue.',
  array['Pet-safe sanitizer on the areas your dog uses most','Odor and germs treated at the source','Done on the same visit as your scooping','Works on turf, grass, gravel and concrete'],
  'Weekly scooping customers who want the yard to smell clean too, especially with more than one dog or in hot weather.',
  '[{"q":"Can I get sanitizing without scooping?","a":"Sanitizing is an add-on to weekly poop scooping. If you only need the odor taken care of on turf, look at Turf Deodorizing."},{"q":"Is it safe for my dog?","a":"Yes. It is pet-safe."},{"q":"How do I know my yard size?","a":"Small is up to 300 sq ft, medium is 300 to 500, and large is 500 to 800. A rough guess is fine."}]'::jsonb,
  '{weekly-pooper-scooper-service}', 'josue'),
 ('extra-yard-work', 'Extra Yard Work', 'Extra Work', 'addon', 'flat', 'How much extra work?',
  'Need something special on top of your weekly visit? Extra work is charged by the hour.', 65, 'active',
  'Extra Yard Work by the Hour | Scoop Dogg',
  'Need something special on top of your weekly yard maintenance? Add extra gardening or yard work, charged by the hour. Big hedges get a custom quote.',
  'Extra Yard Work, by the Hour',
  'Sometimes a yard needs a little more than the usual mow and blow. Add an hour of extra work to your weekly yard maintenance visit for gardening, small trims or anything else on your list. Tell us what you need when you book and it gets done while we are there. Big hedges and larger jobs are a different size of job, so call or send the details for a custom quote.',
  array['Gardening and small trims','Extra debris or leaf clean-up','Anything else on your list, as time allows'],
  'Weekly yard maintenance customers who want a little extra done on a visit.',
  '[{"q":"What about big hedges?","a":"Big hedges and bigger trimming jobs need a custom quote. Call or send the details and we will give you one price."}]'::jsonb,
  '{weekly-yard-maintenance}', 'josue');
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by) values
  ('yard-sanitizing', 'Small yard (up to 300 sq ft)', null, 300, 2500, '', false, false, 10, 15, 'josue'),
  ('yard-sanitizing', 'Medium yard (300-500 sq ft)', 300, 500, 3500, '', false, false, 20, 20, 'josue'),
  ('yard-sanitizing', 'Large yard (500-800 sq ft)', 500, 800, 4500, '', false, false, 30, 25, 'josue'),
  ('extra-yard-work', 'One hour of extra work', null, null, 6000, '/hour', false, false, 10, 60, 'josue');

-- ---- turf: the deep clean is its own job
insert into services (slug, name, short_name, kind, price_basis, basis_label, pricing_note, sort_order, status,
                      meta_title, meta_description, h1, intro, what_includes, who_its_for, faqs, related_slugs, updated_by)
select 'turf-deep-clean', 'Turf Deep Clean', 'Turf Deep Clean', 'one_time', 'sqft', basis_label,
  'A one-time job, priced by the size of your turf. For weekly care after, sign up for Turf Deodorizing.', 38, 'active',
  'Artificial Turf Deep Clean in Ventura County | Scoop Dogg',
  'One-time artificial turf deep clean: brush, vacuum, pressure wash and heavy deodorizer. Ideal for seasonal resets and new homeowners. Priced by the size of your turf.',
  'Turf Deep Clean in Ventura County', intro, what_includes,
  who_its_for,
  '[{"q":"How often should I get a deep clean?","a":"We recommend 2-3 times per year for most properties. Homes with multiple dogs or heavy use may benefit from quarterly service."},{"q":"Is this the same as Turf Deodorizing?","a":"No. A deep clean is a one-time job with physical cleaning: brush, vacuum and pressure wash, plus deodorizing. Turf Deodorizing is the weekly service that keeps it fresh afterward."},{"q":"How long does a deep clean take?","a":"Most standard properties take 1-2 hours. Larger or heavily soiled areas may take longer."},{"q":"Can I walk on the turf right after?","a":"We recommend waiting 1-2 hours for the surface to dry after pressure washing. The deodorizer is pet-safe immediately."}]'::jsonb,
  '{weekly-turf-maintenance,yard-deep-clean,weekly-pooper-scooper-service}', 'josue'
from services where slug = 'yard-deep-clean';
update service_tiers set service_slug = 'turf-deep-clean', label = 'Small yard (up to 300 sq ft)', min_qty = null, max_qty = 300, price_cents = 17900, updated_by = 'josue'
 where id = 'be225a4c-d403-483b-9737-370eb4f22aaa';
update service_tiers set service_slug = 'turf-deep-clean', label = 'Medium yard (300-500 sq ft)', min_qty = 300, max_qty = 500, price_cents = 35000, updated_by = 'josue'
 where id = '0691e980-0241-446d-9dfd-b2758ad74a9f';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by) values
  ('turf-deep-clean', 'Large yard (500-800 sq ft)', 500, 800, 50000, '', false, false, 30, 240, 'josue'),
  ('turf-deep-clean', 'Over 800 sq ft', 800, null, null, '', true, false, 40, 300, 'josue');

-- ---- Yard Deep Clean: what it says it is, one price by quote
update service_tiers set label = 'Every yard is different', min_qty = null, max_qty = null, requires_quote = true, price_cents = null, sort_order = 10, updated_by = 'josue'
 where id = 'c92a7e68-477d-47b2-96b3-14afdf04818b';
update services set name = 'Yard Deep Clean', short_name = 'Yard Deep Clean', price_basis = 'flat', basis_label = 'Tell us about the yard',
  pricing_note = 'Every yard is different, so this one is a custom quote. Call or send the details and you get one price.',
  meta_title = 'Yard Deep Clean & Overgrowth Clean-Up in Ventura County | Scoop Dogg',
  meta_description = 'One-time yard clean-up for overgrowth, debris and built-up pet waste across Ventura County. Call or send the details for one custom price.',
  h1 = 'Yard Deep Clean in Ventura County',
  intro = 'A yard deep clean is a one-time reset for a yard that has gotten away from you: overgrown plants, weeds, piles of leaves and debris, and pet waste that has built up. It is different from weekly yard maintenance. We do the heavy lifting once, and if you want it kept that way, you can sign up for weekly maintenance separately. Every yard is different, so call or send the details and we will give you one simple price.',
  what_includes = array['Overgrown plants and weeds cut back','Leaves, debris and yard waste hauled off','Built-up pet waste cleaned up','The whole yard walked and left tidy'],
  who_its_for = 'Anyone with an overgrown yard, a rental between tenants, a new home, or a yard that needs a fresh start before weekly service.',
  faqs = '[{"q":"How much does a yard deep clean cost?","a":"It depends on the yard, so we give you a custom quote. Call, or send a few details and photos, and you get one simple price."},{"q":"Is this the same as weekly yard maintenance?","a":"No. A deep clean is a one-time job for a yard that needs a reset. Weekly yard maintenance is mowing, blowing and raking to keep it looking good, and you sign up for that separately."},{"q":"What about artificial turf?","a":"Artificial turf has its own one-time job, the Turf Deep Clean, priced by size."},{"q":"Can you take care of pet waste too?","a":"Yes. If there is poop or other waste built up, tell us and it goes in the quote."}]'::jsonb,
  related_slugs = '{weekly-yard-maintenance,turf-deep-clean,one-time-dog-poop-cleanup}', updated_by = 'josue'
 where slug = 'yard-deep-clean';

-- ---- Turf Deodorizing, the renamed weekly service
update service_tiers set label = 'Small yard (up to 300 sq ft)', min_qty = null, max_qty = 300, price_cents = 3500, price_suffix = '/week', updated_by = 'josue' where id = '271f9843-7cdb-4754-aa39-8cb6056956ef';
update service_tiers set label = 'Medium yard (300-500 sq ft)', min_qty = 300, max_qty = 500, price_cents = 5000, price_suffix = '/week', updated_by = 'josue' where id = '20382e00-fb8c-43f1-8cb9-7b526e06c9b1';
update service_tiers set label = 'Large yard (500-800 sq ft)', min_qty = 500, max_qty = 800, price_cents = 6000, price_suffix = '/week', requires_quote = false, updated_by = 'josue' where id = '2d643c45-8f00-493b-af41-fd2d79206259';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by) values
  ('weekly-turf-maintenance', 'Over 800 sq ft', 800, null, null, '', true, false, 40, 60, 'josue');
update packages set name = 'Turf deodorizing · Small yard', short_label = 'Small yard', monthly_price_cents = 14000, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $35 a week, four weeks', updated_by = 'josue' where slug = 'turf-weekly-small-area';
update packages set name = 'Turf deodorizing · Medium yard', short_label = 'Medium yard', monthly_price_cents = 20000, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $50 a week, four weeks', updated_by = 'josue' where slug = 'turf-weekly-medium-area';
insert into packages (slug, service_slug, tier_id, name, short_label, frequency, visits_per_month, monthly_price_cents, derivation, source, confirmed_by, confirmed_at, sort_order, status, updated_by)
select 'turf-weekly-large-area', service_slug, '2d643c45-8f00-493b-af41-fd2d79206259', 'Turf deodorizing · Large yard', 'Large yard', frequency, 4, 24000,
       'Josue, 2026-11-01: $60 a week, four weeks', 'confirmed', 'josue', now(), sort_order + 1, 'active', 'josue'
  from packages where slug = 'turf-weekly-medium-area';
update services set name = 'Turf Deodorizing', short_name = 'Turf Deodorizing',
  pricing_note = 'Weekly care priced by the size of your turf, billed monthly. Add weekly poop scooping when you book, same visit.',
  meta_title = 'Weekly Turf Deodorizing & Maintenance in Ventura County | Scoop Dogg',
  meta_description = 'Weekly artificial turf deodorizing and maintenance: debris cleared, leaves raked, turf sanitized and deodorized. Priced by the size of your turf.',
  h1 = 'Weekly Turf Deodorizing & Maintenance in Ventura County',
  intro = 'Artificial turf looks great until your dogs use it as a bathroom. Turf Deodorizing is our weekly turf maintenance visit: we clear debris, rake up leaves, sanitize the turf and treat it with an enzyme deodorizer that breaks down the odor at the source. It works on turf that has dogs on it and turf that just collects leaves, dust and pollen, and it keeps your yard looking and smelling like the day it was installed.',
  what_includes = array['Debris and pet hair cleared from the whole surface','Leaves raked and hauled off','Turf sanitized','Enzyme deodorizer on the areas your dog uses','Quick check for wear or drainage issues'],
  faqs = '[{"q":"Is the deodorizer safe for dogs?","a":"Yes. The enzymes are natural and non-toxic, and your dogs can use the yard right after."},{"q":"Is this the same as turf maintenance?","a":"Yes. Turf Deodorizing is our weekly turf maintenance service under its new name."},{"q":"Do I need a deep clean first?","a":"Only if the turf has never been professionally cleaned or the smell has set in. A one-time Turf Deep Clean resets it, then weekly visits keep it fresh."},{"q":"Can you scoop the poop on the same visit?","a":"Yes. Add weekly poop scooping when you book, and pick how many dogs you have."},{"q":"Is this just for pet owners?","a":"No. Turf collects leaves, pollen, dust and debris with or without pets."}]'::jsonb,
  related_slugs = '{turf-deep-clean,weekly-pooper-scooper-service,yard-deep-clean}', updated_by = 'josue'
 where slug = 'weekly-turf-maintenance';
update offers set name = 'Turf Deodorizing: first month half off with scooping' where applies_to_slugs = '{weekly-turf-maintenance}';

-- ---- the old one-time deodorizing is gone
update services set status = 'retired', updated_by = 'josue' where slug = 'artificial-turf-deodorizing';
update service_tiers set status = 'retired', updated_by = 'josue' where service_slug = 'artificial-turf-deodorizing';
update services set related_slugs = array_remove(array_replace(related_slugs, 'artificial-turf-deodorizing', 'weekly-turf-maintenance'), slug)
 where 'artificial-turf-deodorizing' = any(related_slugs);
update services set related_slugs = array_replace(related_slugs, 'yard-deep-clean', 'turf-deep-clean') where slug = 'one-time-dog-poop-cleanup';

-- ---- yard maintenance: one price
update service_tiers set label = 'Small or medium yard', price_cents = 6000, price_suffix = '/visit', price_is_from = false, updated_by = 'josue' where id = 'e0fca44e-edcd-4090-876d-0f831eff5092';
update service_tiers set status = 'retired', updated_by = 'josue' where id = '3c987fac-5de3-4767-b33f-dd48b3d95f33';
update packages set status = 'retired', updated_by = 'josue' where slug = 'yard-weekly-medium-yard';
update packages set name = 'Weekly yard maintenance', short_label = 'Small or medium yard', monthly_price_cents = 24000, visits_per_month = 4, featured = false,
  derivation = 'Josue, 2026-11-01: $60 a visit, four visits', updated_by = 'josue' where slug = 'yard-weekly-small-yard';
update services set pricing_note = 'One price for a small or medium yard. Need something special? Add extra work by the hour. Big hedges get a custom quote.',
  intro = 'Keep your yard looking good without thinking about it. Each week we mow, blow, clear debris and rake up leaves, the same day every week, and you pay one simple price for a small or medium yard. Need something special while we are there, like a little gardening? Add extra work by the hour. Big hedges and larger jobs are a different size of job, so call or send the details for a custom quote.',
  what_includes = array['Lawn mowing','Blowing walkways and patios clean','Debris removal','Leaves raked and hauled off'],
  meta_description = 'Weekly yard maintenance in Ventura County: mowing, blowing, debris removal and raking at one simple price for small and medium yards.',
  faqs = '[{"q":"What does weekly maintenance include?","a":"Mowing, blowing, debris removal and raking. Need something special? Add extra work by the hour when you book."},{"q":"Do you trim big hedges?","a":"Big hedges and bigger trimming jobs need a custom quote. Call or send the details and you get one price."},{"q":"Is this the same as a Yard Deep Clean?","a":"No. A Yard Deep Clean is a one-time reset for an overgrown yard, quoted to the job. Weekly maintenance is ongoing upkeep."},{"q":"Can you scoop the poop on the same visit?","a":"Yes. Add weekly poop scooping when you book, and pick how many dogs you have."}]'::jsonb,
  related_slugs = '{yard-deep-clean,weekly-pooper-scooper-service,extra-yard-work}', updated_by = 'josue'
 where slug = 'weekly-yard-maintenance';

-- ---- litter: twenty dollars a box
update packages set name = 'Weekly litter box service · 1 litter box', monthly_price_cents = 8000, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $20 a box, four visits', updated_by = 'josue' where slug = 'litter-weekly-1-litter-box';
update packages set monthly_price_cents = 16000, visits_per_month = 4, derivation = 'Josue, 2026-11-01: $20 a box, four visits', updated_by = 'josue' where slug = 'litter-weekly-2-litter-boxes';
update services set pricing_note = 'Priced per box, per visit, billed monthly.',
  what_includes = array['Used litter removed and bagged for disposal','Box cleaned and sanitized','Surrounding area cleaned','Flexible scheduling'],
  updated_by = 'josue' where slug = 'kitty-litter-exchange';
update services set pricing_note = 'Starting prices for one and two robots. Every cleaning includes careful technical maintenance.', updated_by = 'josue'
 where slug = 'kitty-litter-robot-cleaning';

-- ---- what moved, in the owner's own log
insert into catalog_changes (entity, entity_id, entity_label, field, old_value, new_value, changed_by)
select b.entity, b.id::uuid, b.label, 'price_cents', b.cents::text, a.cents::text, 'josue (his notes, 2026-11-01)'
  from _before b join (select 'tier' as entity, id::text as id, price_cents as cents from service_tiers
                       union all select 'package', id::text, monthly_price_cents from packages) a using (entity, id)
 where a.cents is distinct from b.cents;

commit;
