-- Scoop Dogg — the last three answers from the owner (2026-11-01).
--   Pressure washing  50 cents a square foot against the three sizes: up to 300 $150, 300-500 $250,
--                     500-800 $400. Over 800 is a quote.
--   Yard Sanitizing   "add on to weekly poop scoop service": it goes on the weekly plan, every visit,
--                     at $25/$35/$45 a week. A plan line of its own, never sold alone.
--   The guarantee     his to word, and he left it to us. Now a confirmed row, not the default.

-- rehearse: select price_cents = 40000 and not requires_quote from service_tiers where id::text like 'db60c61f%'
-- rehearse: select count(*) = 3 from packages where service_slug = 'yard-sanitizing' and status = 'active'
-- rehearse: select count(*) = 1 from settings where key = 'trust.guarantee_text'

begin;

create temp table _before on commit drop as
  select 'tier' as entity, id, label, price_cents as cents from service_tiers;

-- ---- pressure washing
update service_tiers set label = 'Small area (up to 300 sq ft)', min_qty = null, max_qty = 300, price_cents = 15000, updated_by = 'josue' where id::text like '18d466d5%';
update service_tiers set label = 'Medium area (300-500 sq ft)', min_qty = 300, max_qty = 500, price_cents = 25000, updated_by = 'josue' where id::text like '904dfec9%';
update service_tiers set label = 'Large area (500-800 sq ft)', min_qty = 500, max_qty = 800, price_cents = 40000, requires_quote = false, updated_by = 'josue' where id::text like 'db60c61f%';
insert into service_tiers (service_slug, label, min_qty, max_qty, price_cents, price_suffix, requires_quote, price_is_from, sort_order, est_minutes, updated_by)
values ('pressure-washing', 'Over 800 sq ft', 800, null, null, '', true, false, 40, 180, 'josue');
update services set pricing_note = '50 cents a square foot. Solid waste removal is included before washing. Enzyme deodorizing available as an add-on.', updated_by = 'josue'
 where slug = 'pressure-washing';

-- ---- sanitizing goes on the weekly plan
update service_tiers set price_suffix = '/week', updated_by = 'josue' where service_slug = 'yard-sanitizing' and not requires_quote;
insert into packages (slug, service_slug, tier_id, name, short_label, frequency, visits_per_month, monthly_price_cents, derivation, source, confirmed_by, confirmed_at, sort_order, status, updated_by)
select v.slug, 'yard-sanitizing', t.id, v.name, v.short, 'weekly', 4, v.cents,
       'Josue, 2026-11-01: an add-on to the weekly service, four weeks', 'confirmed', 'josue', now(), v.sort, 'active', 'josue'
  from (values ('sanitize-weekly-small-yard', 'Small yard (up to 300 sq ft)', 'Weekly yard sanitizing · Small yard', 'Small yard', 10000, 200),
               ('sanitize-weekly-medium-yard', 'Medium yard (300-500 sq ft)', 'Weekly yard sanitizing · Medium yard', 'Medium yard', 14000, 201),
               ('sanitize-weekly-large-yard', 'Large yard (500-800 sq ft)', 'Weekly yard sanitizing · Large yard', 'Large yard', 18000, 202)) v(slug, tier, name, short, cents, sort)
  join service_tiers t on t.service_slug = 'yard-sanitizing' and t.label = v.tier;
update services set
  pricing_note = 'An add-on to weekly poop scooping, priced by the size of your yard. Done every visit, billed with your plan.',
  intro = 'Scooping takes away what you can see. Sanitizing takes care of what you cannot. We treat the areas your dog uses most with a pet-safe sanitizer that breaks down odor and germs, so the yard smells as clean as it looks. It is an add-on to weekly poop scooping: pick your dogs, pick your yard size, and we do it on every visit. Change your mind later and it comes off your plan.',
  what_includes = array['Pet-safe sanitizer on the areas your dog uses most','Odor and germs treated at the source','Done every week on the same visit as your scooping','Works on turf, grass, gravel and concrete'],
  updated_by = 'josue' where slug = 'yard-sanitizing';

-- ---- the guarantee
insert into settings (key, value) values ('trust.guarantee_text', to_jsonb('Happy-yard guarantee: if we miss a spot or you are not happy with a visit, tell us within 24 hours and we come back and make it right, free.'::text))
on conflict (key) do update set value = excluded.value;

insert into catalog_changes (entity, entity_id, entity_label, field, old_value, new_value, changed_by)
select b.entity, b.id, b.label, 'price_cents', b.cents::text, t.price_cents::text, 'josue (2026-11-01)'
  from _before b join service_tiers t on t.id = b.id where t.price_cents is distinct from b.cents;

commit;
