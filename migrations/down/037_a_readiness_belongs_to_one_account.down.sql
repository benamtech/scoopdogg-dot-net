-- Reverse of 037. The readiness columns go back to being inheritable across an account change,
-- which is the state that let a false negative sit on a chargeable account. Reverting restores
-- that hazard; it does not restore any data, because the trigger only ever cleared state.

begin;

drop trigger if exists stripe_connection_account_changed on stripe_connection;
drop function if exists stripe_connection_forget_readiness();

commit;
