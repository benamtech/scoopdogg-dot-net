-- Revert 025.
--
-- The days came from Josue's own published copy and can be re-derived from it at any time, so
-- clearing them loses a lookup rather than a fact.
--
-- IT CLEARS ONLY THE ELEVEN THIS MIGRATION SET. A day Josue has since ticked in his admin is
-- his, and a revert that took it would be destroying an owner's own answer to tidy up after
-- us. Narrow by slug, not by `service_weekdays <> '{}'`.
begin;

update service_areas set service_weekdays = '{}'
 where slug in ('ventura','ojai','oak-view','santa-paula','newbury-park','moorpark',
                'santa-barbara','westlake-village','fillmore','agoura-hills','carpinteria');

comment on column service_areas.service_weekdays is
  '0=Sunday..6=Saturday. Empty means no route yet: booking offers any day in '
  'schedule.service_days rather than refusing. Josue clusters a city by ticking days.';

delete from _migrations where name = '025_route_days_from_published_copy.sql';
commit;
