-- Scoop Dogg — how the work actually relates (2026-11-02). The model behind every add-on.
--
-- A service is what gets done (tasks), where on the property (zones), at what depth. Whether two
-- services go together is then CALCULATED from that (src/shared/service-graph.ts), with direction:
-- a Turf Deep Clean includes deodorizing, so deodorizing is never added to it; a dog run down the side
-- of the house and a turf yard are different zones, so they make a good pair. These tables hold no price.
-- `service_relations` is what a person approved to show a customer, with the sentence they read. A gate
-- refuses an approved row that the calculated relation contradicts.
-- Evidence: research/2026-11-02-scoopdogg-engine/TRADE-KNOWLEDGE.md.

-- rehearse: select count(*) = 6 from property_zones
-- rehearse: select count(*) > 40 from service_work
-- rehearse: select count(*) > 25 from service_relations

begin;
create table property_zones (
  slug text primary key, name text not null, surface text not null, indoors boolean not null default false, sort_order int not null);
create table work_tasks (
  slug text primary key, name text not null,
  stage int not null,            -- order on a visit: solids, debris, brush, wash, enzyme, sanitize, rinse
  note text not null default '');
create table service_work (
  service_slug text not null references services(slug) on update cascade,
  zone_slug text not null references property_zones(slug),
  task_slug text not null references work_tasks(slug),
  depth text not null default 'full' check (depth in ('light', 'spot', 'full')),
  primary key (service_slug, zone_slug, task_slug));
create table service_relations (
  base_slug text not null references services(slug) on update cascade,
  other_slug text not null references services(slug) on update cascade,
  kind text not null check (kind in ('add_on', 'follow_on')),
  customer_line text not null,
  approved_by text not null,
  primary key (base_slug, other_slug));

insert into property_zones (slug, name, surface, indoors, sort_order) values
  ('yard', 'Grass yard', 'grass', false, 10), ('turf', 'Artificial turf', 'turf', false, 20),
  ('run', 'Dog run or side yard', 'gravel or concrete', false, 30), ('patio', 'Patio and hardscape', 'concrete or pavers', false, 40),
  ('beds', 'Garden beds', 'soil and mulch', false, 50), ('indoors', 'Indoors', 'cat area', true, 60);

insert into work_tasks (slug, name, stage, note) values
  ('scoop', 'Scoop and haul pet waste', 10, 'Solids always go first, before water or brush.'),
  ('debris', 'Clear debris and leaves', 20, ''), ('cut_back', 'Cut back overgrowth', 20, ''), ('weed', 'Weed', 20, ''),
  ('mow', 'Mow', 25, ''), ('trim', 'Garden trims', 25, ''), ('labor', 'Light outdoor work', 25, 'Within the time booked. No tree, haul-away, chemical, irrigation or licensed work.'),
  ('blow', 'Blow clean', 30, ''), ('brush', 'Deep brush', 30, ''), ('vacuum', 'Infill vacuum', 35, ''),
  ('wash', 'Pressure wash', 40, 'Keep wash water out of storm drains.'),
  ('enzyme', 'Enzyme deodorize', 50, 'Digests the odor source. Never in one step with a sanitizer.'),
  ('sanitize', 'Sanitize', 60, 'Kills germs. Its own step, after enzyme and its dwell.'), ('rinse', 'Final rinse', 70, ''),
  ('litter', 'Exchange litter', 10, ''), ('box', 'Clean and sanitize the box and area', 20, ''), ('tree', 'Clean the cat tree', 20, 'Indoor-rated, unscented, cat-safe product only.'),
  ('robot', 'Litter-Robot deep clean and maintenance', 20, 'Globe fully dry before reassembly. No bleach in the globe.');

