-- Scoop Dogg — the completion photo gets somewhere to live, and a chain of four readers wakes up.
--
-- WHAT WAS MEASURED, 2026-09-22:
--
--   settings: visit.require_completion_photo = true
--   visits:   1 row, 0 completed
--   code:     server/lib/visits.ts refuses every completion, by name, because there is no
--             photo storage on this project — no blob client, no bucket, nothing in package.json
--
-- That refusal was correct and it was also the top of a chain nobody had traced end to end:
--
--   no photo storage
--     -> visit.complete refuses           (server/lib/visits.ts, completionReadiness)
--     -> visits.completed_at stays null
--     -> `count(v.id) >= 3` is never true (server/lib/comms.ts, eligibleForReviewRequest)
--     -> the review request can never fire
--     -> no review velocity
--
-- R8 §B2 calls that review request "the single highest-return growth item in this document".
-- It could not run, and the reason was three layers away from anything that mentions reviews.
-- The 2026-09-19 note recorded the photo requirement as "a question for Josue: add storage or
-- turn the row off". It is not his question. Storage is ours to build, and turning the row off
-- would delete his proof-of-care differentiator (photo_proof is table stakes at 0.50 of scoopers
-- in the competitor sweep, and Scoop Dogg reads NO) and his chargeback evidence (R3 §3d) to save
-- us writing a table.
--
-- WHY POSTGRES AND NOT A BLOB STORE. Vercel Blob is the better home for this at volume and it is
-- where this should go when there is volume. Today it would mean a new vendor, a new credential
-- somebody has to provision, and a new failure mode, for a business with one customer. Bytes in
-- a table need none of those and the interface in server/lib/photos.ts has exactly one
-- implementation to swap when the trade flips. THE DIAL THAT KEEPS THIS HONEST IS RETENTION,
-- not hope: `visit.photo_retention_days` defaults to 120, which is the card chargeback window
-- the photo exists to answer, and `pruneVisitPhotos()` is what enforces it.
--
-- The arithmetic, so the day it stops being true is visible: 100 customers x 4.33 visits a month
-- x 120 days x one photo at the 900KB cap is about 1.5GB steady state, and that is the worst
-- case because the browser resizes to 1600px before it uploads. At the target book of business
-- this is a table. At ten times it is a blob store.
--
-- WHY THE BYTES AND NOT A PATH. `visits.photo_urls` is text[] and server/lib/visits.ts requires
-- every entry to match ^https?:// — it always wanted a URL. This keeps that contract: the row
-- is the storage, /api/photo/<id> is the URL, and nothing in the completion path changes shape.
--
-- ON PRIVACY, SAID OUT LOUD. A photo of somebody's yard is served from an unguessable id (uuid
-- v4, 122 bits) with no listing and no index, which is a capability URL: holding the link is the
-- permission. That is the same standard as the customer's own magic sign-in link, it is what
-- lets the photo render in an email and on /account without a session, and it is weaker than a
-- login. It is the right trade for a picture of a clean lawn and it would be the wrong one for
-- anything else, so `visit_photos` is the only table shaped this way.

-- rehearse: select count(*) = 1 from information_schema.tables where table_name = 'visit_photos'
-- rehearse: select count(*) = 3 from settings where key in ('visit.photo_max_bytes', 'visit.photo_retention_days', 'visit.photos_per_visit_max')
-- rehearse: select (select value::int from settings where key = 'visit.photo_retention_days') between 90 and 400
-- rehearse: select (select value::int from settings where key = 'visit.photo_max_bytes') between 100000 and 4000000
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'visit_photos' and column_name = 'bytes' and data_type = 'bytea'
-- rehearse: select count(*) = 2 from information_schema.table_constraints where table_name = 'visit_photos' and constraint_type = 'FOREIGN KEY'
-- rehearse: select count(*) = 1 from information_schema.key_column_usage k join information_schema.table_constraints t on t.constraint_name = k.constraint_name where t.table_name = 'visit_photos' and t.constraint_type = 'FOREIGN KEY' and k.column_name = 'visit_id'
-- rehearse: select count(*) = 1 from information_schema.key_column_usage k join information_schema.table_constraints t on t.constraint_name = k.constraint_name where t.table_name = 'visit_photos' and t.constraint_type = 'FOREIGN KEY' and k.column_name = 'uploaded_by'
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'visit_photos' and indexname = 'visit_photos_dedupe_idx'
-- rehearse: select count(*) = 0 from visit_photos

begin;

create table visit_photos (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid        not null references visits(id) on delete cascade,
  bytes       bytea       not null,
  mime        text        not null check (mime in ('image/jpeg', 'image/webp', 'image/png')),
  byte_size   integer     not null check (byte_size > 0),
  sha256      text        not null,
  uploaded_by uuid        references team_members(id),
  created_at  timestamptz not null default now()
);

create index visit_photos_visit_idx on visit_photos (visit_id);
create index visit_photos_created_idx on visit_photos (created_at);

-- The same bytes uploaded twice for the same visit is one photo, not two. A crew member tapping
-- a slow button is the ordinary way this happens.
create unique index visit_photos_dedupe_idx on visit_photos (visit_id, sha256);

comment on table visit_photos is
  'Completion photos, bytes and all. Served from /api/photo/<id> as a capability URL: the id is '
  'the permission. Pruned by visit.photo_retention_days, which defaults to the chargeback window '
  'the photo exists to answer.';

insert into settings (key, value, updated_by) values
  -- 900KB. A 1600px JPEG off a phone, after the browser resizes it, is 150-400KB; this leaves
  -- room without letting an unresized 12MP original through. The server rejects above it.
  ('visit.photo_max_bytes',       '900000'::jsonb, 'migration:029'),
  -- 120 days: the card chargeback window. Longer costs storage for no stated reason; shorter
  -- throws away the evidence before the dispute can arrive.
  ('visit.photo_retention_days',  '120'::jsonb,    'migration:029'),
  -- Before and after is two. A third is somebody filling the table.
  ('visit.photos_per_visit_max',  '3'::jsonb,      'migration:029')
on conflict (key) do nothing;

commit;
