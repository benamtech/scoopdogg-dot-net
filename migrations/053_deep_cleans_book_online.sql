-- Scoop Dogg — clear prices that can be scheduled and paid online are what has been proven to sell
-- (Ben, 2026-11-02); the one live online sale was a $179 deep clean. 049 wrongly sent both deep cleans
-- to a quote. They are fixed prices again. Only the size past the price list is a quote, and the
-- Custom Yard & Property Jobs card is the only page-level quote.
--   Yard Deep Clean  $179 up to 300 sq ft, $350 to 500, $500 to 800 (his note).
--   Turf Deep Clean  starts at $300 (his note), so $300, $350, $500 on the same sizes.

-- rehearse: select count(*) = 3 from service_tiers where service_slug = 'yard-deep-clean' and status = 'active' and price_cents is not null and not price_is_from
-- rehearse: select count(*) = 3 from service_tiers where service_slug = 'turf-deep-clean' and status = 'active' and price_cents is not null and not price_is_from

begin;
update service_tiers set price_is_from = false, updated_by = 'josue' where service_slug = 'yard-deep-clean' and status = 'active';

update service_tiers set status = 'retired', updated_by = 'josue' where service_slug = 'turf-deep-clean';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by) values
  ('turf-deep-clean', 'Small yard (up to 300 sq ft)', null, 300, 30000, '', false, false, 10, 120, 'josue'),
  ('turf-deep-clean', 'Medium yard (300-500 sq ft)', 300, 500, 35000, '', false, false, 20, 180, 'josue'),
  ('turf-deep-clean', 'Large yard (500-800 sq ft)', 500, 800, 50000, '', false, false, 30, 240, 'josue'),
  ('turf-deep-clean', 'Over 800 sq ft', 800, null, null, '', true, false, 40, 300, 'josue');
update services set price_basis = 'sqft', basis_label = 'Roughly how big is your turf?',
  pricing_note = 'One price by the size of your turf. Pick your day and pay online. For weekly care after, sign up for Turf Deodorizing.',
  meta_description = 'One-time artificial turf deep clean: brush, vacuum, pressure wash and heavy deodorizer. One clear price by size. Book your day and pay online.',
  updated_by = 'josue' where slug = 'turf-deep-clean';

update services set
  pricing_note = 'One price by the size of your yard. Pick your day and pay online.',
  meta_description = 'One-time yard clean-up for overgrowth, debris and built-up pet waste across Ventura County. One clear price by yard size. Book your day and pay online.',
  intro = 'A yard deep clean is a one-time reset for a yard that has gotten away from you: overgrown plants, weeds, piles of leaves and debris, and pet waste that has built up. It is different from weekly yard maintenance. We do the heavy lifting once, and if you want it kept that way, you can sign up for weekly maintenance separately. Pick your yard size, see one simple price, and choose your day.',
  faqs = '[{"q":"How much does a yard deep clean cost?","a":"One price by the size of your yard, shown above. Pick your size, choose a day and pay online. Yards over 800 sq ft get a custom quote."},{"q":"Is this the same as weekly yard maintenance?","a":"No. A deep clean is a one-time job for a yard that needs a reset. Weekly yard maintenance is mowing, blowing and raking to keep it looking good, and you sign up for that separately."},{"q":"What about artificial turf?","a":"Artificial turf has its own one-time job, the Turf Deep Clean."},{"q":"Can you take care of pet waste too?","a":"Yes. Built-up pet waste is part of the job."}]'::jsonb,
  updated_by = 'josue' where slug = 'yard-deep-clean';
commit;
