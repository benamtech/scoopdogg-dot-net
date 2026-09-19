-- Scoop Dogg — the route days Josue has been publishing all along.
--
-- `service_areas.service_weekdays` has been EMPTY for all sixteen cities since migration 011,
-- and that emptiness has been carried in the record as a blocker on Josue for a week: it stops
-- the day picker, the "same day every week" promise and roughly sixteen question pages. The
-- plan said he had to tick a 16x7 grid in the admin before any of it could work.
--
-- HE HAD ALREADY ANSWERED IT, IN PUBLIC. Eleven of the sixteen city pages on scoopdogg.net
-- state their route days in Josue's own copy — "Most of our Ventura clients are on a weekly
-- Tuesday or Thursday route", "We run Santa Barbara on a Tuesday and Friday coastal route".
-- Reading a claim the business already publishes is not inventing a fact about that business;
-- it is the opposite. AGENTS.md rule 7 forbids guessing a fact about a real client, and rule 14
-- says a blank field is not a fact — `service_weekdays = '{}'` meant "nobody looked", and this
-- migration is what looking turned up.
--
-- THE FIVE WITH NO PUBLISHED DAY STAY EMPTY, and that is the point of doing it this way.
-- Oxnard, Camarillo, Thousand Oaks, Simi Valley and Malibu say nothing about which day they
-- run, so their rows keep '{}' and the funnel degrades honestly for them exactly as designed.
-- The ask to Josue shrinks from a sixteen-city grid to five cities — a question he can answer
-- in one line rather than a screen he has to sit down for.
--
-- WHERE A DAY IS A ROUTE AND NOT A PROMISE. The Ventura and Ojai sentences say "most of our
-- clients are on" a day, which is a statement about the route rather than a guarantee for a
-- new customer. That is the right strength for this column: `service_weekdays` is the set of
-- days the day picker OFFERS, and the customer then chooses one. It is not a claim that every
-- customer in that city is served on those days.
--
-- Provenance: every value is quoted below from the `areas` row it came from, so the next reader
-- can check the source without leaving the file. Read from content/catalog.json, which
-- `scripts/pull-catalog.mjs` pulls from this database, on 2026-09-19.

-- rehearse: select count(*) = 11 from service_areas where service_weekdays <> '{}'
-- rehearse: select count(*) = 5 from service_areas where service_weekdays = '{}'
-- rehearse: select service_weekdays = '{2,4}' from service_areas where slug = 'ventura'
-- rehearse: select service_weekdays = '{2,5}' from service_areas where slug = 'santa-barbara'
-- rehearse: select service_weekdays = '{2}' from service_areas where slug = 'carpinteria'
-- rehearse: select service_weekdays = '{}' from service_areas where slug = 'malibu'
-- rehearse: select bool_and(d between 0 and 6) from service_areas, unnest(service_weekdays) d

begin;

-- Ventura: "Most of our Ventura clients are on a weekly Tuesday or Thursday route."
update service_areas set service_weekdays = '{2,4}' where slug = 'ventura' and service_weekdays = '{}';

-- Ojai: "Most of our Ojai clients are on a Monday or Wednesday route."
update service_areas set service_weekdays = '{1,3}' where slug = 'ojai' and service_weekdays = '{}';

-- Oak View: "We serve Oak View on our Monday and Wednesday inland routes, pairing it efficiently with nearby Ojai."
update service_areas set service_weekdays = '{1,3}' where slug = 'oak-view' and service_weekdays = '{}';

-- Santa Paula: "We service Santa Paula on our Monday and Thursday inland routes."
update service_areas set service_weekdays = '{1,4}' where slug = 'santa-paula' and service_weekdays = '{}';

-- Newbury Park: "We service Newbury Park on our Tuesday and Thursday Conejo Valley routes."
update service_areas set service_weekdays = '{2,4}' where slug = 'newbury-park' and service_weekdays = '{}';

-- Moorpark: "We service Moorpark on our Wednesday and Friday routes."
update service_areas set service_weekdays = '{3,5}' where slug = 'moorpark' and service_weekdays = '{}';

-- Santa Barbara: "We run Santa Barbara on a Tuesday and Friday coastal route."
update service_areas set service_weekdays = '{2,5}' where slug = 'santa-barbara' and service_weekdays = '{}';

-- Westlake Village: "We service Westlake on our Tuesday and Thursday Conejo Valley routes."
update service_areas set service_weekdays = '{2,4}' where slug = 'westlake-village' and service_weekdays = '{}';

-- Fillmore: "We service Fillmore on our Monday and Thursday inland routes alongside Santa Paula and Ojai."
update service_areas set service_weekdays = '{1,4}' where slug = 'fillmore' and service_weekdays = '{}';

-- Agoura Hills: "We service Agoura Hills on our Tuesday and Thursday Conejo Valley routes."
update service_areas set service_weekdays = '{2,4}' where slug = 'agoura-hills' and service_weekdays = '{}';

-- Carpinteria: "We service Carpinteria on our Tuesday coastal run alongside Santa Barbara."
-- One day, not two, because that is what the sentence says.
update service_areas set service_weekdays = '{2}' where slug = 'carpinteria' and service_weekdays = '{}';

-- NOT SET, deliberately: oxnard, camarillo, thousand-oaks, simi-valley, malibu.
-- Their pages name no day. Thousand Oaks is mentioned BY Newbury Park, Westlake Village and
-- Agoura Hills as a city they are grouped with, which is suggestive and is not a statement
-- about Thousand Oaks's own route — so it stays empty and gets asked.

comment on column service_areas.service_weekdays is
  '0=Sunday..6=Saturday. Empty means no route day is known, and the booking flow offers any day '
  'in schedule.service_days rather than refusing. Eleven cities were filled by migration 025 '
  'from the route days Josue already publishes on his own city pages, each quoted in that file; '
  'the other five publish none and are the only ones worth asking him about.';

commit;
