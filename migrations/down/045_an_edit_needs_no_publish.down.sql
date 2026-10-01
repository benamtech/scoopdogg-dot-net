-- Reverts 045: the table as migration 003 made it (empty, as it was), and the settings row as 040 made it.
begin;
create table content_publishes (
  id            bigserial primary key,
  requested_by  text        not null,
  reason        text        not null default '',
  deploy_hook   text,
  state         text        not null default 'pending'
                  check (state in ('pending','building','live','failed')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
comment on table content_publishes is
  'The admin must never print "published" when nothing can carry the change. It says '
  'which of the two happened: the row is saved, and the deploy is queued/live/failed.';
insert into settings (key, value, updated_by) values ('catalog.public_pages_need_publish', 'true'::jsonb, 'migration:040');
commit;
