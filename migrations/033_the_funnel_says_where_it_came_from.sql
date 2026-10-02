-- Scoop Dogg — one column that closes two holes: where a visitor came from, and whether it was us.
--
-- THE MEASUREMENT THAT FORCED IT (2026-09-23). `funnel_sessions` holds 25 rows. Every one of them
-- is our own traffic: four ZIPs (93001, 93030, 93041, 93101), zero names, zero email addresses,
-- and three of them written at 01:14, 01:19 and 01:40 on the morning this migration was drafted,
-- in the 93041-then-93030 pair that is `gates/funnel-events.mjs`'s own fixture. Nothing in the
-- table can tell any of them from a customer, and nothing recorded which run made them. The growth board reads
-- this table for "booking-intent starts" and conversion, so the first number a client dashboard
-- shows about its own funnel is a count of AMTECH's continuous integration — and it gets worse
-- the more carefully we test.
--
-- The brain already carried the vigilance version of this: "a gate that walks a live client site
-- leaves rows; count both sides." Vigilance is not a mechanism. This is the mechanism.
--
-- AND IT IS THE SAME COLUMN CHANNEL ATTRIBUTION NEEDS, which is why it pays from row one rather
-- than only preventing a future error. R16 found the top of the funnel is the constraint on this
-- business — a close rate near 1.0 means everyone who arrives has already decided elsewhere — and
-- nothing anywhere records WHERE they arrived from. `source` holds the referrer host for real
-- traffic and a reserved value for ours. One column, two answers, and the board filters on it.
--
-- THE TWO RESERVED VALUES, and the difference between them is the difference between an
-- observation and an inference:
--
--   'gate'        written AT THE TIME by a verifier, through the shipped `track()` path. A fact.
--   'gate-retro'  attributed AFTERWARDS to the 25 rows above, by this migration. NOT a fact —
--                 it is a judgement from four pieces of evidence (no name, no email, four ZIPs
--                 that are the gates' own fixtures, no session reaching a name or an address,
--                 and the 93041/93030 pairing repeating on four separate nights). Kept as a
--                 separate value so nobody later reads an inference as an observation.
--
-- The backfill touches only rows with NO name and NO email, because those two columns fill in
-- when a human types them, and a row with a human's name in it is not one this migration is
-- entitled to relabel. One backfilled row carries a `subscription_id` — the test booking named in
-- server/lib/density.ts — and it is included: its funnel row has no name and no email either.
--
-- WHAT THIS IS NOT. It is not a trust boundary and `server/lib/funnel.ts` says so where it
-- matters. A browser cannot write a reserved value — the API refuses it — but nothing here would
-- stop a determined visitor marking themselves with the verifier header. The cost of that is one
-- person excluding themselves from a count on their own client's dashboard. There is no secret
-- here to protect and inventing a check for an attack nobody is running would be the wrong shape.
--
-- NO COOKIE, NO DEVICE ID, NO THIRD PARTY. `source` is a hostname, the same string the browser
-- already sends in a Referer header, and the table's own comment from 021 still holds.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'funnel_sessions' and column_name = 'source'
-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'funnel_sessions' and column_name = 'source' and is_nullable = 'YES'
-- rehearse: select count(*) >= 25 from funnel_sessions where source = 'gate-retro'
-- rehearse: select count(*) = 0 from funnel_sessions where source = 'gate-retro' and (name is not null or email is not null)
-- rehearse: select count(*) = 0 from funnel_sessions where source is not null and source !~ '^[a-z0-9][a-z0-9.-]{0,79}$'
-- rehearse: select count(*) = 1 from pg_indexes where tablename = 'funnel_sessions' and indexname = 'funnel_sessions_source_idx'
-- rehearse: select count(*) = 1 from pg_constraint where conrelid = 'funnel_sessions'::regclass and conname = 'funnel_sessions_source_shape'

begin;

alter table funnel_sessions add column source text;

-- A hostname or a reserved word, lowercase, and short. Anything else is a bug in the caller
-- rather than a visitor worth recording, and a free-text column is one nobody can group by.
alter table funnel_sessions
  add constraint funnel_sessions_source_shape
  check (source is null or source ~ '^[a-z0-9][a-z0-9.-]{0,79}$');

comment on column funnel_sessions.source is
  'Where this session came from: the referrer''s host with any www. stripped (''google.com'', '
  '''instagram.com''), null for a direct visit, or one of the reserved verifier values — ''gate'' '
  'written at the time by a verifier, ''gate-retro'' attributed afterwards by migration 033. The '
  'growth board filters the reserved values out. server/lib/funnel.ts holds the one list.';

-- The board filters on it on every read, and "not ours" is the common case.
create index funnel_sessions_source_idx on funnel_sessions (source);

update funnel_sessions
   set source = 'gate-retro'
 where source is null and name is null and email is null;

commit;
