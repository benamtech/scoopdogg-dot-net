-- Scoop Dogg — a sanitizer kills germs; an enzyme digests the odor source. They are different products,
-- so the Yard Sanitizing page stops claiming the enzyme's job (research/2026-11-02-scoopdogg-engine/TRADE-KNOWLEDGE.md).

-- rehearse: select intro not like '%breaks down odor%' from services where slug = 'yard-sanitizing'

begin;
update services set
  intro = replace(intro, 'a pet-safe sanitizer that breaks down odor and germs, so the yard smells as clean as it looks', 'a pet-safe sanitizer that kills germs and freshens the yard'),
  what_includes = array_replace(what_includes, 'Odor and germs treated at the source', 'Germs killed where your dog goes'),
  meta_description = replace(meta_description, 'Pet-safe treatment that kills odor and germs where your dog goes', 'A pet-safe treatment that kills germs where your dog goes'),
  updated_by = 'josue'
 where slug = 'yard-sanitizing';
commit;
