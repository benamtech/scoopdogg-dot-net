-- Scoop Dogg — AMTECH's platform fee is 9% (Josue agreed the terms 2026-09-18; P17).
--
-- Supersedes 012's 700 bps, which superseded the 400 in the settings seed. This is the last move:
-- the number is in a signed commercial agreement now, not in a plan document.
--
-- THIS CHANGES NEW BOOKINGS ONLY, and not because of a rule somebody has to remember. The fee is
-- frozen onto each subscription at checkout through `application_fee_percent`, so a subscription
-- already sold keeps the percentage it was sold on. There are none yet — no payment has ever been
-- taken by this system — which is exactly why the window to set it is now.
--
-- What 900 bps does NOT reach, and why step 2 is more than this file: Stripe's own words are that
-- `application_fee_percent` "doesn't apply to invoices you create outside of a subscription
-- billing period". A one-time yard deep clean booked through the site would pay AMTECH nothing.
-- server/lib/money.ts and gates/one-money-door.mjs are the half of the decision that this
-- migration cannot express.

-- rehearse: select (select value from settings where key = 'billing.platform_fee_bps') = '900'::jsonb
-- rehearse: select count(*) = 0 from stripe_connection where platform_fee_bps <> 900
-- rehearse: select count(*) = 2 from stripe_connection where platform_fee_bps = 900
-- rehearse: select (select column_default from information_schema.columns where table_name = 'stripe_connection' and column_name = 'platform_fee_bps') = '900'

begin;

update settings set value = '900'::jsonb, updated_by = 'josue-agreement:2026-09-18', updated_at = now()
 where key = 'billing.platform_fee_bps';

update stripe_connection set platform_fee_bps = 900, updated_at = now();
alter table stripe_connection alter column platform_fee_bps set default 900;

commit;
