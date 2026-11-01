-- Scoop Dogg — 046 dropped two true lines from the litter exchange; they come back.

-- rehearse: select what_includes[2] like '%clean litter%' from services where slug = 'kitty-litter-exchange'

begin;
update services set what_includes[2] = 'Box cleaned, sanitized and refreshed with clean litter',
  pricing_note = 'Priced per box, per visit, billed monthly. Litter not included unless requested.', updated_by = 'josue'
 where slug = 'kitty-litter-exchange';
commit;
