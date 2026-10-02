-- Scoop Dogg — a cash or Venmo payment on a custom job names the job (2026-09-30).
--
-- 043 gave a manual payment its method and note. The first draft of the Jobs screen then linked a
-- payment to its job by matching "quote #N" in the note, which counts a payment on quote #110
-- towards quote #11. A foreign key cannot make that mistake.

-- rehearse: select count(*) = 1 from information_schema.columns where table_name = 'payments' and column_name = 'quote_id'

begin;
alter table payments add column if not exists quote_id uuid references quotes(id);
create index if not exists payments_quote_idx on payments (quote_id) where quote_id is not null;
commit;
