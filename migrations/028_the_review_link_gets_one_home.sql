-- Scoop Dogg — the review request needs a link, and the link had no row. Then it turned out to
-- be two links, because "see our reviews" and "write us one" are two different facts.
--
-- `growth.review_request_after_visits` has been a settings row since migration 018 with the
-- value 3, and until step 9 nothing read it. Giving it a reader (server/lib/comms.ts) exposed
-- the other half: the message needs somewhere to send people, and the Google URL lived ONLY as
-- a code default in src/lib/catalog.ts —
--
--   profileUrl: setting<string>('reviews.google_profile_url', 'https://share.google/…')
--
-- — a fallback for a row that does not exist.
--
-- WHY ROWS AND NOT MORE DEFAULTS. This project keeps being bitten by one number with two homes:
-- `billing.platform_fee_bps` duplicates a column `money.ts` calls "the single writer", and
-- `rate_cards` was read and never written. A second hardcoded URL on the server would have
-- shipped a review request that kept working after somebody changed the site's copy and pointed
-- customers at the old profile. `gates/lead-comms.mjs` fails if comms.ts ever grows its own
-- default.
--
-- ============================================================================================
-- WHAT WAS MEASURED, 2026-09-22, BEFORE THIS EVER RAN (latest applied migration: 027).
--
-- 1. THE OLD VALUE IS A SEARCH PAGE. `https://share.google/nt1A1k6dxX8r6KWni`, followed with a
--    browser user-agent, 302s to
--        https://www.google.com/search?…&q=Scoop+Dogg+-+Dog+Poop+Cleanup+Ventura&kgmid=/g/11wvy1bwgc
--    Right business, wrong page. "See us on Google" is a fair label for that. "Leave a review",
--    in an email we sent asking for one, is not — and R8 §B2 calls the review request the single
--    highest-return growth item on this project, so its last click is not a place to lose people.
--
-- 2. ONE KEY WAS DOING TWO JOBS. `reviews.google_profile_url` is read by /reviews and
--    ReviewQuotes as "See us on Google" (a reader) and by comms.ts as "Leave a review" (a
--    writer). Those want different destinations. One key cannot be right for both, so there are
--    two keys now, and each surface reads the one that matches its verb.
--
-- 3. IT WAS THIRTY LINKS, NOT ONE. The code default appears 30 times in a clean build, on the
--    homepage and every /areas page. Every one of them is an external link to a redirect —
--    which is what Ahrefs reported on production as "External 3XX redirect" and "Page has links
--    to redirect". Both new values answer 200 with no redirect at all, so one row clears all 30.
--
-- BOTH URLS ARE DERIVED, NOT LOOKED UP. Josue's own site links his Google Maps place:
--
--   https://maps.app.goo.gl/9gB4PZfqtLwkHhQ3A
--     -> …/maps/place/Scoop+Dogg+-+Dog+Poop+Cleanup+Ventura/@34.2954755,-119.2912215,17z/
--        data=…!1s0x80e9ad5095f467c7:0xa340946c96acfa2f!…!16s%2Fg%2F11wvy1bwgc
--
-- The `0x…:0x…` pair is Google's feature id. A Place ID is base64url of a protobuf holding both
-- halves as little-endian fixed64s (`0a 12 09 <hi LE> 11 <lo LE>`), which gives
-- `ChIJx2f0lVCt6YARL_qslmyUQKM`; decoding that string returns exactly `c767f49550ade980` and
-- `2ffaac966c9440a3`. It round-trips, so this is arithmetic over a value Josue already
-- publishes, not a guess about his business.
--
--   re-derive and re-check both:  node scripts/derive-place-id.mjs --check
--
-- WHY `do update` AND NOT `do nothing`. The superseded value may have been applied somewhere
-- this session could not see. Overwriting ONLY the URLs we know to be superseded makes this
-- self-correcting there and a no-op everywhere else, and leaves alone any URL Josue set himself
-- in /admin/settings — that is a person making a decision.
-- ============================================================================================
--
-- WITHOUT THESE ROWS the review request does not send and reports why, rather than guessing a
-- URL. That is the behaviour this migration turns off.

-- rehearse: select count(*) = 2 from settings where key in ('reviews.google_profile_url', 'reviews.google_review_url')
-- rehearse: select count(*) = 2 from settings where key like 'reviews.google_%url' and value #>> '{}' like 'https://%'
-- rehearse: select count(*) = 0 from settings where key like 'reviews.google_%url' and value #>> '{}' like '%share.google%'
-- rehearse: select (select value #>> '{}' from settings where key = 'reviews.google_review_url') like 'https://search.google.com/local/writereview?placeid=%'
-- rehearse: select (select value #>> '{}' from settings where key = 'reviews.google_profile_url') like 'https://www.google.com/maps/place/?q=place_id:%'
-- rehearse: select count(distinct value #>> '{}') = 2 from settings where key like 'reviews.google_%url'

begin;

-- Read them: the canonical Maps place URL. 200, no redirect.
insert into settings (key, value, updated_by) values
  ('reviews.google_profile_url',
   '"https://www.google.com/maps/place/?q=place_id:ChIJx2f0lVCt6YARL_qslmyUQKM"'::jsonb,
   'migration:028')
on conflict (key) do update
  set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
  where settings.value #>> '{}' like '%share.google%'
     or settings.value #>> '{}' like '%maps.app.goo.gl%';

-- Write one: the review composer. 200 (sign-in first when signed out, which is correct).
insert into settings (key, value, updated_by) values
  ('reviews.google_review_url',
   '"https://search.google.com/local/writereview?placeid=ChIJx2f0lVCt6YARL_qslmyUQKM"'::jsonb,
   'migration:028')
on conflict (key) do update
  set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
  where settings.value #>> '{}' like '%share.google%'
     or settings.value #>> '{}' like '%maps.app.goo.gl%';

commit;
