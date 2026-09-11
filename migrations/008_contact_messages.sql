-- Scoop Dogg — the contact form's messages.
--
-- 001 modelled `messages` as the thread between a KNOWN customer and the business. A
-- contact-form message is a different thing: a stranger with a question, who has no
-- customer record and may never become one. Folding them together would either force a
-- fake customer row per enquiry or leave `customer_id` nullable and meaningless.
--
-- The old database had this table with 0 rows. It is recreated rather than restored,
-- and the contact form now posts to /api/contact instead of inserting from the browser.

begin;

create table contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  email       text        not null,
  phone       text        not null default '',
  subject     text        not null default '',
  message     text        not null,
  source_page text        not null default '',
  status      text        not null default 'unread'
                check (status in ('unread','read','replied','spam')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index contact_messages_status_idx on contact_messages (status, created_at desc);

create trigger contact_messages_touch before update on contact_messages
  for each row execute function touch_updated_at();

commit;
