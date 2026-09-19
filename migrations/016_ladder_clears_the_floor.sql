-- Scoop Dogg — the weekly ladder clears the $85/hour floor. Ben, 2026-09-18: "fix all that."
--
-- Migration 013 set $90/$110/$130/$150 and took the count of published prices under the floor from
-- 16 to 3. The three that survived were all weekly scooping, under by 48, 12 and 80 cents a visit,
-- and I left them there on the argument that est_minutes is an estimate and chasing 48 cents
-- across two estimates is false precision. Ben overruled it. The ladder moves to the figures the
-- floor actually implies, which is e8-unit-economics §3's own table:
--
--   dogs   est min   floor/visit   floor/month   ladder   $/hr at the ladder
--   1      15        $21.25        $92.08        $100     $92.31
--   2      18        $25.50        $110.50       $120     $92.31
--   3      21        $29.75        $128.92       $130     $85.71   (already clears; not moved)
--   4+     25        $35.42        $153.47       $160     $88.62
--
-- Round tens, because R7 §1 is unchanged: the monthly price is an affect-led purchase compared
-- against two or three local quotes, and a 9-ending carries a discount cue that fights a premium
-- position. Every derived number stays clean - half off is $50/$60/$65/$80, the annual at 11x is
-- $1,100/$1,320/$1,430/$1,760.
--
-- THE THREE-DOG TIER DOES NOT MOVE, so its version does not move and its Stripe Price is still
-- valid. Grandfathering is per package, and that is visible in the data after this: three rows at
-- v3 and one at v2.
--
-- NOBODY IS REPRICED. stripe_prices is keyed on packages.version and the Price lookup key is
-- <slug>_v<version>, so the next checkout mints a new Price while every existing subscription
-- keeps the one it was sold on. There are none. Josue's existing cash and Venmo customers come
-- across at the price HE types (P18 §3), not at this ladder.
--
-- The last two checks below are the floor itself, asserted in SQL across every priced row rather
-- than reported by an experiment nobody runs. gates/price-clears-the-floor.mjs keeps them true.

-- rehearse: select count(*) = 0 from packages where monthly_price_cents % 1000 <> 0
-- rehearse: select (select monthly_price_cents from packages where slug = 'scoop-weekly-1-dog') = 10000
-- rehearse: select (select monthly_price_cents from packages where slug = 'scoop-weekly-2-dogs') = 12000
-- rehearse: select (select monthly_price_cents from packages where slug = 'scoop-weekly-4-plus-dogs') = 16000
-- rehearse: select (select version from packages where slug = 'scoop-weekly-1-dog') = 3
-- rehearse: select (select version from packages where slug = 'scoop-weekly-3-dogs') = 2
-- rehearse: select count(*) = 0 from packages where source <> 'confirmed' or confirmed_at is null
-- rehearse: select count(*) = 0 from packages p join service_tiers t on t.id = p.tier_id where t.est_minutes is not null and round(p.monthly_price_cents / (52.0/12)) / (t.est_minutes / 60.0) < 8500
-- rehearse: select count(*) = 0 from service_tiers t where t.price_cents is not null and t.est_minutes is not null and not exists (select 1 from packages p where p.tier_id = t.id) and t.price_cents / (t.est_minutes / 60.0) < 8500

begin;

-- The monthly price is the primary number. packages_bump_version (011) raises the version because
-- monthly_price_cents changed; this statement does not write it.
update packages set monthly_price_cents = v.cents,
       derivation = 'floor:$85/hr on-site at est_minutes, rounded up to $10',
       source = 'confirmed', confirmed_by = 'claude:cmo 2026-09-18 (ben: fix all that)',
       confirmed_at = now(), updated_at = now()
  from (values ('scoop-weekly-1-dog', 10000), ('scoop-weekly-2-dogs', 12000),
               ('scoop-weekly-4-plus-dogs', 16000)) as v(slug, cents)
 where packages.slug = v.slug;

-- The per-visit tier keeps being the rounded equivalent of the monthly, so "about $23 a visit"
-- beside "$100 a month" is arithmetic a customer can check rather than a second price.
update service_tiers set price_cents = v.cents, updated_at = now() from (values
  ('1 dog', 2300), ('2 dogs', 2800), ('4+ dogs', 3700)
) as v(label, cents)
 where service_tiers.service_slug = 'weekly-pooper-scooper-service' and service_tiers.label = v.label;

commit;
