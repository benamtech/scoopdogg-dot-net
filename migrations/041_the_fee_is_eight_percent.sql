-- Scoop Dogg — AMTECH's platform fee is 8%. Ben, 2026-09-27: "i told josue 8 in the meeting."
--
-- Supersedes 015's 900 bps. The 8% was recorded as an intention on 2026-09-26 and never actioned,
-- so the site, the brain and the agreement said 9 while the owner had been told 8. This is the
-- number he was told, and the one the agreement will carry.
--
-- NEW CHARGES ONLY, by construction rather than by rule: a subscription freezes the percentage it
-- was sold on (`application_fee_percent`), and one-time charges read this row at the moment they
-- are created. No live payment has ever been taken (the live connection has no account yet), so
-- nothing real was sold at 9%.

-- rehearse: select (select value from settings where key = 'billing.platform_fee_bps') = '800'::jsonb
-- rehearse: select count(*) = 0 from stripe_connection where platform_fee_bps <> 800
-- rehearse: select (select column_default from information_schema.columns where table_name = 'stripe_connection' and column_name = 'platform_fee_bps') = '800'

begin;

update settings set value = '800'::jsonb, updated_by = 'ben:2026-09-27', updated_at = now()
 where key = 'billing.platform_fee_bps';

update stripe_connection set platform_fee_bps = 800, updated_at = now();
alter table stripe_connection alter column platform_fee_bps set default 800;

commit;
