-- Scoop Dogg — the words catch up with what the booking does. Fixed prices stop saying "confirmed after
-- booking", sanitizing stops saying it goes with weekly scooping only, and the pressure washing and dog run
-- answers stop contradicting the jobs. Google shows 45 reviews, read 2026-11-02
-- (research/2026-11-02-scoopdogg-review-mining/REPORT.md). A month has always been priced as four visits.

-- rehearse: select (select value::text from settings where key = 'billing.monthly_factor') = '"4"'
-- rehearse: select (select value::text from settings where key = 'reviews.google_count') = '45'
-- rehearse: select pricing_note not like '%confirmed after booking%' from services where slug = 'one-time-dog-poop-cleanup'
-- rehearse: select faqs::text not like '%We do not pressure wash artificial turf%' from services where slug = 'pressure-washing'
-- rehearse: select faqs::text not like '%quoted to the job%' from services where slug = 'weekly-yard-maintenance'

begin;
update settings set value = '"4"'::jsonb, updated_by = 'josue', updated_at = now() where key = 'billing.monthly_factor';
update settings set value = '45'::jsonb, updated_by = 'amtech', updated_at = now() where key = 'reviews.google_count';
update settings set value = '"2026-11-02"'::jsonb, updated_by = 'amtech', updated_at = now() where key = 'reviews.google_checked_on';

update services set
  pricing_note = 'One clear price by how much has built up. Pick yours, choose a day and pay online. Severe buildup gets a custom quote.',
  faqs = replace(faqs::text, 'Book online and describe what you are dealing with. We will give you an honest quote before we start. No surprises.', 'Pick the closest match and you see the price before you pay, or call us and we will help you choose.')::jsonb,
  updated_by = 'josue'
 where slug = 'one-time-dog-poop-cleanup';

update services set
  pricing_note = 'One treatment, added to a scooping visit or another job, priced by the size of your yard. No extra trip.',
  intro = replace(intro, 'It is an add-on to weekly poop scooping, done while we are already there: add it when you book and it happens on your first visit. Want it again later? Just ask.', 'It is an add-on, done while we are already there on a scooping visit or another job: add it when you book. Want it again later? Just ask.'),
  what_includes = array_replace(what_includes, 'Done on a scooping visit, no extra trip', 'Done on a visit we are already making, no extra trip'),
  who_its_for = 'Customers who want the yard treated while we are there, especially with more than one dog or in hot weather.',
  meta_description = 'Add yard sanitizing to a scooping visit or another job. A pet-safe treatment that kills germs where your dog goes. Priced by the size of your yard.',
  faqs = replace(faqs::text, 'Sanitizing is an add-on to weekly poop scooping. If you have turf', 'Sanitizing is an add-on, done on a scooping visit or another job we are already doing. If you have turf')::jsonb,
  updated_by = 'josue'
 where slug = 'yard-sanitizing';

update services set
  faqs = replace(replace(faqs::text,
    'We do not pressure wash artificial turf — turf gets the enzyme deep clean treatment instead.', 'Artificial turf has its own job, the Turf Deep Clean, which brushes and vacuums it before the wash.'),
    'Just mention it when you book.', 'Add it when you book.')::jsonb,
  updated_by = 'josue'
 where slug = 'pressure-washing';

update services set
  pricing_note = 'One clear price by the size of the area. Add yard sanitizing when you book. A large or custom area gets a quote.',
  what_includes = array_replace(what_includes, 'Odor assessment and optional enzyme treatment', 'Yard sanitizing available as an add-on'),
  faqs = replace(replace(faqs::text, 'Can I add enzyme treatment to the same visit?', 'Can I have the run sanitized on the same visit?'),
    'Absolutely. Most dog run cleanups benefit from an enzyme deodorizer application after waste removal, especially if the run is artificial turf or concrete.', 'Yes. Add yard sanitizing when you book and we do it after the waste is removed.')::jsonb,
  updated_by = 'josue'
 where slug = 'dog-run-cleanups';

update services set pricing_note = 'One clear price by the size of the tree. Multiple trees get a quote. Cleaning products are pet-safe.', updated_by = 'josue' where slug = 'cat-tree-cleaning';

update services set
  faqs = replace(faqs::text, 'A Yard Deep Clean is a one-time reset for an overgrown yard, quoted to the job.', 'A Yard Deep Clean is a one-time reset for an overgrown yard, at one price by size.')::jsonb,
  updated_by = 'josue'
 where slug = 'weekly-yard-maintenance';
commit;
