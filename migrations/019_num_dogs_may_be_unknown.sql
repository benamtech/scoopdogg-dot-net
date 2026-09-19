-- Scoop Dogg — a property may not have a number of dogs, and saying "1" is a guess.
--
-- FOUND BY gates/invite-flow.mjs ON ITS FIRST RUN, 2026-09-19, and it is a live defect rather
-- than a gate problem. `properties.num_dogs` is `integer not null default 1`, and a DEFAULT does
-- not apply to an explicit NULL - it applies to an omitted column. So every insert that passes
-- null for this column throws, and `server/lib/booking.ts` passes null whenever the package's
-- short_label does not begin with a digit:
--
--   '1 dog' '2 dogs' '3 dogs' '4+ dogs' '1 litter box' '2 litter boxes'   -> parses, inserts
--   'Small area' 'Medium area' 'Small yard' 'Medium yard'                -> null -> 23502
--
-- Which means booking WEEKLY TURF MAINTENANCE or WEEKLY YARD MAINTENANCE on the live funnel
-- answers "Something went wrong on our side" at the moment of payment, and has since the
-- packages were introduced. Four of the ten bookable packages. Nobody has hit it because nobody
-- has booked those - and that is not the same as it working.
--
-- THE FIX IS THE HONEST SHAPE, NOT A COALESCE. A turf customer has an unknown number of dogs;
-- writing 1 into the row would be inventing a fact about a real customer to satisfy a constraint
-- (rule 7, and rule 14: a blank field is not a fact). The column becomes nullable and loses its
-- default, so "we did not ask" is representable and every screen that shows it already has to
-- handle a missing value.
--
-- Existing rows are untouched: there are none, and if there were, a 1 already written stays 1.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'properties' and column_name = 'num_dogs' and is_nullable = 'YES'
-- rehearse: select column_default is null from information_schema.columns where table_name = 'properties' and column_name = 'num_dogs'
-- rehearse: select count(*) = 1 from pg_constraint where conrelid = 'properties'::regclass and pg_get_constraintdef(oid) like '%num_dogs >= 0%'

begin;

alter table properties alter column num_dogs drop not null;
alter table properties alter column num_dogs drop default;

comment on column properties.num_dogs is
  'NULL means nobody asked - a turf or yard-maintenance customer has no dog count and a 1 '
  'written to satisfy a constraint would be a fact about a customer that nobody established. '
  'The check constraint still refuses a negative number.';

commit;
