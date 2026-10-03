-- Reverts 044. Only safe while no payment names a quote.
begin;
drop index if exists payments_quote_idx;
alter table payments drop column if exists quote_id;
commit;
