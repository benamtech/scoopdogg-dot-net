-- Scoop Dogg — the review request stops being immediate, because immediate is the one setting
-- the evidence says is worse than not asking at all.
--
-- WHAT THE CODE DOES TODAY. `sendReviewRequests()` runs in the sweep the admin board triggers on
-- read, and it sends the moment a customer's third visit is complete. There is no delay anywhere
-- in the path. Nobody chose that; it is what you get when the threshold is a visit count and
-- nothing else is specified.
--
-- WHAT THE EVIDENCE SAYS. Jung, Ryu, Han and Cho, "Ask for Reviews at the Right Time: Evidence
-- from Two Field Experiments", Journal of Marketing 2023 (10.1177/00222429221143329). Two
-- randomised field experiments, 300,000+ consumers, reminder timings of next-day, 5-day, 9-day
-- and 13-day against randomised controls at the matching times. The finding that matters here:
--
--   IMMEDIATE reminders REDUCED the chance of a review being posted, relative to an immediate
--   control group that got no reminder at all. Delayed reminders INCREASED it against a delayed
--   control. The authors attribute the first to reactance — the ask arrives as an instruction
--   before the person has decided on their own — and the second to memory recall outweighing it.
--   Timing had a negligible effect on rating, sentiment or length; it moves WHETHER, not WHAT.
--
-- So the current setting is not merely unoptimised. On the paper's evidence it is the one setting
-- that does worse than silence, and it is the last step of what R8 §B2 calls the single
-- highest-return growth item on this project.
--
-- WHAT THIS IS NOT. The experiments ran on product marketplaces, not on a recurring local
-- service, and a weekly customer's relationship is continuous in a way a one-off purchase is not
-- — so the size of the effect here is unknown and this migration does not claim one. What it
-- claims is narrower and solid: "immediately" was never a decision, it is the worst-supported
-- option available, and it is now a row with a number, a citation and somebody able to change it.
--
-- WHY 5. It is the shortest of the delays the paper tested that is not the next day, and for a
-- weekly customer it lands mid-week rather than beside the following visit. If Josue or Ben wants
-- 9, it is one row.
--
-- WHICH DATE THE CLOCK STARTS ON. The QUALIFYING visit — the third one — and not the most recent.
-- Starting it on the most recent completed visit would mean a weekly customer's clock resets
-- every seven days and the ask never arrives at all. That is the bug this row would have had.
-- `eligibleForReviewRequest()` reads the third completion by `row_number()`, so the ask goes out
-- five days after the visit that earned it and does not move again.

-- rehearse: select count(*) = 1 from settings where key = 'growth.review_request_delay_days'
-- rehearse: select (select value::int from settings where key = 'growth.review_request_delay_days') = 5
-- rehearse: select (select value::int from settings where key = 'growth.review_request_delay_days') between 0 and 30
-- rehearse: select (select value::int from settings where key = 'growth.review_request_after_visits') = 3

begin;

insert into settings (key, value, updated_by) values
  ('growth.review_request_delay_days', '5'::jsonb, 'migration:030')
on conflict (key) do nothing;

commit;
