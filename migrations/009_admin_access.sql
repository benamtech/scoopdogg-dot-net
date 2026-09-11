-- Scoop Dogg — admin access.
--
-- The old site had a working admin at /admin gated by Supabase Auth against an
-- `admin_whitelist` of three emails. The rebuild dropped it; this restores the access
-- model without Supabase Auth. Email is the login, a six-digit code is the proof, and the
-- session is a row in this database behind an httpOnly cookie. No password to lose and no
-- token in the browser.
--
-- team_members had no email, because the crew is phone-first and the admin is email-first.
-- Both are true, so both columns exist and each is unique only where present.

begin;

alter table team_members
  add column if not exists email text,
  add column if not exists last_login_at timestamptz;

alter table team_members alter column phone drop not null;

-- phone was `text not null unique`, so the index is owned by a CONSTRAINT and
-- DROP INDEX refuses it. Drop the constraint and replace it with a partial unique
-- index, so a row with an email and no phone does not collide with another.
alter table team_members drop constraint if exists team_members_phone_key;
create unique index if not exists team_members_phone_idx
  on team_members (phone) where phone is not null;
create unique index if not exists team_members_email_idx
  on team_members (lower(email)) where email is not null;

comment on column team_members.email is
  'The login identity for admins. Crew sign in by phone, admins by email. A row may carry '
  'either or both; the unique indexes are partial so nulls do not collide.';

-- Ben, 2026-09-10: superadmin is ben@amtechai.com, admin is scoopdogg129@gmail.com.
-- The other two addresses could reach the old admin and are kept so nobody is locked out
-- of a system they already had access to.
insert into team_members (name, email, role, status, started_at) values
  ('Ben Palaskas', 'ben@amtechai.com',           'superadmin', 'active', current_date),
  ('Ben Palaskas', 'ben@palaskasconsulting.com', 'superadmin', 'active', current_date),
  ('Josue Isaac',  'scoopdogg129@gmail.com',     'admin',      'active', current_date),
  ('Josue Isaac',  'josue@scoopdogg.net',        'admin',      'active', current_date)
on conflict do nothing;

comment on table team_members is
  'No delete. Somebody who leaves gets status=inactive and an ended_at, because visits '
  'they completed must keep naming them. Access is decided by role and status here, so '
  'revoking is one UPDATE.';

commit;
