-- Scoop Dogg — the catalog. Everything Josue grows the business WITH.
--
-- Ben, 2026-09-10: "most of the 'big-ness' will come from the admin naturally building
-- out with more team members, offers, higher prices, whatever etc etc"
--
-- That sentence is an architecture instruction. It means every dimension the business
-- can grow along has to be a ROW somebody adds in the admin, never a line of code and a
-- deploy. Today all eleven services, all sixteen cities and every price live in
-- TypeScript arrays inside a bundle: raising a price is a pull request.
--
-- These tables are the source of truth. The public site is BUILT from them:
--   1. `npm run content:pull` writes them into content/*.json as the first build step
--   2. publishing fires a Vercel deploy hook
--   3. `npm run content:push` exists for a change made in code or to repair a row
-- Wire all three or none - a CMS that writes to a database while the site renders from
-- committed files is two worlds, and the site silently serves the old copy. That has
-- already happened once on an AMTECH site.

begin;

-- ---------------------------------------------------------------------------
-- services — the offer list. Adding an offer is INSERT, not a deploy.
-- ---------------------------------------------------------------------------
create table services (
  slug            text primary key,
  name            text        not null,
  short_name      text        not null default '',
  kind            text        not null default 'recurring'
                    check (kind in ('recurring','one_time','addon')),
  -- what the price is measured in, which is what lets a booking price itself
  -- 'choice' is the one that is easy to miss: some services price on a CATEGORY the
  -- customer picks (yard size, buildup level), not on a number they type. Modelling
  -- those as a quantity asks the wrong question and quotes the wrong price.
  price_basis     text        check (price_basis in ('dogs','sqft','boxes','units','levels','choice','flat')),
  basis_label     text        not null default '',   -- "How many dogs?" on the booking form
  pricing_note    text        not null default '',
  sort_order      integer     not null default 100,
  status          text        not null default 'active'
                    check (status in ('draft','active','retired')),
  -- long-form marketing copy. Rendered into the static site by the build.
  meta_title      text, meta_description text, h1 text, intro text,
  what_includes   text[]      not null default '{}',
  who_its_for     text        not null default '',
  faqs            jsonb       not null default '[]'::jsonb,
  related_slugs   text[]      not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table services is
  'Retire, never delete. A retired service must keep resolving because old subscriptions, '
  'invoices and URLs still point at its slug.';

-- ---------------------------------------------------------------------------
-- service_tiers — the rate card. Raising prices is an UPDATE.
-- ---------------------------------------------------------------------------
create table service_tiers (
  id              uuid primary key default gen_random_uuid(),
  service_slug    text        not null references services(slug),
  label           text        not null,           -- "2 dogs", "Medium area (200-500 sq ft)"
  min_qty         integer,                        -- null = open lower bound
  max_qty         integer,                        -- null = open upper bound
  price_cents     integer,                        -- NULL means "quote required"
  price_suffix    text        not null default '',-- "/week", "/visit", "+"
  requires_quote  boolean     not null default false,
  price_is_from   boolean     not null default false,  -- "From $40" / "$50+": a floor, not a quote
  sort_order      integer     not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (price_cents is not null or requires_quote)
);
create index service_tiers_lookup_idx on service_tiers (service_slug, sort_order);
comment on table service_tiers is
  'Nine of Josue''s eleven services already end in a "custom quote" tier. That is the '
  'design, not a gap: the booking resolves a price when the quantity lands on a priced '
  'tier and raises a quote request when it does not.';
comment on column service_tiers.price_is_from is
  'A "from" price must never be shown as a final number. Josue publishes two of these '
  '("From $40/visit", "$50+") and presenting either as the price is how a customer '
  'arrives expecting one figure and gets another.';
comment on column service_tiers.price_cents is
  'Changing this changes what NEW customers are quoted. Existing subscriptions carry '
  'their own frozen price_cents and are untouched. That is the whole point.';

-- ---------------------------------------------------------------------------
-- service_areas — the map. Expanding is INSERT.
-- ---------------------------------------------------------------------------
create table service_areas (
  slug            text primary key,
  name            text        not null,
  county          text,
  state           text        not null default 'CA',
  tier            integer     not null default 2,   -- 1 = core, 2 = served, 3 = edge
  bookable        boolean     not null default true,
  market          text        not null default 'ventura-county',
  neighborhoods   text[]      not null default '{}',
  nearby_slugs    text[]      not null default '{}',
  meta_title      text, meta_description text, intro text, local_context text,
  faqs            jsonb       not null default '[]'::jsonb,
  sort_order      integer     not null default 100,
  status          text        not null default 'active'
                    check (status in ('draft','active','retired')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column service_areas.market is
  'The second market is a value in this column, not a second codebase. Scoop Dogg is one '
  'business - this is NOT multi-tenancy - but a business that opens in Santa Clarita '
  'should not need a developer.';
comment on column service_areas.bookable is
  'A city can have a page for search without being bookable yet. Publishing a page and '
  'opening a route are two different decisions and this is how they stay separate.';

-- what is actually offered where. Empty means "every active service".
create table service_area_offers (
  service_slug  text not null references services(slug),
  area_slug     text not null references service_areas(slug),
  primary key (service_slug, area_slug)
);

-- ---------------------------------------------------------------------------
-- offers — promotions. He already runs one: "First month half off when
-- combined with weekly poop scooping." Today it is a sentence in a bundle.
-- ---------------------------------------------------------------------------
create table offers (
  id                uuid primary key default gen_random_uuid(),
  code              text        unique,             -- null = automatic, no code to type
  name              text        not null,
  description       text        not null default '',
  kind              text        not null check (kind in ('percent_off','amount_off','free_visits')),
  value             integer     not null,           -- percent, cents, or a visit count
  applies_to_slugs  text[]      not null default '{}',  -- empty = anything
  requires_slugs    text[]      not null default '{}',  -- the "when combined with" rule
  first_n_visits    integer,
  max_redemptions   integer,
  redeemed_count    integer     not null default 0,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            text        not null default 'draft'
                      check (status in ('draft','active','paused','expired')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table offer_redemptions (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid        not null references offers(id),
  customer_id     uuid        not null references customers(id),
  subscription_id uuid        references subscriptions(id),
  invoice_id      uuid        references invoices(id),
  amount_cents    integer     not null,
  created_at      timestamptz not null default now()
);
create index offer_redemptions_offer_idx on offer_redemptions (offer_id);

-- ---------------------------------------------------------------------------
-- articles — the 6 resource pages, editable for the same reason
-- ---------------------------------------------------------------------------
create table articles (
  slug          text primary key,
  title         text        not null,
  meta_title    text, meta_description text,
  body          jsonb       not null default '[]'::jsonb,   -- the section structure
  sources       jsonb       not null default '[]'::jsonb,
  published_at  timestamptz,
  status        text        not null default 'draft'
                  check (status in ('draft','active','retired')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reviews — 18 real ones today, and more arrive every month
-- ---------------------------------------------------------------------------
create table reviews (
  id             text primary key,
  author_name    text        not null,
  author_badge   text,
  quote          text        not null,
  rating         integer     check (rating between 1 and 5),
  source         text        not null default 'google',
  source_url     text,
  reviewed_on    text,                                  -- "3 months ago", as published
  featured       boolean     not null default false,
  sort_order     integer     not null default 100,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- publishing — a page is only live when a build carried it
-- ---------------------------------------------------------------------------
create table content_publishes (
  id            bigserial primary key,
  requested_by  text        not null,
  reason        text        not null default '',
  deploy_hook   text,                                   -- which hook fired, not its secret
  state         text        not null default 'pending'
                  check (state in ('pending','building','live','failed')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
comment on table content_publishes is
  'The admin must never print "published" when nothing can carry the change. It says '
  'which of the two happened: the row is saved, and the deploy is queued/live/failed.';

do $$
declare t text;
begin
  foreach t in array array['services','service_tiers','service_areas','offers','articles'] loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()',
      t, t);
  end loop;
end $$;

commit;
