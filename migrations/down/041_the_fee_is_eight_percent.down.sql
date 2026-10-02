-- Reverts 041: back to 015's 900 bps.
begin;
update settings set value = '900'::jsonb, updated_by = 'revert:041', updated_at = now() where key = 'billing.platform_fee_bps';
update stripe_connection set platform_fee_bps = 900, updated_at = now();
alter table stripe_connection alter column platform_fee_bps set default 900;
commit;
