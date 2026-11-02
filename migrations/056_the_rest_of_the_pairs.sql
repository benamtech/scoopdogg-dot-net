-- Scoop Dogg — the sensible pairs 055 left out: other parts of the same property, and a second weekly
-- plan on the same visit. Reasoned, not measured: yard and turf and run and patio are different places.

-- rehearse: select count(*) > 50 from service_relations

begin;
insert into service_relations (base_slug, other_slug, kind, customer_line, approved_by)
select b, o, k, l, 'ben (reasoned 2026-11-02)' from (values
  ('weekly-pooper-scooper-service','weekly-turf-maintenance','add_on','Care for the turf on the same weekly visit.'),
  ('weekly-pooper-scooper-service','weekly-yard-maintenance','add_on','Mow and blow on the same weekly visit.'),
  ('weekly-turf-maintenance','weekly-yard-maintenance','add_on','Mow and blow the grass on the same weekly visit.'),
  ('weekly-yard-maintenance','weekly-turf-maintenance','add_on','Care for the turf on the same weekly visit.'),
  ('dog-run-cleanups','turf-deep-clean','add_on','Deep clean the turf on the same visit.'),
  ('dog-run-cleanups','yard-deep-clean','add_on','Clear the overgrowth on the same visit.'),
  ('pressure-washing','turf-deep-clean','add_on','Deep clean the turf on the same visit.'),
  ('pressure-washing','yard-deep-clean','add_on','Clear the overgrowth on the same visit.')
) v(b, o, k, l);
commit;
