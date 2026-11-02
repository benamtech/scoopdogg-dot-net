begin;
update services set faqs = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(faqs) x
  where x->>'q' not in ('What if you miss some?', 'Will you close my gate?', 'How will I know you came?'))
 where slug = 'weekly-pooper-scooper-service';
commit;
