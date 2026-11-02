-- Scoop Dogg — sanitizing is a treatment, not a second weekly service (Ben, 2026-11-01). Josue is in
-- the yard every week anyway, so it is $25/$35/$45 each time it is done, on a visit he is already
-- making. Added at booking it goes on the first visit; the monthly price does not change. The 051
-- plan lines are retired. Weekly care that includes sanitizing is Turf Deodorizing.

-- rehearse: select count(*) = 0 from packages where service_slug = 'yard-sanitizing' and status = 'active'
-- rehearse: select count(*) = 0 from service_tiers where service_slug = 'yard-sanitizing' and price_suffix <> ''

begin;
update packages set status = 'retired', updated_by = 'amtech' where service_slug = 'yard-sanitizing';
update service_tiers set price_suffix = '', updated_by = 'josue' where service_slug = 'yard-sanitizing';
update services set
  pricing_note = 'One treatment, added to a weekly scooping visit, priced by the size of your yard. No extra trip.',
  intro = 'Scooping takes away what you can see. Sanitizing takes care of what you cannot. We treat the areas your dog uses most with a pet-safe sanitizer that breaks down odor and germs, so the yard smells as clean as it looks. It is an add-on to weekly poop scooping, done while we are already there: add it when you book and it happens on your first visit. Want it again later? Just ask.',
  what_includes = array['Pet-safe sanitizer on the areas your dog uses most','Odor and germs treated at the source','Done on a scooping visit, no extra trip','Works on turf, grass, gravel and concrete'],
  faqs = '[{"q":"Can I get sanitizing without scooping?","a":"Sanitizing is an add-on to weekly poop scooping. If you have turf and want it cared for every week, look at Turf Deodorizing, which includes sanitizing."},{"q":"How often should I do it?","a":"Whenever the yard needs it. Add it when you book, then just ask when you want it again."},{"q":"Is it safe for my dog?","a":"Yes. It is pet-safe."},{"q":"How do I know my yard size?","a":"Small is up to 300 sq ft, medium is 300 to 500, and large is 500 to 800. A rough guess is fine."}]'::jsonb,
  updated_by = 'josue' where slug = 'yard-sanitizing';
commit;
