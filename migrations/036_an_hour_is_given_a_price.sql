-- Scoop Dogg — an hour of Josue's time is given a price, and the board says it is an assumption.
--
-- WHAT MIGRATION 031 LEFT OUT, AND WHY IT WAS RIGHT THEN. 031 deliberately did not seed
-- `routing.cost_per_hour_cents`: nobody had asked Josue what an hour of his time costs, so every
-- money figure on the growth board reported `measured: false` and printed a dash. That was honest.
-- It also meant the board could never say what the next customer in a town is worth, only how
-- many minutes of driving he costs — and nobody was ever going to ask.
--
-- WHAT THIS SETS. $70.00 an hour, decided rather than measured. Two sources, independent of each
-- other, land on the same figure (research R14 §0):
--
--   - $70 an hour is what an hour of a working California landscaping business should earn.
--   - Pet Butler's FY2025 Franchise Disclosure Document, Item 19, reports revenue per stop and
--     stops per hour for 39 pet-waste route businesses: $19.45 x 3.60 = $70.02 an hour average.
--
-- It is the VALUE of his hour, not his wage and not his van: a margin at $70 says whether a visit
-- earns what a trade business's hour should, which is the question the board is for. It is not a
-- figure from his books, so density.ts prints every money value as `assumed: true` with the basis
-- below beside it, never as `measured`. When Josue names his own number it is one row.
--
-- NOT SET: `routing.cost_per_mile_cents`. The driving is already costed by the hour, and a
-- per-mile figure on top would count the same drive twice.

-- rehearse: select count(*) = 1 from settings where key = 'routing.cost_per_hour_cents' and value = '7000'::jsonb
-- rehearse: select count(*) = 1 from settings where key = 'routing.cost_per_hour_basis' and length(value #>> '{}') > 40
-- rehearse: select count(*) = 0 from settings where key = 'routing.cost_per_mile_cents'

begin;

insert into settings (key, value, updated_by) values
  ('routing.cost_per_hour_cents', '7000'::jsonb, 'migration:036'),
  ('routing.cost_per_hour_basis',
   '"An assumption, not a figure from your books: $70 an hour is what an hour of a pet-waste route earns on average across 39 Pet Butler businesses (their 2025 franchise filing). Once your own figure is set, every number here follows it."'::jsonb,
   'migration:036')
on conflict (key) do nothing;

commit;
