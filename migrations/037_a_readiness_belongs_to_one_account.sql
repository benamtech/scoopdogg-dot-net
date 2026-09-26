-- Scoop Dogg — a readiness reading belongs to the account it was taken from, and to no other.
--
-- THE FAULT, MEASURED 2026-09-26. `stripe_connection` holds one row per mode, and that row
-- carries BOTH which account we are connected to (`account_id`) and what Stripe last said about
-- it (`card_payments_status`, `requirements_status`, `charges_enabled`, `last_probed_at`).
-- Nothing tied the two together. Point the row at a different account and the readiness columns
-- keep answering about the previous one, with a `last_probed_at` that looks current.
--
-- That is exactly what happened. The test row was pointed at acct_1UEYETPJf9xF2T6R — an account
-- Stripe reports as `charges_enabled: true, card_payments: active` — while the row still carried
-- `charges_enabled = false` measured minutes earlier against a different, unfinished account. No
-- error was raised anywhere: `paymentsReady()` read a confident false and sent every booking down
-- the request lane, on a site whose whole point is that the customer pays themselves.
--
-- WHY A TRIGGER AND NOT A RULE IN THE CODE. There are four writers of `account_id` today
-- (createConnectedAccount, the sandbox and fixture scripts, and the disconnect path) and the next
-- one will be written by somebody who has not read this file. A convention that every writer must
-- also clear five columns is a convention that gets forgotten once. The database can simply make
-- the stale state unrepresentable, and then it does not depend on anybody remembering.
--
-- WHAT IT DOES. On any update that changes `account_id`, the readiness columns are reset to
-- unknown: no status, no requirements, `charges_enabled = false`, and `last_probed_at = null`.
--
-- `last_probed_at = null` is the load-bearing half. `probeIsFresh()` treats a null as stale, so
-- the next caller that is about to take money re-asks Stripe instead of believing the row. The
-- state is therefore self-healing: it cannot sit wrong, it can only sit unknown until something
-- measures it. Unknown is fail-safe for money — it opens no checkout — and unlike the old
-- behaviour it is also honest, because nothing claims a reading it did not take.

-- Each check is one statement, because the rehearsal harness scores a statement by the boolean
-- it returns. The second and third are the pair that matters: changing the account forgets the
-- reading, and re-probing the SAME account does not — a trigger that cleared on every update
-- would pass the first and fail the second, which is why the second exists.

-- rehearse: select count(*) = 1 from pg_trigger where tgname = 'stripe_connection_account_changed'
-- rehearse: with u as (update stripe_connection set account_id = 'acct_rehearsal' where livemode = false returning *) select count(*) = 1 from u where account_id = 'acct_rehearsal' and last_probed_at is null and charges_enabled = false and card_payments_status is null and requirements_status is null and probe_error is null
-- rehearse: with u as (update stripe_connection set card_payments_status = 'active', requirements_status = 'none', charges_enabled = true, last_probed_at = now() where livemode = false returning *) select count(*) = 1 from u where card_payments_status = 'active' and charges_enabled = true and last_probed_at is not null
-- rehearse: with u as (update stripe_connection set display_name = 'rehearsal' where livemode = false returning *) select count(*) = 1 from u where card_payments_status = 'active' and last_probed_at is not null

begin;

create or replace function stripe_connection_forget_readiness() returns trigger as $$
begin
  -- Only when the account actually changes. A re-probe of the same account must be free to
  -- write its answer, which is the whole point of the columns.
  if new.account_id is distinct from old.account_id then
    new.card_payments_status := null;
    new.requirements_status  := null;
    new.charges_enabled      := false;
    new.last_probed_at       := null;
    new.probe_error          := null;
  end if;
  return new;
end;
$$ language plpgsql;

comment on function stripe_connection_forget_readiness() is
  'A readiness reading describes one connected account. When account_id changes the reading is discarded rather than inherited, so the row can be unknown but never wrong. Migration 037.';

drop trigger if exists stripe_connection_account_changed on stripe_connection;
create trigger stripe_connection_account_changed
  before update on stripe_connection
  for each row execute function stripe_connection_forget_readiness();

commit;
