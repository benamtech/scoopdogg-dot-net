-- Scoop Dogg — a subscription can be in a trial, and the database has to be able to say so.
--
-- P16 §5 lane B: the customer saves a card and nothing is charged until the day after their first
-- visit. Stripe models that as a subscription with a trial; on our side it is a payment_state,
-- and `011_packages_money_schedule.sql` wrote that column as a check constraint over
-- ('none','pending','ok','past_due','unpaid'). So this is a constraint migration, not a code
-- change, and skipping it would make lane B fail at the database with a 23514 the customer would
-- read as "something went wrong on our side".
--
-- THE DOWN IS THE INTERESTING HALF. Restoring the old constraint fails outright if a `trialing`
-- row exists, and a revert that cannot run is not a revert. P16 §9 says so explicitly: the down
-- moves those rows to `pending` first. `pending` is the honest destination - the money has not
-- moved, which is exactly what pending means - and it is what the row would have said before lane
-- B existed.

-- rehearse: select pg_get_constraintdef(oid) like '%trialing%' from pg_constraint where conname = 'subscriptions_payment_state_check'
-- rehearse: select count(*) = 0 from subscriptions where payment_state = 'trialing'
-- rehearse: select count(*) = 1 from pg_constraint where conname = 'subscriptions_payment_state_check'

begin;

alter table subscriptions drop constraint subscriptions_payment_state_check;
alter table subscriptions add constraint subscriptions_payment_state_check
  check (payment_state in ('none','pending','ok','past_due','unpaid','trialing'));

comment on column subscriptions.payment_state is
  'trialing means lane B: the card is saved and Stripe charges on the day the trial ends. The '
  'customer''s own account screen must show that date - a trial a customer cannot see is a '
  'surprise charge (P16 §8).';

commit;
