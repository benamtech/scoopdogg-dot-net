-- Scoop Dogg — retire what the deploy-hook publish left behind (2026-09-30).
--
-- An owner's edit is live on the pages with no rebuild (src/middleware.ts renders from the rows,
-- server/lib/site-cache.ts purges on save), so the publish path built on 2026-09-27 was removed in
-- code on 2026-09-29. Two things only it used remain in the database, each with no reader:
--   - the settings row `catalog.public_pages_need_publish`;
--   - the table `content_publishes` (migration 003). It held 0 rows when this was written
--     (measured 2026-09-30); the rehearse line below refuses to drop it if that is no longer true.

-- rehearse: select count(*) = 0 from settings where key = 'catalog.public_pages_need_publish'
-- rehearse: select to_regclass('public.content_publishes') is null

begin;
do $$ begin
  if (select count(*) from content_publishes) > 0 then
    raise exception 'content_publishes is not empty; refusing to drop it';
  end if;
end $$;
delete from settings where key = 'catalog.public_pages_need_publish';
drop table content_publishes;
commit;
