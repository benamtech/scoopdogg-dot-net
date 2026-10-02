-- Scoop Dogg — the site publishes 42 reviews, because 42 is how many there are.
--
-- MEASURED 2026-09-23 by scripts/pull-review-count.mjs, against the Google Business Profile this
-- site already links from every page (place_id ChIJx2f0lVCt6YARL_qslmyUQKM, listing "Scoop Dogg -
-- Dog Poop Cleanup Ventura"): **5.0, 42 reviews.** Two instruments on the same page — the
-- `aria-label="42 reviews"` Maps writes for screen readers, and the header's own "5.0 / (42)" —
-- and the script refuses to write anything unless they agree. They agreed.
--
-- WHAT THE SITE SAID INSTEAD. `content/catalog.json` holds 18 review quotes. It is a hand-curated
-- set for the page and was never meant to be all of them. But `reviews.google_count` had never
-- been written, the field holding the curated number was called `count`, and SIX surfaces put 18
-- in front of a visitor beside the word Google: /reviews twice including its meta description,
-- the proof bar, the quote block, every question page, and llms.txt — the file AI answer engines
-- read. The site was publishing **43% of its own strongest asset**, on the trust signal R5 scored
-- as table stakes and R11 found is what AI search actually cites.
--
-- WHY THIS IS A ROW AND NOT AN EDIT TO THE JSON. R16 §1.3 named the durable fix and it is not the
-- number: "nothing currently pulls the live count, so it will drift again the week after it is
-- corrected." So there are three things and the number is the least of them:
--
--   this migration                    the count, with its source and its date
--   scripts/pull-review-count.mjs     the reader, re-runnable, --apply to write
--   gates/review-count.mjs            fails when nobody has run it, and when a page builds its
--                                     own sentence out of the curated count again
--
-- `reviews.google_checked_on` is the date the profile was last actually read. It is what turns
-- "this number is old" from something nobody notices into a gate that goes red.
--
-- THE CURATED QUOTES ARE NOT TOUCHED. 18 quotes is a design decision about the page and a fine
-- one; `reviewSummary.quotes` still holds it and /reviews still shows them. What changed is that
-- nothing calls 18 a Google review count any more.
--
-- ONE THING THIS DOES NOT SETTLE, and it is Josue's or Ben's. R16 §1.5 found TWO Google listings
-- sharing this phone number, one carrying all 42 reviews and one carrying none. This migration
-- records the one that has the reviews — the one the site already links. Resolving the duplicate
-- is an owner action and is in the handover note, not in here.

-- rehearse: select (select value::int from settings where key = 'reviews.google_count') = 42
-- rehearse: select (select value::numeric from settings where key = 'reviews.google_rating') = 5.0
-- rehearse: select (select value::int from settings where key = 'reviews.google_count') >= (select count(*) from reviews)
-- rehearse: select (select value #>> '{}' from settings where key = 'reviews.google_checked_on') = '2026-09-23'
-- rehearse: select count(*) = 3 from settings where key in ('reviews.google_count','reviews.google_rating','reviews.google_checked_on')

begin;

insert into settings (key, value, updated_by) values
  ('reviews.google_count',      '42'::jsonb,           'migration:034'),
  ('reviews.google_rating',     '5.0'::jsonb,          'migration:034'),
  ('reviews.google_checked_on', '"2026-09-23"'::jsonb, 'migration:034')
on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

commit;
