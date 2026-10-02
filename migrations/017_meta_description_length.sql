-- Scoop Dogg — one service description was too long to survive widen().
--
-- `/services/kitty-litter-robot-cleaning` shipped a 214-character meta description, which Google
-- truncates mid-sentence. The row itself is 196; the extra 18 come from src/pages/services/
-- [service].astro's widen(), which rewrites " in Ventura County" to " in Ventura & Santa Barbara
-- Counties" so the copy does not limit Josue to one county (Ben, 2026-09-16). A length that is
-- fine in the row and wrong on the page is the kind of thing only a gate catches, and
-- gates/e2e.mjs was not being run by any npm script.
--
-- The replacement writes the widened region directly, so widen() is a no-op on it.
--
-- The check below is the INVARIANT, not this one row: every service description, after the same
-- three substitutions widen() makes, lands between 50 and 200 characters. Six of the eleven rows
-- grow by 18 characters on the page and none of them had room measured.

-- rehearse: select count(*) = 0 from services where length(replace(replace(replace(meta_description, ' in Ventura County', ' in Ventura & Santa Barbara Counties'), 'Serving Ventura County', 'Serving Ventura & Santa Barbara Counties'), ' across Ventura County', ' across Ventura & Santa Barbara Counties')) not between 50 and 200
-- rehearse: select count(*) = 0 from services where meta_description is null or length(meta_description) < 50
-- rehearse: select length((select meta_description from services where slug = 'kitty-litter-robot-cleaning')) = 190

begin;

update services set meta_description =
  $txt$Professional Litter-Robot cleaning in Ventura & Santa Barbara Counties. We deep clean automatic self-cleaning litter boxes, remove buildup and odor, and keep your smart box working properly.$txt$,
  updated_at = now()
 where slug = 'kitty-litter-robot-cleaning';

commit;
