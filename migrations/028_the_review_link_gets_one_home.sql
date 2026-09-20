-- Scoop Dogg — the review request needs a link, and the link had no row.
--
-- `growth.review_request_after_visits` has been a settings row since migration 018 with the
-- value 3, and until step 9 nothing read it. Giving it a reader (server/lib/comms.ts) exposed
-- the other half: the message needs somewhere to send people, and the Google profile URL lived
-- ONLY as a code default in src/lib/catalog.ts —
--
--   profileUrl: setting<string>('reviews.google_profile_url', 'https://share.google/...')
--
-- — a fallback for a row that does not exist. The site has published that URL on /reviews as
-- "See us on Google" since the rebuild, so this is not a new claim about Josue's business; it
-- is the same value, written down where both halves of the system can read it.
--
-- WHY A ROW AND NOT A SECOND DEFAULT IN comms.ts. This project keeps being bitten by one
-- number with two homes — `billing.platform_fee_bps` duplicates a column `money.ts` calls "the
-- single writer", `rate_cards` was read and never written. A second hardcoded URL on the server
-- would have shipped a review request that kept working after somebody changed the site's copy,
-- and pointed customers at the old profile. `gates/lead-comms.mjs` fails if comms.ts ever grows
-- its own default.
--
-- WITHOUT THIS ROW the review request does not send and reports why, rather than guessing a
-- URL. That is the behaviour this migration turns off.

-- rehearse: select value is not null from settings where key = 'reviews.google_profile_url'
-- rehearse: select value::text like '"https://%' from settings where key = 'reviews.google_profile_url'
-- rehearse: select count(*) = 1 from settings where key = 'reviews.google_profile_url'

begin;

insert into settings (key, value, updated_by) values
  ('reviews.google_profile_url', '"https://share.google/nt1A1k6dxX8r6KWni"'::jsonb, 'migration:028')
on conflict (key) do nothing;

commit;