insert into service_work (service_slug, zone_slug, task_slug, depth)
select s, z, t, d from (values
  ('weekly-pooper-scooper-service','yard','scoop','full'), ('weekly-pooper-scooper-service','turf','scoop','full'),
  ('weekly-pooper-scooper-service','run','scoop','full'), ('weekly-pooper-scooper-service','patio','scoop','full'),
  ('one-time-dog-poop-cleanup','yard','scoop','full'), ('one-time-dog-poop-cleanup','turf','scoop','full'),
  ('one-time-dog-poop-cleanup','run','scoop','full'), ('one-time-dog-poop-cleanup','patio','scoop','full'),
  ('yard-sanitizing','yard','sanitize','full'), ('yard-sanitizing','turf','sanitize','full'),
  ('yard-sanitizing','run','sanitize','full'), ('yard-sanitizing','patio','sanitize','full'),
  ('turf-deep-clean','turf','scoop','full'), ('turf-deep-clean','turf','debris','full'), ('turf-deep-clean','turf','brush','full'),
  ('turf-deep-clean','turf','vacuum','full'), ('turf-deep-clean','turf','wash','full'), ('turf-deep-clean','turf','enzyme','full'),
  ('turf-deep-clean','turf','sanitize','full'), ('turf-deep-clean','turf','rinse','full'),
  ('yard-deep-clean','yard','scoop','full'), ('yard-deep-clean','yard','debris','full'), ('yard-deep-clean','yard','cut_back','full'),
  ('yard-deep-clean','yard','weed','full'), ('yard-deep-clean','beds','debris','full'), ('yard-deep-clean','beds','cut_back','full'), ('yard-deep-clean','beds','weed','full'),
  ('weekly-turf-maintenance','turf','debris','full'), ('weekly-turf-maintenance','turf','enzyme','spot'), ('weekly-turf-maintenance','turf','sanitize','spot'),
  ('weekly-yard-maintenance','yard','mow','full'), ('weekly-yard-maintenance','yard','blow','full'), ('weekly-yard-maintenance','yard','debris','full'),
  ('weekly-yard-maintenance','patio','blow','full'), ('weekly-yard-maintenance','turf','debris','light'),
  ('extra-yard-work','yard','trim','full'), ('extra-yard-work','yard','weed','full'), ('extra-yard-work','yard','labor','full'),
  ('extra-yard-work','beds','trim','full'), ('extra-yard-work','beds','weed','full'), ('extra-yard-work','beds','labor','full'),
  ('dog-run-cleanups','run','scoop','full'), ('dog-run-cleanups','run','debris','full'), ('dog-run-cleanups','run','rinse','full'), ('dog-run-cleanups','run','enzyme','spot'),
  ('pressure-washing','patio','scoop','light'), ('pressure-washing','patio','wash','full'), ('pressure-washing','patio','rinse','full'),
  ('pressure-washing','run','scoop','light'), ('pressure-washing','run','wash','full'), ('pressure-washing','run','rinse','full'),
  ('kitty-litter-exchange','indoors','litter','full'), ('kitty-litter-exchange','indoors','box','full'),
  ('cat-tree-cleaning','indoors','tree','full'), ('kitty-litter-robot-cleaning','indoors','robot','full')
) v(s, z, t, d);

