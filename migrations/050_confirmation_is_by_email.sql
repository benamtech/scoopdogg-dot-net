-- Scoop Dogg — the scooping page promised a same-day text; the confirmation goes by email.

-- rehearse: select what_includes[4] = 'Same-day confirmation when the visit is done' from services where slug = 'weekly-pooper-scooper-service'

begin;
update services set what_includes[4] = 'Same-day confirmation when the visit is done', updated_by = 'amtech' where slug = 'weekly-pooper-scooper-service';
commit;
