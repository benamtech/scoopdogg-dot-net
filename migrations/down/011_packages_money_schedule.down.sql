-- Revert 011. Rehearsed against a restore of the 2026-09-16 Neon dump before 011 touched
-- the live database (scripts/rehearse-migration.mjs). Settings go back to the exact prior
-- values recorded in 011's comments, not to a guess.
begin;

update settings set value = '"after_visit"'::jsonb, updated_by = 'revert-011' where key = 'billing.charge_timing';
update settings set value = '"none"'::jsonb,        updated_by = 'revert-011' where key = 'billing.deposit_mode';
update settings set value = 'false'::jsonb,         updated_by = 'revert-011' where key = 'billing.card_on_file_required';
delete from settings where key in ('schedule.day_capacity','booking.start_window_days','booking.initial_cleanup_policy',
                                   'booking.card_required','billing.monthly_factor','billing.package_prices_confirmed')
  and updated_by = 'seed';

update service_areas set market = 'nearby', market_label = '' where slug in ('santa-barbara','carpinteria','malibu');
update service_areas set market = 'ventura-county', market_label = ''
 where slug in ('ventura','oxnard','camarillo','ojai','oak-view','santa-paula','fillmore','moorpark','simi-valley',
                'thousand-oaks','newbury-park','westlake-village','agoura-hills');
alter table service_areas drop column if exists service_weekdays;
alter table service_areas drop column if exists market_label;

drop index if exists subscriptions_stripe_sub_idx;
alter table subscriptions drop column if exists package_id, drop column if exists package_version,
  drop column if exists monthly_price_cents, drop column if exists livemode, drop column if exists account_id,
  drop column if exists stripe_subscription_id, drop column if exists stripe_customer_id, drop column if exists area_slug,
  drop column if exists current_period_end, drop column if exists cancel_at_period_end, drop column if exists payment_state,
  drop column if exists extras, drop column if exists discount, drop column if exists booking_answers, drop column if exists source;
alter table subscriptions drop constraint if exists subscriptions_frequency_check;
alter table subscriptions add constraint subscriptions_frequency_check
  check (frequency in ('weekly','biweekly','monthly','one_time'));

alter table offers drop column if exists stripe_coupon_ids;
delete from offers where name in ('First month half off','Turf maintenance: first month half off with scooping');

drop table if exists stripe_prices;
drop trigger if exists packages_version on packages;
drop function if exists packages_bump_version();
drop table if exists packages;

drop index if exists invoices_stripe_invoice_idx;
alter table invoices drop column if exists livemode, drop column if exists account_id,
  drop column if exists hosted_invoice_url, drop column if exists subscription_id;
alter table payments drop column if exists livemode;
alter table payment_methods drop column if exists livemode, drop column if exists account_id;
drop table if exists stripe_customers;

alter table stripe_connection drop column if exists display_name, drop column if exists card_payments_status,
  drop column if exists requirements_status;
-- Back to exactly one row. The live row (livemode=true) is the one that existed before 011.
delete from stripe_connection where livemode = false;
alter table stripe_connection drop constraint stripe_connection_pkey;
alter table stripe_connection add column id boolean not null default true check (id);
alter table stripe_connection add primary key (id);

delete from _migrations where name = '011_packages_money_schedule.sql';
commit;
