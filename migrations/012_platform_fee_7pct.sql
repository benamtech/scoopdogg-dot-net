-- Scoop Dogg — AMTECH's platform fee is 7% (Ben, 2026-09-16: "we will do 7% platform fee").
--
-- Reconciles the open question recorded since 2026-09-10: 4% in the settings seed against 7% in
-- brain/revenue-model.md. The fee is frozen onto each subscription at checkout through
-- application_fee_percent, so this changes future bookings only; nothing already charged moves.

-- rehearse: select (select value from settings where key = 'billing.platform_fee_bps') = '700'::jsonb
-- rehearse: select count(*) = 0 from stripe_connection where platform_fee_bps <> 700

begin;

update settings set value = '700'::jsonb, updated_by = 'ben:2026-09-16', updated_at = now()
 where key = 'billing.platform_fee_bps';

update stripe_connection set platform_fee_bps = 700, updated_at = now();
alter table stripe_connection alter column platform_fee_bps set default 700;

commit;
