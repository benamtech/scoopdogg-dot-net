-- Reverse of 038. The trigger goes back to 037's behaviour: it fires on update only, and an
-- account-less row may once again hold a verdict about an account that is not there.
--
-- The cleared values are NOT restored. They were a claim measured against a credential that
-- has since been re-measured and found usable; putting the sentence back would restore a
-- statement nobody believes, which is worse than the blank.

begin;

create or replace function stripe_connection_forget_readiness() returns trigger as $$
begin
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
