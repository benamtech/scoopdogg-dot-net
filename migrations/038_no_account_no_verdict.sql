-- Scoop Dogg — a connection with no account holds no verdict about one.
--
-- WHAT 037 LEFT OPEN. 037 discards a readiness reading when `account_id` CHANGES. It cannot
-- help a row whose account_id was null the whole time and which picked up a verdict anyway,
-- and that is the live row: since 2026-09-12 it has carried
--
--   probe_error = 'Restricted key authenticates but has no Connect permissions'
--
-- with no account connected. That sentence was true of a restricted key on 2026-09-12 and was
-- retired by measurement on 2026-09-19. Re-measured again 2026-09-26: the live platform key
-- (acct_1U32DNArurqL9aP3) reads the platform account, lists connected accounts, creates
-- onboarding links and creates setup intents — `connect usable: YES`. The row has been wrong
-- for two weeks and nothing made it say so.
--
-- THE TWO WRITERS, AND THE COLUMN THEY DISAGREE ABOUT. `probe_error` has two authors who mean
-- different things by it. `probeAccount()` means "the probe of the CONNECTED ACCOUNT failed".
-- `scripts/probe-stripe.mjs --write` means "the PLATFORM KEY lacks Connect scope". The second
-- is a fact about a credential, not about this connection, and it is the one that got stuck.
-- probe-stripe already prints its finding; it does not need to persist it into a column that
-- means something else, and nothing reads the column to tell them apart.
--
-- WHAT THIS DOES. The same trigger now also enforces the simpler invariant: with `account_id`
-- null there is nothing to have measured, so the readiness columns and the error are empty.
-- It runs on INSERT as well as UPDATE, because the upsert in probe-stripe.mjs is an insert on
-- a fresh database and would otherwise seed the same stale claim on day one.
--
-- It is not a rule any writer has to remember, which is the point: the row can be unknown, and
-- it can be measured, and it can no longer be confidently wrong.

-- rehearse: select count(*) = 0 from stripe_connection where account_id is null and (probe_error is not null or card_payments_status is not null or charges_enabled)
-- rehearse: with u as (update stripe_connection set probe_error = 'stale claim', charges_enabled = true, card_payments_status = 'active' where account_id is null returning *) select count(*) = 1 from u where probe_error is null and charges_enabled = false and card_payments_status is null
-- rehearse: with u as (update stripe_connection set probe_error = 'a real account failure' where livemode = false returning *) select count(*) = 1 from u where probe_error = 'a real account failure'
-- rehearse: select count(*) = 1 from pg_trigger where tgname = 'stripe_connection_account_changed' and tgtype & 4 = 4

begin;

create or replace function stripe_connection_forget_readiness() returns trigger as $$
begin
  -- 037: a reading describes one account. Change the account, discard the reading.
  if tg_op = 'UPDATE' and new.account_id is distinct from old.account_id then
    new.card_payments_status := null;
    new.requirements_status  := null;
    new.charges_enabled      := false;
    new.last_probed_at       := null;
    new.probe_error          := null;
  end if;

  -- 038: no account, no verdict. Applies however the row got here, including an insert.
  -- `last_probed_at` is deliberately left alone: when we last ASKED is still true, and
  -- probeIsFresh() reads it beside a null status, which is already "unknown".
  if new.account_id is null then
    new.card_payments_status := null;
    new.requirements_status  := null;
    new.charges_enabled      := false;
    new.probe_error          := null;
  end if;

  return new;
end;
$$ language plpgsql;

comment on function stripe_connection_forget_readiness() is
  'A readiness reading describes one connected account. It is discarded when account_id changes (037) and cannot exist at all while account_id is null (038), so the row can be unknown but never wrong.';

drop trigger if exists stripe_connection_account_changed on stripe_connection;
create trigger stripe_connection_account_changed
  before insert or update on stripe_connection
  for each row execute function stripe_connection_forget_readiness();

-- And clear what is already stuck. The trigger cannot reach a row nobody updates.
update stripe_connection
   set card_payments_status = null, requirements_status = null, charges_enabled = false,
       probe_error = null, updated_at = now()
 where account_id is null
   and (probe_error is not null or card_payments_status is not null or charges_enabled);

commit;
