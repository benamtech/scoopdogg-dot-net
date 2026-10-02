-- Revert 027. A paused plan resumes at the weekly price again, which is what it did before
-- 2026-09-19 and is the behaviour Josue's rule describes as wrong. Reverting this does not
-- revert 026: booking keeps the rule.
begin;

alter table subscriptions drop constraint if exists subscriptions_resume_catch_up_needs_a_tier;
alter table subscriptions drop column if exists resume_catch_up_cents;
alter table subscriptions drop column if exists resume_catch_up_tier_id;

delete from _migrations where name = '027_a_pause_is_the_other_door.sql';
commit;
