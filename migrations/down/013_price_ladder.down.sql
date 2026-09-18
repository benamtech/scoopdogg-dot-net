-- Revert 013: back to the pre-floor prices. Versions are bumped AGAIN rather than decremented, so
-- a Stripe Price that was already created under v2 is never silently reused with a different
-- amount (lookup keys are <slug>_v<version> and Prices are immutable).
begin;

update packages set monthly_price_cents = v.cents, version = version + 1,
       derivation = 'weekly x 52/12', source = 'revert-013', confirmed_by = null, confirmed_at = null, updated_at = now()
  from (values ('scoop-weekly-1-dog', 6500), ('scoop-weekly-2-dogs', 8700),
               ('scoop-weekly-3-dogs', 10000), ('scoop-weekly-4-plus-dogs', 10800),
               ('turf-weekly-small-area', 15200), ('turf-weekly-medium-area', 21700),
               ('yard-weekly-small-yard', 17300), ('yard-weekly-medium-yard', 28200),
               ('litter-weekly-1-litter-box', 6500), ('litter-weekly-2-litter-boxes', 9500)) as v(slug, cents)
 where packages.slug = v.slug;

update service_tiers set price_cents = v.cents from (values
  ('weekly-pooper-scooper-service', '1 dog', 1500), ('weekly-pooper-scooper-service', '2 dogs', 2000),
  ('weekly-pooper-scooper-service', '3 dogs', 2300), ('weekly-pooper-scooper-service', '4+ dogs', 2500),
  ('yard-deep-clean', 'Standard turf area (under 500 sq ft)', 9900),
  ('yard-deep-clean', 'Large turf area (500-1000 sq ft)', 14900),
  ('weekly-yard-maintenance', 'Small yard (basic mow & edge)', 4000),
  ('weekly-yard-maintenance', 'Medium yard (mow, edge, trim)', 6500),
  ('artificial-turf-deodorizing', 'Small area (under 200 sq ft)', 2000),
  ('artificial-turf-deodorizing', 'Medium area (200-500 sq ft)', 3500),
  ('artificial-turf-deodorizing', 'Large area (500+ sq ft)', 5000),
  ('dog-run-cleanups', 'Medium run (100-300 sq ft)', 7900),
  ('cat-tree-cleaning', 'Small tree (1-2 levels)', 2500),
  ('cat-tree-cleaning', 'Large tree (3+ levels)', 4500),
  ('pressure-washing', 'Small patio or run (under 200 sq ft)', 5900),
  ('pressure-washing', 'Medium area (200-500 sq ft)', 9900),
  ('kitty-litter-exchange', '1 litter box', 1500),
  ('kitty-litter-exchange', '2 litter boxes', 2200)
) as v(service_slug, label, cents)
 where service_tiers.service_slug = v.service_slug and service_tiers.label = v.label;

update packages set badge = null;
update settings set value = 'false'::jsonb, updated_by = 'revert-013' where key = 'billing.package_prices_confirmed';
delete from settings where key = 'pricing.target_hourly_cents';
alter table packages drop column if exists badge;
alter table service_tiers drop column if exists est_minutes;
delete from _migrations where name = '013_price_ladder.sql';

commit;
