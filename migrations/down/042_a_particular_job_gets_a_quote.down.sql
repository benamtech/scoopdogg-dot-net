-- Reverse of 042. Quotes, their lines and the request photos are DROPPED: a revert after a quote
-- has been sent loses the record of what the customer was offered and agreed to. The subscriptions
-- a quote created stay, with source 'quote' rewritten to 'admin' so the old constraint holds.
begin;
update subscriptions set source = 'admin' where source = 'quote';
alter table subscriptions drop constraint subscriptions_source_check;
alter table subscriptions add constraint subscriptions_source_check check (source in ('online', 'admin', 'import'));
drop table if exists quote_lines;
drop table if exists quotes;
drop sequence if exists quote_number_seq;
drop table if exists lead_photos;
drop index if exists leads_request_token_idx;
alter table leads drop column if exists first_response_at, drop column if exists request_token, drop column if exists postal_code,
  drop column if exists contact_pref, drop column if exists timing, drop column if exists job_kinds, drop column if exists kind;
delete from settings where key in ('quote.deposit_percent','quote.valid_days','quote.reply_promise','quote.typical_range',
  'quote.photos_max','quote.photo_max_bytes','business.license_number','business.license_class',
  'business.legal_name','business.mailing_address','contract.cgl','contract.workers_comp');
commit;
