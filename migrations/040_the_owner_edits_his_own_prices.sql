-- Scoop Dogg — the owner edits his own prices, and every change says who and what it was.
--
-- WHAT THE CATALOG COULD NOT DO. Every price on this site has only ever been changed by a
-- migration. `api/admin.ts` has no price-editing route at all — `checklist/prices/confirm` is a
-- confirm, which stamps `confirmed_at`/`confirmed_by`/`source` and never touches a number. So
-- "raise a price" has meant a pull request, and that is the one change the owner makes most.
--
-- THREE THINGS WERE MISSING AND NONE OF THEM IS VERSIONING.
--
--   1. `service_tiers` has no `status`. `services` and `service_areas` both have one, and P7's
--      rule is "retire, never delete — old subscriptions, invoices and inbound links still
--      resolve through the slug". A tier editor with only DELETE on the screen would break that
--      rule the first time it was used, so the column comes before the screen.
--   2. Nothing records WHO changed a price. `updated_at` exists on all three catalog tables and
--      `updated_by` on none, so the audit answer to "who put the weekly plan up ten dollars" was
--      nobody.
--   3. Nothing records WHAT IT WAS. For packages there is an accidental history —
--      `stripe_prices` keeps a row per version — but it is a side effect of Stripe publishing and
--      it holds nothing for the 34 tiers, which carry most of the prices on the site.
--
-- VERSIONING IS ALREADY DONE AND IS NOT RE-DONE HERE. `packages.version` is bumped by the
-- `packages_version` trigger (migration 011) whenever `monthly_price_cents` changes, and
-- `stripe_prices` is keyed on (package_id, livemode, account_id, version), so a new version mints
-- a NEW Stripe Price and cannot mutate the one a live subscription points at. Grandfathering is
-- structural and predates this migration; the screen's job is to make the owner believe a thing
-- that is already true, not to implement it.
--
-- WHY AN AUDIT TABLE RATHER THAN THE `events` SPINE. `events.subject_kind` is a closed list of
-- things that happen to a CUSTOMER'S money — customer, subscription, visit, invoice, booking,
-- waitlist, team — and its rows are hash-chained per subject. A catalog price is not one of
-- those and widening that list to admit it would put shop admin into a spine whose whole value
-- is that it only holds the other thing.
--
-- `catalog_changes` is deliberately append-only and deliberately dumb: one row per field that
-- actually moved, the old value and the new one as text, who and when. It is what lets the rate
-- card show "you raised this on the 4th, from $120" — which is the sentence that makes an owner
-- trust an editor enough to use it.

-- rehearse: select count(*) = 34 from service_tiers where status = 'active'
-- rehearse: select count(*) = 0 from service_tiers where status is null
-- rehearse: select count(*) = 3 from information_schema.columns where column_name = 'updated_by' and table_name in ('services', 'service_tiers', 'packages')
-- rehearse: select to_regclass('public.catalog_changes') is not null
-- rehearse: select count(*) = 0 from catalog_changes
-- rehearse: select (select value #>> '{}' from settings where key = 'catalog.public_pages_need_publish') = 'true'

begin;

-- 1. A tier can be retired. It is never deleted, because a package points at it and an invoice
--    line already sold it.
alter table service_tiers add column if not exists status text not null default 'active';
alter table service_tiers drop constraint if exists service_tiers_status_check;
alter table service_tiers add constraint service_tiers_status_check check (status in ('active', 'retired'));

comment on column service_tiers.status is
  'active or retired. NEVER deleted: packages.tier_id points here, invoice lines already sold it, '
  'and a retired tier must keep resolving for everything that already happened. A retired tier '
  'is not offered to a new customer and is not shown on a public page.';

-- 2. A price change has an author.
alter table services      add column if not exists updated_by text;
alter table service_tiers add column if not exists updated_by text;
alter table packages      add column if not exists updated_by text;

comment on column packages.updated_by is
  'The admin email that last changed this row, or a migration tag. Null on every row seeded '
  'before the rate card existed, which is honest: nobody knows who set those and a default would '
  'invent an answer.';

-- 3. A price change has a before.
create table if not exists catalog_changes (
  id          uuid primary key default gen_random_uuid(),
  entity      text        not null check (entity in ('service', 'tier', 'package', 'offer')),
  entity_id   uuid        not null,
  -- What a person calls the thing, frozen at the moment of the change, so the history still
  -- reads correctly after the label itself is edited.
  entity_label text       not null,
  field       text        not null,
  old_value   text,
  new_value   text,
  changed_by  text        not null,
  changed_at  timestamptz not null default now()
);

create index if not exists catalog_changes_entity_idx on catalog_changes (entity, entity_id, changed_at desc);
create index if not exists catalog_changes_recent_idx on catalog_changes (changed_at desc);

comment on table catalog_changes is
  'APPEND ONLY. One row per field that actually moved — a save that changes nothing writes '
  'nothing. Values are text because this is a record of what was typed, not a second place to '
  'compute from: nothing reads it to price anything. It exists so the rate card can say "you '
  'raised this on the 4th, from $120", which is what makes a price editor trustworthy enough to '
  'use. Not events: that spine is a hash-chained record of what happens to a customer''s money, '
  'and shop admin does not belong in it.';

-- 4. The thing the screen must say out loud, as a row rather than a sentence in a component.
--
--    The public pages are built from content/catalog.json, which scripts/pull-catalog.mjs writes
--    as step one of `npm run build`. A saved price is live in the checkout and in the admin
--    IMMEDIATELY — server/lib/catalog-db.ts queries the rows on every request — and live on a
--    public page NOT AT ALL until a rebuild and a deploy. The demo toggle already returns
--    `effective_now` and `effective_on_publish` for exactly this reason (api/admin.ts:225).
--
--    It is a setting rather than a constant so that the day the price-bearing pages move to
--    on-demand rendering, the sentence the owner reads stops being true and stops being printed,
--    in one row, without a component edit.
insert into settings (key, value, updated_by) values
  ('catalog.public_pages_need_publish', 'true'::jsonb, 'migration:040')
on conflict (key) do nothing;

commit;
