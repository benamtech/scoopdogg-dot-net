-- Revert 022. A trialing row becomes pending FIRST, or the constraint below refuses to be added
-- and the revert dies half-applied.
begin;
update subscriptions set payment_state = 'pending', updated_at = now() where payment_state = 'trialing';
alter table subscriptions drop constraint subscriptions_payment_state_check;
alter table subscriptions add constraint subscriptions_payment_state_check
  check (payment_state in ('none','pending','ok','past_due','unpaid'));
comment on column subscriptions.payment_state is null;
delete from _migrations where name = '022_payment_state_trialing.sql';
commit;
