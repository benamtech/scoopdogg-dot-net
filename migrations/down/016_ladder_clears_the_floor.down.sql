-- Revert 016: back to 013's ladder, which leaves three weekly scooping tiers under the floor.
-- Versions are bumped AGAIN by the packages_version trigger rather than decremented, so a Stripe
-- Price already created under v3 is never silently reused with a different amount.
begin;

update packages set monthly_price_cents = v.cents,
       derivation = 'floor:$85/hr on-site at est_minutes, rounded to $10',
       source = 'confirmed', confirmed_by = 'claude:cmo 2026-09-18', confirmed_at = now(), updated_at = now()
  from (values ('scoop-weekly-1-dog', 9000), ('scoop-weekly-2-dogs', 11000),
               ('scoop-weekly-4-plus-dogs', 15000)) as v(slug, cents)
 where packages.slug = v.slug;

update service_tiers set price_cents = v.cents, updated_at = now() from (values
  ('1 dog', 2100), ('2 dogs', 2500), ('4+ dogs', 3500)
) as v(label, cents)
 where service_tiers.service_slug = 'weekly-pooper-scooper-service' and service_tiers.label = v.label;

delete from _migrations where name = '016_ladder_clears_the_floor.sql';

commit;
