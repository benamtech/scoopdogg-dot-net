-- Revert 018. Drops the invite table, the revocation columns and the crew role, and puts the
-- unused 'team' value back so the schema fingerprint matches the one this was rehearsed against.
--
-- A crew row would be lost information, so it is moved to 'team' before the constraint changes
-- rather than deleted - the same reasoning as 021's trialing rows. There are none today.
begin;

drop table if exists customer_invites;

alter table stripe_connection drop column if exists revoked_at;
alter table stripe_connection drop column if exists revoked_by;

update team_members set role = 'team', updated_at = now() where role = 'crew';
alter table team_members drop constraint team_members_role_check;
alter table team_members alter column role set default 'team';
alter table team_members add constraint team_members_role_check
  check (role in ('superadmin','admin','team'));
comment on column team_members.role is null;

delete from settings where key in (
  'booking.lanes_enabled', 'booking.payafter_charge_offset_days',
  'booking.onetime_enabled', 'growth.review_request_after_visits');

delete from _migrations where name = '018_admin_and_invites.sql';

commit;
