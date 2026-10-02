-- Scoop Dogg — the price ladder, set from an $85/hour on-site floor (P14 §A1, e8-unit-economics).
--
-- Ben, 2026-09-18, put client pricing under AMTECH's seat and gave the shape of a day: 2 hours a
-- yard, 3-4 yards a day. Priced against a floor of $85 an hour on site, 16 of 25 published prices
-- were under water — worst was Yard Deep Clean at $49.50/hr, which is exactly the 2-hour job.
--
-- Monthly is now the primary price and the per-visit figure is the derived comparison, so the
-- monthly numbers are round tens and the weekly tiers are set to their rounded per-visit
-- equivalent ($90/mo -> about $21 a visit at 52/12).
--
-- GRANDFATHERING IS STRUCTURAL: stripe_prices is keyed on packages.version and the Price lookup
-- key is <slug>_v<version>, so bumping version makes the next checkout create a new Stripe Price
-- while every existing subscription keeps the one it was sold on. Nobody already paying moves.
--
-- rehearse: select count(*) = 0 from packages where monthly_price_cents % 1000 <> 0
-- rehearse: select (select monthly_price_cents from packages where slug = 'scoop-weekly-1-dog') = 9000
-- rehearse: select (select version from packages where slug = 'scoop-weekly-1-dog') = 2
-- rehearse: select count(*) = 1 from packages where badge is not null
-- rehearse: select count(*) = 0 from service_tiers where est_minutes is null and price_cents is not null
-- rehearse: select count(*) = 0 from packages where confirmed_at is null
-- rehearse: select count(*) = 0 from packages where source <> 'confirmed'
-- rehearse: select count(*) = 10 from packages where version = 2

begin;

-- 1. Minutes on site, per tier. The estimate every price now rests on, in the data rather than in
--    a script, so `visits.completed_at` can replace it with a measurement later.
alter table service_tiers add column if not exists est_minutes integer;
comment on column service_tiers.est_minutes is
  'Estimated on-site minutes. ESTIMATE by claude:cmo 2026-09-18; replace with the median of real visit durations.';

update service_tiers set est_minutes = v.min from (values
  ('1 dog', 'weekly-pooper-scooper-service', 15), ('2 dogs', 'weekly-pooper-scooper-service', 18),
  ('3 dogs', 'weekly-pooper-scooper-service', 21), ('4+ dogs', 'weekly-pooper-scooper-service', 25),
  ('Standard yard (up to 2 weeks buildup)', 'one-time-dog-poop-cleanup', 45),
  ('Heavy buildup (3-6 weeks)', 'one-time-dog-poop-cleanup', 90),
  ('Severe (6+ weeks or multiple dogs)', 'one-time-dog-poop-cleanup', 150),
  ('Small area (under 200 sq ft)', 'artificial-turf-deodorizing', 20),
  ('Medium area (200-500 sq ft)', 'artificial-turf-deodorizing', 30),
  ('Large area (500+ sq ft)', 'artificial-turf-deodorizing', 45),
  ('Standard turf area (under 500 sq ft)', 'yard-deep-clean', 120),
  ('Large turf area (500-1000 sq ft)', 'yard-deep-clean', 180),
  ('Extra large (1000+ sq ft)', 'yard-deep-clean', 240),
  ('Small area (under 300 sq ft)', 'weekly-turf-maintenance', 20),
  ('Medium area (300-600 sq ft)', 'weekly-turf-maintenance', 30),
  ('Large area (600+ sq ft)', 'weekly-turf-maintenance', 45),
  ('Small yard (basic mow & edge)', 'weekly-yard-maintenance', 45),
  ('Medium yard (mow, edge, trim)', 'weekly-yard-maintenance', 75),
  ('Large or custom property', 'weekly-yard-maintenance', 120),
  ('1 litter box', 'kitty-litter-exchange', 10), ('2 litter boxes', 'kitty-litter-exchange', 15),
  ('3+ litter boxes', 'kitty-litter-exchange', 25),
  ('Small run (under 100 sq ft)', 'dog-run-cleanups', 30), ('Medium run (100-300 sq ft)', 'dog-run-cleanups', 60),
  ('Large or custom area', 'dog-run-cleanups', 90),
  ('Small tree (1-2 levels)', 'cat-tree-cleaning', 20), ('Large tree (3+ levels)', 'cat-tree-cleaning', 35),
  ('Multiple trees', 'cat-tree-cleaning', 60),
  ('Small patio or run (under 200 sq ft)', 'pressure-washing', 45),
  ('Medium area (200-500 sq ft)', 'pressure-washing', 75), ('Large area (500+ sq ft)', 'pressure-washing', 120),
  ('1 Litter-Robot', 'kitty-litter-robot-cleaning', 30), ('2 Litter-Robots', 'kitty-litter-robot-cleaning', 50),
  ('3+ Litter-Robots', 'kitty-litter-robot-cleaning', 75)
) as v(label, service_slug, min)
 where service_tiers.label = v.label and service_tiers.service_slug = v.service_slug;

