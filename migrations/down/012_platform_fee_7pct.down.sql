begin;
update settings set value = '400'::jsonb, updated_by = 'revert-012' where key = 'billing.platform_fee_bps';
update stripe_connection set platform_fee_bps = 400;
alter table stripe_connection alter column platform_fee_bps set default 400;
delete from _migrations where name = '012_platform_fee_7pct.sql';
commit;
