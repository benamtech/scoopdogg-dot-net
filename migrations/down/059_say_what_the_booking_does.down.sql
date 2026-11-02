-- The wording in 059 corrects statements the booking contradicted; putting them back would put the
-- contradictions back. The two settings return to what they said before.
begin;
update settings set value = '"52/12"'::jsonb, updated_at = now() where key = 'billing.monthly_factor';
update settings set value = '42'::jsonb, updated_at = now() where key = 'reviews.google_count';
update settings set value = '"2026-09-23"'::jsonb, updated_at = now() where key = 'reviews.google_checked_on';
commit;
