-- Scoop Dogg — the visits people actually ask for by name. A bundle is a set of services for a moment:
-- a hyperedge over the services, which a pair of services cannot say. It has no price of its own and no
-- discount: the customer picks sizes and pays the sum. Members are add-ons of the base job, and a gate
-- holds that, so a bundle can never offer something that does not go together.
-- From lead notes: a graduation party with turf to freshen, a birthday needing yard, floor wash and
-- deodorizer, tenants moved out, previous tenants' mess.

-- rehearse: select count(*) = 2 from bundles
-- rehearse: select count(*) >= 4 from bundle_members

begin;
create table bundles (slug text primary key, name text not null, customer_line text not null,
  base_slug text not null references services(slug) on update cascade, sort_order int not null default 0);
create table bundle_members (bundle_slug text not null references bundles(slug), service_slug text not null references services(slug) on update cascade,
  primary key (bundle_slug, service_slug));
insert into bundles (slug, name, customer_line, base_slug, sort_order) values
  ('before-a-party', 'Getting ready for a party', 'A clean yard, a sanitized lawn and a washed patio, on one visit.', 'one-time-dog-poop-cleanup', 10),
  ('move-out', 'Moving out or between tenants', 'Cleanup, the dog run and the hard surfaces, on one visit.', 'one-time-dog-poop-cleanup', 20);
insert into bundle_members (bundle_slug, service_slug) values
  ('before-a-party', 'yard-sanitizing'), ('before-a-party', 'pressure-washing'),
  ('move-out', 'dog-run-cleanups'), ('move-out', 'pressure-washing');
commit;
