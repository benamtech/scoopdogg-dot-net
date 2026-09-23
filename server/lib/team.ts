/**
 * team.ts — who can sign in to the admin, and the one way to stop them.
 *
 * WHY THIS FILE EXISTS. `team_members` had readers everywhere — every admin request checks
 * `status = 'active'`, the Today screen names who completed a visit, the crew allowlist hangs off
 * `role` — and exactly two writers: the migrations that seeded Ben and Josue, and a gate that
 * plants somebody to refuse. `gates/writers-outside-gates.mjs` named it on its first run: NO
 * SCREEN CREATES A TEAM MEMBER. And `admin-auth.ts` has said since it was written that "revoking
 * access is one UPDATE on team_members.status" — an UPDATE that nothing performed. The day Josue
 * hires somebody, or somebody leaves, the only way to act on it was to ask AMTECH to run SQL.
 *
 * THE RULES, and each is a real way to lock a business out of its own admin:
 *
 *   - Nobody changes their OWN access. The one person who can undo a mistaken revoke is the one
 *     who just made it, and they are no longer signed in.
 *   - The last active owner (admin or superadmin) cannot be switched off. A business with no one
 *     able to sign in is a business that has to phone AMTECH to get into its own records.
 *   - Only a superadmin may create or change a superadmin. Josue can run his team; he cannot
 *     remove the people who can recover his account for him.
 *   - `crew` is the default role. The person in the truck sees today's stops and nothing else,
 *     and that refusal is structural in api/admin.ts; this file only decides who is on the list.
 *
 * NOBODY IS DELETED. migration 001's table comment: "No delete. Somebody who leaves gets
 * status=inactive and an ended_at. Visits they completed must keep naming them." Switching off
 * is the whole of removing somebody, and switching back on is one tap.
 *
 * SIGN-IN IS BY EMAIL for every role — `startLogin()` looks up `lower(email)` — so an email is
 * required here even for crew. A crew member added with only a phone number would be a row that
 * can never sign in, which is a writer producing a reader-less row.
 */
import { db } from './db.js';
import { appendEvent } from './events.js';
import type { AdminRole, AdminSession } from './admin-auth.js';

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class TeamError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'team_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type TeamMember = {
  id: string; name: string; email: string | null; phone: string | null;
  role: AdminRole; status: 'active' | 'inactive' | 'invited';
  started_at: string | null; ended_at: string | null; last_login_at: string | null;
};

const OWNER_ROLES: AdminRole[] = ['superadmin', 'admin'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function listTeam(q: Queryable = db()): Promise<TeamMember[]> {
  const { rows } = await q.query(
    `select id, name, email, phone, role, status, started_at::text, ended_at::text, last_login_at
       from team_members
      order by (status = 'active') desc, case role when 'superadmin' then 0 when 'admin' then 1 else 2 end, name`);
  return rows;
}

export async function addTeamMember(
  input: { name: string; email: string; phone?: string | null; role?: AdminRole },
  by: Pick<AdminSession, 'teamId' | 'role'>,
  q: Queryable = db(),
): Promise<TeamMember> {
  const name = String(input.name ?? '').trim().slice(0, 120);
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 200);
  const phone = String(input.phone ?? '').replace(/[^\d+]/g, '').slice(0, 20) || null;
  const role: AdminRole = input.role ?? 'crew';

  if (!name) throw new TeamError('A name is needed.', 422, 'name_required');
  if (!EMAIL.test(email)) throw new TeamError('An email address is needed — it is how they sign in.', 422, 'email_required');
  if (!(['superadmin', 'admin', 'crew'] as AdminRole[]).includes(role)) throw new TeamError('Unknown role.', 422, 'bad_role');
  if (!OWNER_ROLES.includes(by.role)) throw new TeamError('Only an owner can add people.', 403, 'forbidden');
  if (role === 'superadmin' && by.role !== 'superadmin') {
    throw new TeamError('Only a superadmin can add a superadmin.', 403, 'forbidden');
  }

  // Somebody who left and is coming back is the same person — switch them on, do not duplicate
  // them, or the visits they completed would name a row that is not the one signing in.
  const { rows: existing } = await q.query(
    `select id, status from team_members where lower(email) = $1`, [email]);
  if (existing[0]) {
    throw new TeamError(existing[0].status === 'active'
      ? 'That email is already on the team.'
      : 'That person is already on the list, switched off. Switch them back on instead.', 409, 'exists');
  }

  let row: TeamMember;
  try {
    const { rows } = await q.query(
      `insert into team_members (name, email, phone, role, status, started_at)
       values ($1, $2, $3, $4, 'active', current_date)
       returning id, name, email, phone, role, status, started_at::text, ended_at::text, last_login_at`,
      [name, email, phone, role]);
    row = rows[0];
  } catch (e) {
    // The partial unique index on phone. A friendly sentence beats a constraint name.
    if ((e as { code?: string }).code === '23505') throw new TeamError('That phone number is already on the team.', 409, 'exists');
    throw e;
  }

  await appendEvent(q as never, {
    subjectKind: 'team', subjectId: row.id, type: 'team.added', to: 'active',
    actorKind: 'owner', actorId: by.teamId, payload: { role, email },
  });
  return row;
}

