-- Scoop Dogg — the questions people ask after a bad experience with another company, answered on the
-- service page where they are reading, from what is already on record: the guarantee, the gate, the
-- confirmation and the fees (research/2026-11-02-scoopdogg-review-mining/REPORT.md).

-- rehearse: select jsonb_array_length(faqs) >= 8 from services where slug = 'weekly-pooper-scooper-service'
-- rehearse: select faqs::text like '%How will I know you came?%' from services where slug = 'weekly-pooper-scooper-service'

begin;
update services set
  faqs = faqs || '[
    {"q": "What if you miss some?", "a": "Tell us within 24 hours and we come back and make it right, free."},
    {"q": "Will you close my gate?", "a": "Yes. We secure the gate after every visit."},
    {"q": "How will I know you came?", "a": "You get a same-day confirmation when the visit is done."}
  ]'::jsonb,
  updated_by = 'amtech'
 where slug = 'weekly-pooper-scooper-service' and faqs::text not like '%How will I know you came?%';
commit;
