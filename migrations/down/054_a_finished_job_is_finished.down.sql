begin;
update subscriptions set state = 'active' where state = 'completed';
alter table subscriptions drop constraint if exists subscriptions_state_check;
alter table subscriptions add constraint subscriptions_state_check
  check (state in ('draft','quote_ready','quote_accepted','deposit_pending','active','paused','cancelled'));
commit;
