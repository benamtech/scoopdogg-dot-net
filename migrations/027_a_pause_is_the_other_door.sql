-- Scoop Dogg — Josue's catch-up rule had one door, and the account screen was the other one.
--
-- Migration 026 made the rule real at BOOKING: a yard more than a couple of weeks behind pays
-- for the reset before the weekly price starts. This is the same rule on the path nobody
-- looked at.
--
-- A signed-in customer can pause the plan for up to twelve weeks, and "Pause 4 weeks instead"
-- is the offer the cancel dialog makes to save them. Four weeks is squarely inside Josue's own
-- "Heavy buildup (3-6 weeks)" band. Until today the plan resumed at the weekly price and the
-- first visit back was the hardest visit of the year, unpaid — the exact outcome he described,
-- reached through a button AMTECH built and put in front of the customer.
--
-- TWO COLUMNS, FROZEN AT PAUSE TIME, for the same reason `price_cents` is frozen at signup:
-- what the customer was told when they chose the pause is what they owe when they come back.
-- Re-reading the tier on resume would let a price edit in the admin change a promise that was
-- already made to somebody.
--
--   resume_catch_up_tier_id   which of Josue's catch-up tiers the return visit is
--   resume_catch_up_cents     what it costs. NULL with a tier set means the band is his
--                             "Severe (6+ weeks)" one, which his catalog says needs a quote —
--                             the same convention as subscriptions.price_cents.
--
-- Both NULL is the normal case: a pause of two weeks or less owes nothing, because two weeks is
-- a couple of weeks. The policy is the same row that governs booking,
-- `settings.booking.initial_cleanup_policy`, so turning the rule off turns BOTH doors off and
-- there is no second switch to forget.

-- rehearse: select count(*) = 2 from information_schema.columns where table_name = 'subscriptions' and column_name in ('resume_catch_up_tier_id','resume_catch_up_cents')
-- rehearse: select count(*) = 0 from subscriptions where resume_catch_up_tier_id is null and resume_catch_up_cents is not null
-- rehearse: select count(*) = 0 from subscriptions where resume_catch_up_tier_id is not null and state <> 'paused'

begin;

alter table subscriptions add column resume_catch_up_tier_id uuid references service_tiers(id);
alter table subscriptions add column resume_catch_up_cents   integer;

comment on column subscriptions.resume_catch_up_tier_id is
  'The catch-up tier this plan owes on its first visit back, decided and frozen when the '
  'customer chose the pause length. NULL means the pause is inside the weekly cadence and '
  'nothing is owed. Cleared on resume.';
comment on column subscriptions.resume_catch_up_cents is
  'What that tier cost on the day the customer was shown it. NULL with a tier set means Josue '
  'prices the first visit himself - his Severe band takes no card.';

-- A row cannot claim a price without naming the tier it came from.
alter table subscriptions add constraint subscriptions_resume_catch_up_needs_a_tier
  check (resume_catch_up_cents is null or resume_catch_up_tier_id is not null);

commit;
