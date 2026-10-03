-- Scoop Dogg — a yard that has not been done in weeks costs more, because the weekly price
-- assumes a weekly yard.
--
-- Josue, 2026-09-19, relayed by Ben: "when yard has not been cleaned longer than a couple weeks
-- it would increase price because the default price is based on having a weekly clean."
--
-- That is a pricing rule and the funnel currently does not keep it. It ASKS the right question
-- — "When was the yard last cleaned?" with four answers — and then offers the catch-up clean as
-- a free choice with a "No thanks, just weekly" button next to it. So today a customer whose
-- yard has six weeks of buildup can decline the catch-up and start a weekly plan at the weekly
-- price, which is the exact outcome Josue is describing as wrong. Every one of those is
-- unpriced work on the hardest first visit he does.
--
-- NO NUMBER IS INVENTED HERE. Josue already publishes a catch-up ladder — the
-- `one-time-dog-poop-cleanup` tiers — and its bands are the same bands the funnel's question
-- uses. The rule is implemented by joining two things he has already said:
--
--   answer        the customer picks        Josue's own tier                     price
--   this_week     "This week"               none - within the weekly cadence     -
--   two_weeks     "1-2 weeks ago"           none - "a couple weeks" is not over  -
--   month         "3-6 weeks ago"           Heavy buildup (3-6 weeks)            $149
--   longer        "Longer than that"        Severe (6+ weeks or multiple dogs)   quote
--
-- `two_weeks` is deliberately NOT charged: he said "longer than a couple weeks", and two weeks
-- is a couple of weeks. Reading his sentence more aggressively than he wrote it would be
-- inventing a policy and charging real customers for it.
--
-- WHY A COLUMN AND NOT A MATCH ON THE LABEL. The mapping has to be a fact, not a heuristic.
-- These tiers have no min_qty or max_qty — `price_basis` is 'choice' — so the only things to
-- match on are the label text or the sort order, and both break silently the first time
-- somebody edits a tier in the admin. `covers_last_cleaned` makes the mapping a row Josue can
-- see and change, and `gates/catch-up-priced.mjs` fails the build if an answer stops having a
-- tier to point at.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'service_tiers' and column_name = 'covers_last_cleaned'
-- rehearse: select count(*) = 3 from service_tiers where covers_last_cleaned is not null
-- rehearse: select covers_last_cleaned = '{month}' from service_tiers where label like 'Heavy buildup%'
-- rehearse: select covers_last_cleaned = '{longer}' from service_tiers where label like 'Severe%'
-- rehearse: select value::text = '"required_beyond_two_weeks"' from settings where key = 'booking.initial_cleanup_policy'
-- rehearse: select count(*) = 0 from service_tiers where covers_last_cleaned && '{month,longer}' and price_cents is null and not requires_quote

begin;

alter table service_tiers add column covers_last_cleaned text[];

comment on column service_tiers.covers_last_cleaned is
  'Which answers to "When was the yard last cleaned?" this catch-up tier covers. The funnel '
  'reads it to price a first visit on a yard that is behind: the weekly price assumes a weekly '
  'yard (Josue, 2026-09-19). NULL on every tier that is not a catch-up. An answer with no tier '
  'and a tier with no answer are both build failures - gates/catch-up-priced.mjs.';

update service_tiers set covers_last_cleaned = '{this_week,two_weeks}'
 where service_slug = 'one-time-dog-poop-cleanup' and label like 'Standard yard%';
update service_tiers set covers_last_cleaned = '{month}'
 where service_slug = 'one-time-dog-poop-cleanup' and label like 'Heavy buildup%';
update service_tiers set covers_last_cleaned = '{longer}'
 where service_slug = 'one-time-dog-poop-cleanup' and label like 'Severe%';

-- The policy this rule runs under. `offer_optional` is preserved as a value rather than
-- deleted, because it is what the site did until today and a setting that cannot express its
-- own history is a setting somebody will be surprised by.
insert into settings (key, value, updated_by)
values ('booking.initial_cleanup_policy', '"required_beyond_two_weeks"', 'amtech')
on conflict (key) do update set value = excluded.value, updated_by = 'amtech', updated_at = now();

commit;
