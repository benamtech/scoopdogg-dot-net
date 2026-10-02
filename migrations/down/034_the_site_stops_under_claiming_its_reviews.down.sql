-- Revert 034. The rows are removed rather than set back to 18, because 18 was never a claim
-- anybody made — it was the length of a curated quote list leaking into a sentence about Google.
-- With the rows gone, `reviewSummary.label` falls back to "18 reviews on this page", which is
-- true, and the site under-claims by 24 reviews again until somebody runs
-- `node scripts/pull-review-count.mjs --apply`.
begin;

delete from settings
 where key in ('reviews.google_count', 'reviews.google_rating', 'reviews.google_checked_on')
   and updated_by in ('migration:034', 'script:pull-review-count');

delete from _migrations where name = '034_the_site_stops_under_claiming_its_reviews.sql';
commit;
