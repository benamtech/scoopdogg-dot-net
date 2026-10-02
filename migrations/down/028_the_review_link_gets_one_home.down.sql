-- Revert 028. The review request goes back to having no link, so it does not send and says so.
-- The site keeps working: src/lib/catalog.ts still carries the code default for /reviews.
--
-- Only rows this migration wrote are removed. A URL Josue set himself in /admin/settings carries
-- a different updated_by and survives, which is the point of the predicate.
begin;

delete from settings
 where key in ('reviews.google_profile_url', 'reviews.google_review_url')
   and updated_by = 'migration:028';

delete from _migrations where name = '028_the_review_link_gets_one_home.sql';
commit;