-- 2. A badge is a CLAIM and must be true. "Most booked" sat on the 2-dog card while 58% of real
--    leads are one dog and nothing has been booked on the new system at all.
alter table packages add column if not exists badge text;
comment on column packages.badge is
  'A claim shown on the plan card. Must be supported by counts (bookings, else leads). Null for none.';
update packages set badge = null;
update packages set badge = 'Most requested' where slug = 'scoop-weekly-1-dog';

-- 3. The weekly ladder: round tens, priced off the floor.
--    THE VERSION BUMP IS NOT WRITTEN HERE. `packages_version`, the before-update trigger from
--    011, raises version whenever monthly_price_cents changes, and it overwrites anything this
--    statement sets. Writing `version = version + 1` here as well reads like a second bump and
--    is dead text - one writer, and it is the trigger.
update packages set monthly_price_cents = v.cents,
       derivation = 'floor:$85/hr on-site at est_minutes, rounded to $10', source = 'confirmed',
       confirmed_by = 'claude:cmo 2026-09-18', confirmed_at = now(), updated_at = now()
  from (values ('scoop-weekly-1-dog', 9000), ('scoop-weekly-2-dogs', 11000),
               ('scoop-weekly-3-dogs', 13000), ('scoop-weekly-4-plus-dogs', 15000)) as v(slug, cents)
 where packages.slug = v.slug;

-- The weekly tiers become the rounded per-visit equivalent of the monthly price.
update service_tiers set price_cents = v.cents from (values
  ('1 dog', 2100), ('2 dogs', 2500), ('3 dogs', 3000), ('4+ dogs', 3500)
) as v(label, cents)
 where service_tiers.service_slug = 'weekly-pooper-scooper-service' and service_tiers.label = v.label;

-- 4. Everything else that sat under the floor.
update service_tiers set price_cents = v.cents from (values
  ('yard-deep-clean', 'Standard turf area (under 500 sq ft)', 17900),
  ('yard-deep-clean', 'Large turf area (500-1000 sq ft)', 26900),
  ('weekly-yard-maintenance', 'Small yard (basic mow & edge)', 7000),
  ('weekly-yard-maintenance', 'Medium yard (mow, edge, trim)', 11000),
  ('artificial-turf-deodorizing', 'Small area (under 200 sq ft)', 3000),
  ('artificial-turf-deodorizing', 'Medium area (200-500 sq ft)', 4500),
  ('artificial-turf-deodorizing', 'Large area (500+ sq ft)', 7000),
  ('dog-run-cleanups', 'Medium run (100-300 sq ft)', 8900),
  ('cat-tree-cleaning', 'Small tree (1-2 levels)', 3000),
  ('cat-tree-cleaning', 'Large tree (3+ levels)', 5000),
  ('pressure-washing', 'Small patio or run (under 200 sq ft)', 6900),
  ('pressure-washing', 'Medium area (200-500 sq ft)', 10900),
  -- Litter tiers follow their new monthly price so "about $X a visit" matches the tier exactly.
  ('kitty-litter-exchange', '1 litter box', 1600),
  ('kitty-litter-exchange', '2 litter boxes', 2300)
) as v(service_slug, label, cents)
 where service_tiers.service_slug = v.service_slug and service_tiers.label = v.label;

-- The two recurring services whose per-visit price moved keep monthly = per-visit x 52/12, rounded
-- to $10. The same trigger bumps their version, so their Stripe Price is reissued.
update packages set monthly_price_cents = v.cents,
       derivation = 'floor:$85/hr on-site at est_minutes, rounded to $10', source = 'confirmed',
       confirmed_by = 'claude:cmo 2026-09-18', confirmed_at = now(), updated_at = now()
  from (values ('turf-weekly-small-area', 15000), ('turf-weekly-medium-area', 22000),
               ('yard-weekly-small-yard', 30000), ('yard-weekly-medium-yard', 48000),
               ('litter-weekly-1-litter-box', 7000), ('litter-weekly-2-litter-boxes', 10000)) as v(slug, cents)
 where packages.slug = v.slug;

-- 5. The prices are now set on purpose rather than derived from a weekly number nobody chose.
insert into settings (key, value, updated_by) values
  ('billing.package_prices_confirmed', 'true'::jsonb, 'claude:cmo 2026-09-18'),
  ('pricing.target_hourly_cents', '8500'::jsonb, 'claude:cmo 2026-09-18')
on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

commit;