/**
 * Switch somebody on or off. Off takes effect on their NEXT REQUEST — `getSession()` checks
 * `status = 'active'` every time — and their open sessions are revoked as well, so "switched off"
 * never means "switched off once their cookie expires in eight hours".
 */
export async function setTeamStatus(
  id: string,
  status: 'active' | 'inactive',
  by: Pick<AdminSession, 'teamId' | 'role'>,
  q: Queryable = db(),
): Promise<TeamMember> {
  if (!OWNER_ROLES.includes(by.role)) throw new TeamError('Only an owner can change who has access.', 403, 'forbidden');
  if (!['active', 'inactive'].includes(status)) throw new TeamError('Unknown status.', 422, 'bad_status');
  if (id === by.teamId) {
    throw new TeamError('You cannot change your own access — ask another owner.', 409, 'self');
  }

  const { rows } = await q.query(`select id, role, status from team_members where id = $1 for update`, [id]);
  const target = rows[0];
  if (!target) throw new TeamError('No such person.', 404, 'not_found');
  if (target.role === 'superadmin' && by.role !== 'superadmin') {
    throw new TeamError('Only a superadmin can change a superadmin.', 403, 'forbidden');
  }
  if (target.status === status) {
    const { rows: [same] } = await q.query(
      `select id, name, email, phone, role, status, started_at::text, ended_at::text, last_login_at from team_members where id = $1`, [id]);
    return same;
  }

  if (status === 'inactive' && OWNER_ROLES.includes(target.role)) {
    const { rows: [owners] } = await q.query(
      `select count(*)::int as n from team_members where status = 'active' and role in ('superadmin','admin') and id <> $1`, [id]);
    if (owners.n === 0) {
      throw new TeamError('This is the last person who can sign in as an owner. Add another owner first.', 409, 'last_owner');
    }
  }

  const { rows: [done] } = await q.query(
    `update team_members
        set status = $2,
            ended_at = case when $2 = 'inactive' then current_date else null end,
            updated_at = now()
      where id = $1
      returning id, name, email, phone, role, status, started_at::text, ended_at::text, last_login_at`,
    [id, status]);

  let sessionsRevoked = 0;
  if (status === 'inactive') {
    const r = await q.query(
      `update sessions set revoked_at = now() where team_id = $1 and revoked_at is null and expires_at > now()`, [id]);
    sessionsRevoked = r.rowCount ?? 0;
  }

  await appendEvent(q as never, {
    subjectKind: 'team', subjectId: id, type: status === 'inactive' ? 'team.switched_off' : 'team.switched_on',
    from: target.status, to: status, actorKind: 'owner', actorId: by.teamId,
    payload: { sessions_revoked: sessionsRevoked },
  });
  return done;
}
