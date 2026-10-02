-- Revert 015: back to 700 bps, which is what 012 set. A subscription already sold carries its own
-- application_fee_percent and is untouched either way.
begin;
update settings set value = '700'::jsonb, updated_by = 'revert-015', updated_at = now() where key = 'billing.platform_fee_bps';
update stripe_connection set platform_fee_bps = 700, updated_at = now();
alter table stripe_connection alter column platform_fee_bps set default 700;
delete from _migrations where name = '015_platform_fee_9pct.sql';
commit;
