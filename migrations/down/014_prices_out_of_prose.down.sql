-- Revert 014: put every original string back, exactly as it was read from the database on
-- 2026-09-19. Generated with the up migration by
-- scripts/build-prose-price-migration.mjs.

begin;

update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing confirmed based on yard size and number of dogs.$txt$::text)), updated_at = now()
 where slug = 'agoura-hills';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing is based on yard size and number of dogs.$txt$::text)), updated_at = now()
 where slug = 'camarillo';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Final pricing depends on yard size and dogs.$txt$::text)), updated_at = now()
 where slug = 'carpinteria';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. We confirm pricing based on your yard and dog count.$txt$::text)), updated_at = now()
 where slug = 'fillmore';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Final pricing confirmed based on your yard and dogs.$txt$::text)), updated_at = now()
 where slug = 'malibu';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Final pricing based on yard size and dogs.$txt$::text)), updated_at = now()
 where slug = 'moorpark';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing confirmed based on yard size and dogs.$txt$::text)), updated_at = now()
 where slug = 'newbury-park';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. We confirm exact pricing based on yard size and dog count.$txt$::text)), updated_at = now()
 where slug = 'oak-view';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing is confirmed based on your yard size and number of dogs.$txt$::text)), updated_at = now()
 where slug = 'ojai';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Final pricing depends on yard size and dog count.$txt$::text)), updated_at = now()
 where slug = 'oxnard';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing confirmed after booking based on yard and dogs.$txt$::text)), updated_at = now()
 where slug = 'santa-barbara';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. We confirm final pricing based on your yard and dog count.$txt$::text)), updated_at = now()
 where slug = 'santa-paula';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing confirmed based on yard size and dog count.$txt$::text)), updated_at = now()
 where slug = 'simi-valley';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. We confirm pricing based on yard size and number of dogs.$txt$::text)), updated_at = now()
 where slug = 'thousand-oaks';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly yard cleanup is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. We confirm all pricing before your first visit.$txt$::text)), updated_at = now()
 where slug = 'ventura';
update service_areas set faqs = jsonb_set(faqs, '{0,a}', to_jsonb($txt$Weekly service is $15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4 or more dogs. A Turf Deep Clean is a flat $99. Turf Rescue deodorizing starts at $20. Pricing confirmed based on yard size and dogs.$txt$::text)), updated_at = now()
 where slug = 'westlake-village';
update services set meta_description = $txt$Enzyme-based turf deodorizing that eliminates pet urine odor from artificial grass, gravel, and concrete. Pet-safe, 100% natural. Starting at $20. Ventura County.$txt$, updated_at = now() where slug = 'artificial-turf-deodorizing';
update services set meta_description = $txt$Full yard poop cleanup for overgrown or neglected yards. Perfect for moving, hosting, or getting back to zero. Starting at $99. Serving Ventura County.$txt$, updated_at = now() where slug = 'one-time-dog-poop-cleanup';
update services set meta_description = $txt$Scheduled weekly dog poop cleaning starting at $15/visit. We scoop, bag, and haul off all waste. Cancel anytime. Serving 15 cities in Ventura County.$txt$, updated_at = now() where slug = 'weekly-pooper-scooper-service';
update services set intro = $txt$Our most popular service. We show up on the same day every week, walk your entire yard, scoop every pile, bag it, and haul it off your property. You never need to be home. Skip a week, pause for vacation, or cancel anytime. Most customers start at $15/week for one dog and never look back.$txt$, updated_at = now() where slug = 'weekly-pooper-scooper-service';
update services set meta_description = $txt$Ongoing artificial turf sweeping and deodorizing in Ventura County. We use the SwipeSmith turf sweeper for leaf, debris, and pet hair removal plus enzyme treatment. Starting at $35/visit.$txt$, updated_at = now() where slug = 'weekly-turf-maintenance';
update services set meta_description = $txt$Full turf and yard deep clean: brush, vacuum, pressure wash, and heavy deodorizer. Ideal for seasonal resets and new homeowners. Starting at $99. Ventura County.$txt$, updated_at = now() where slug = 'yard-deep-clean';

delete from _migrations where name = '014_prices_out_of_prose.sql';

commit;
