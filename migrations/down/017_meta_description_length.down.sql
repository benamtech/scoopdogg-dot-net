-- Revert 017: the 196-character description, which renders at 214 after widen().
begin;
update services set meta_description =
  $txt$Professional Litter-Robot cleaning service in Ventura County. We deep clean automatic self-cleaning litter boxes, remove buildup, eliminate odors, and keep your smart litter box working perfectly.$txt$,
  updated_at = now()
 where slug = 'kitty-litter-robot-cleaning';
delete from _migrations where name = '017_meta_description_length.sql';
commit;
