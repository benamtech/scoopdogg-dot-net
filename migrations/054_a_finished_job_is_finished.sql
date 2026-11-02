-- Scoop Dogg — a one-time job ends. It had no end state, so a finished $179 job stayed "active" for
-- ever, counted as a customer and as money due. `completed` is the terminal state for work that does
-- not renew; `activated_at`, the visit and the invoice stay as the record.

-- rehearse: select pg_get_constraintdef(oid) like '%completed%' from pg_constraint where conname = 'subscriptions_state_check'

begin;
alter table subscriptions drop constraint if exists subscriptions_state_check;
alter table subscriptions add constraint subscriptions_state_check
  check (state in ('draft','quote_ready','quote_accepted','deposit_pending','active','paused','cancelled','completed'));
commit;
