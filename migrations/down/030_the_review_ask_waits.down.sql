-- Revert 030. The review request goes back to sending as soon as the third visit completes, which
-- is the behaviour Jung et al. (2023) measured as performing worse than sending nothing. The row
-- is removed rather than set to 0 so that its absence reads as "never decided" rather than as
-- "decided to be immediate" — server/lib/comms.ts falls back to 0 and says which it used.
begin;

delete from settings
 where key = 'growth.review_request_delay_days'
   and updated_by = 'migration:030';

delete from _migrations where name = '030_the_review_ask_waits.sql';
commit;