insert into service_relations (base_slug, other_slug, kind, customer_line, approved_by)
select b, o, k, l, 'ben (reasoned 2026-11-02)' from (values
  ('weekly-pooper-scooper-service','yard-sanitizing','add_on','Sanitize the yard on your first visit.'),
  ('weekly-pooper-scooper-service','dog-run-cleanups','add_on','Rake, hose and freshen the dog run or side yard.'),
  ('weekly-pooper-scooper-service','pressure-washing','add_on','Wash the patio while we are there.'),
  ('weekly-pooper-scooper-service','turf-deep-clean','add_on','Reset the turf on your first visit.'),
  ('weekly-pooper-scooper-service','yard-deep-clean','add_on','Clear the overgrowth on your first visit.'),
  ('one-time-dog-poop-cleanup','yard-sanitizing','add_on','Sanitize after the cleanup.'),
  ('one-time-dog-poop-cleanup','dog-run-cleanups','add_on','Rake, hose and freshen the dog run too.'),
  ('one-time-dog-poop-cleanup','pressure-washing','add_on','Wash the patio on the same visit.'),
  ('one-time-dog-poop-cleanup','turf-deep-clean','add_on','Deep clean the turf on the same visit.'),
  ('one-time-dog-poop-cleanup','yard-deep-clean','add_on','Clear the overgrowth on the same visit.'),
  ('one-time-dog-poop-cleanup','weekly-pooper-scooper-service','follow_on','Keep it clean with weekly scooping.'),
  ('one-time-dog-poop-cleanup','weekly-turf-maintenance','follow_on','Keep turf fresh with weekly Turf Deodorizing.'),
  ('yard-deep-clean','yard-sanitizing','add_on','Sanitize the yard when we finish.'),
  ('yard-deep-clean','dog-run-cleanups','add_on','Rake, hose and freshen the dog run too.'),
  ('yard-deep-clean','pressure-washing','add_on','Wash the patio on the same visit.'),
  ('yard-deep-clean','turf-deep-clean','add_on','Deep clean the turf too.'),
  ('yard-deep-clean','weekly-pooper-scooper-service','follow_on','Keep it clean with weekly scooping.'),
  ('yard-deep-clean','weekly-yard-maintenance','follow_on','Keep it looking good with weekly yard maintenance.'),
  ('turf-deep-clean','dog-run-cleanups','add_on','Rake, hose and freshen the dog run down the side too.'),
  ('turf-deep-clean','pressure-washing','add_on','Wash the patio on the same visit.'),
  ('turf-deep-clean','one-time-dog-poop-cleanup','add_on','Clean up the rest of the yard.'),
  ('turf-deep-clean','yard-deep-clean','add_on','Clear overgrowth in the rest of the yard.'),
  ('turf-deep-clean','weekly-turf-maintenance','follow_on','Keep it fresh with weekly Turf Deodorizing.'),
  ('turf-deep-clean','weekly-pooper-scooper-service','follow_on','Keep it clean with weekly scooping.'),
  ('weekly-turf-maintenance','weekly-pooper-scooper-service','add_on','Scoop the poop on the same weekly visit.'),
  ('weekly-turf-maintenance','dog-run-cleanups','add_on','Rake, hose and freshen the dog run on your first visit.'),
  ('weekly-turf-maintenance','pressure-washing','add_on','Wash the patio on your first visit.'),
  ('weekly-yard-maintenance','extra-yard-work','add_on','Add an hour for gardening or anything special.'),
  ('weekly-yard-maintenance','weekly-pooper-scooper-service','add_on','Scoop the poop on the same weekly visit.'),
  ('weekly-yard-maintenance','pressure-washing','add_on','Wash the patio on your first visit.'),
  ('weekly-yard-maintenance','yard-deep-clean','add_on','Clear the overgrowth on your first visit.'),
  ('dog-run-cleanups','yard-sanitizing','add_on','Sanitize the run when we finish.'),
  ('dog-run-cleanups','pressure-washing','add_on','Pressure wash a concrete run or the patio.'),
  ('dog-run-cleanups','one-time-dog-poop-cleanup','add_on','Clean up the rest of the yard.'),
  ('dog-run-cleanups','weekly-pooper-scooper-service','follow_on','Keep it clean with weekly scooping.'),
  ('pressure-washing','yard-sanitizing','add_on','Sanitize the washed area.'),
  ('pressure-washing','dog-run-cleanups','add_on','Rake, hose and freshen the dog run too.'),
  ('pressure-washing','one-time-dog-poop-cleanup','add_on','Clean up the yard on the same visit.'),
  ('pressure-washing','weekly-pooper-scooper-service','follow_on','Keep the yard clean with weekly scooping.'),
  ('kitty-litter-exchange','cat-tree-cleaning','add_on','Clean the cat tree on the same visit.'),
  ('kitty-litter-exchange','kitty-litter-robot-cleaning','add_on','Deep clean the Litter-Robot on the same visit.'),
  ('cat-tree-cleaning','kitty-litter-exchange','add_on','Exchange the litter on the same visit.'),
  ('cat-tree-cleaning','kitty-litter-robot-cleaning','add_on','Deep clean the Litter-Robot on the same visit.'),
  ('kitty-litter-robot-cleaning','kitty-litter-exchange','add_on','Exchange the litter in any other boxes.'),
  ('kitty-litter-robot-cleaning','cat-tree-cleaning','add_on','Clean the cat tree while the globe dries.')
) v(b, o, k, l);

-- Promises in the copy that had no row behind them now point at the real add-on.
update services set pricing_note = '50 cents a square foot. Solid waste removal is included before washing. Add yard sanitizing when you book.' where slug = 'pressure-washing';
update services set what_includes = array_replace(what_includes, 'Post-wash enzyme deodorizer application (optional)', 'Yard sanitizing available as an add-on') where slug = 'pressure-washing';
update services set pricing_note = replace(pricing_note, 'Enzyme deodorizing available as an add-on.', 'Add yard sanitizing when you book.') where slug = 'dog-run-cleanups';
commit;
