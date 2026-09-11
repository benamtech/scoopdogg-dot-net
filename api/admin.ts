/**
 * /api/admin/* — one Vercel function serving the whole admin route tree.
 *
 * Hobby caps a non-framework `api/` directory at 12 functions and every file becomes
 * one, so the tree is collapsed behind a single entry with a catch-all rewrite. This is
 * McGrath's `api/_dispatch.ts` pattern; see planning/02-DEPLOYMENT.md for why.
 *
 * Everything except `login/*` requires a session. `superadmin` sees team and settings;
 * `admin` sees the business.
 */
import { db } from '../server/lib/db.js';
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { startLogin, verifyLogin, getSession, endSession, rateLimit, type AdminSession } from '../server/lib/admin-auth.js';

const routePath = (req: ApiRequest) =>
  (new URL(req.url || '/', 'https://local.test').searchParams.get('path') || '')
    .replace(/^\/+|\/+$/g, '');

const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'active', 'declined'];
const MSG_STATUSES = ['unread', 'read', 'replied', 'spam'];

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const path = routePath(req);
  try {
    // ---- open routes -----------------------------------------------------
    if (path === 'login/start') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
      const body = await readJsonBody(req);
      const email = String(body.email ?? '').trim();
      if (!email) return sendJson(res, 400, { error: 'Enter your email address.' });
      try {
        await rateLimit(`admin_login:${email.toLowerCase()}`, 5, 15 * 60);
      } catch {
        return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      }
      try { await startLogin(email); } catch (e) {
        safeError('admin:login/start', e);
        // A configuration failure must not read as "wrong email".
        if (String((e as Error).message).startsWith('resend') || String((e as Error).message).includes('RESEND'))
          return sendJson(res, 503, { error: 'We could not send the code just now. Try again shortly.' });
      }
      // Identical answer whether or not the address is allowed in, so this screen
      // cannot be used to find out who has access.
      return sendJson(res, 200, { ok: true, message: 'If that address has access, a code is on its way.' });
    }

    if (path === 'login/verify') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
      const body = await readJsonBody(req);
      const email = String(body.email ?? '').trim();
      const code = String(body.code ?? '').trim();
      if (!email || !code) return sendJson(res, 400, { error: 'Enter your email and the code.' });
      try {
        await rateLimit(`admin_verify:${email.toLowerCase()}`, 10, 15 * 60);
      } catch {
        return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      }
      const session = await verifyLogin(res, email, code);
      if (!session) return sendJson(res, 401, { error: 'That code is not right, or it has expired.' });
      return sendJson(res, 200, { ok: true, user: session });
    }

    // ---- everything below needs a session --------------------------------
    const session = await getSession(req);
    if (path === 'session') {
      return sendJson(res, session ? 200 : 401, session ? { user: session } : { error: 'Not signed in.' });
    }
    if (!session) return sendJson(res, 401, { error: 'Not signed in.' });

    if (path === 'logout') {
      await endSession(req, res);
      return sendJson(res, 200, { ok: true });
    }

    if (path === 'summary') {
      const [leads, unread, active, recent] = await Promise.all([
        db().query('select status, count(*)::int n from leads group by status'),
        db().query("select count(*)::int n from contact_messages where status = 'unread'"),
        db().query("select count(*)::int n from leads where status = 'active'"),
        db().query('select id, name, city, service_slug, status, created_at from leads order by created_at desc limit 8'),
      ]);
      const byStatus: Record<string, number> = {};
      for (const r of leads.rows) byStatus[r.status] = r.n;
      return sendJson(res, 200, {
        leads_by_status: byStatus,
        total_leads: Object.values(byStatus).reduce((a, b) => a + b, 0),
        unread_messages: unread.rows[0].n,
        active_customers: active.rows[0].n,
        recent: recent.rows,
      });
    }

    if (path === 'leads') {
      const url = new URL(req.url || '/', 'https://local.test');
      const status = url.searchParams.get('status');
      const q = (url.searchParams.get('q') || '').trim();
      const params: unknown[] = [];
      const where: string[] = [];
      if (status && LEAD_STATUSES.includes(status)) { params.push(status); where.push(`status = $${params.length}`); }
      if (q) { params.push(`%${q}%`); where.push(`(name ilike $${params.length} or email ilike $${params.length} or phone ilike $${params.length} or city ilike $${params.length})`); }
      const { rows } = await db().query(
        `select id, name, phone, email, address, city, service_slug, yard_size, num_dogs,
                notes, source_page, status, created_at, updated_at
           from leads ${where.length ? 'where ' + where.join(' and ') : ''}
          order by created_at desc limit 500`, params);
      return sendJson(res, 200, { leads: rows });
    }

    if (path.startsWith('lead/')) {
      const id = path.slice('lead/'.length);
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const sets: string[] = []; const params: unknown[] = [];
        if (typeof body.status === 'string') {
          if (!LEAD_STATUSES.includes(body.status)) return sendJson(res, 400, { error: 'Unknown status.' });
          params.push(body.status); sets.push(`status = $${params.length}`);
        }
        if (typeof body.notes === 'string') { params.push(body.notes.slice(0, 8000)); sets.push(`notes = $${params.length}`); }
        if (!sets.length) return sendJson(res, 400, { error: 'Nothing to change.' });
        params.push(id);
        const { rows } = await db().query(
          `update leads set ${sets.join(', ')} where id = $${params.length} returning *`, params);
        if (!rows.length) return sendJson(res, 404, { error: 'Lead not found.' });
        return sendJson(res, 200, { lead: rows[0] });
      }
      const { rows } = await db().query('select * from leads where id = $1', [id]);
      if (!rows.length) return sendJson(res, 404, { error: 'Lead not found.' });
      return sendJson(res, 200, { lead: rows[0] });
    }

    if (path === 'messages') {
      const { rows } = await db().query(
        'select id, name, email, phone, subject, message, status, created_at from contact_messages order by created_at desc limit 500');
      return sendJson(res, 200, { messages: rows });
    }

    if (path.startsWith('message/')) {
      const id = path.slice('message/'.length);
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        if (!MSG_STATUSES.includes(String(body.status))) return sendJson(res, 400, { error: 'Unknown status.' });
        const { rows } = await db().query(
          'update contact_messages set status = $1 where id = $2 returning *', [body.status, id]);
        if (!rows.length) return sendJson(res, 404, { error: 'Message not found.' });
        return sendJson(res, 200, { message: rows[0] });
      }
      const { rows } = await db().query('select * from contact_messages where id = $1', [id]);
      if (!rows.length) return sendJson(res, 404, { error: 'Message not found.' });
      if (rows[0].status === 'unread') await db().query("update contact_messages set status = 'read' where id = $1", [id]);
      return sendJson(res, 200, { message: rows[0] });
    }

    // ---- superadmin only -------------------------------------------------
    const requireSuper = (s: AdminSession) => s.role === 'superadmin';

    if (path === 'team') {
      if (!requireSuper(session)) return sendJson(res, 403, { error: 'Superadmin only.' });
      const { rows } = await db().query(
        'select id, name, email, phone, role, status, started_at, ended_at, last_login_at from team_members order by role, name');
      return sendJson(res, 200, { team: rows });
    }

    if (path === 'settings') {
      if (!requireSuper(session)) return sendJson(res, 403, { error: 'Superadmin only.' });
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const key = String(body.key ?? '');
        if (!key || !('value' in body)) return sendJson(res, 400, { error: 'Send a key and a value.' });
        const { rows } = await db().query(
          `insert into settings (key, value, updated_by) values ($1, $2::jsonb, $3)
             on conflict (key) do update set value = excluded.value, updated_by = $3, updated_at = now()
           returning key, value`,
          [key, JSON.stringify(body.value), session.email]);
        return sendJson(res, 200, { setting: rows[0] });
      }
      const { rows } = await db().query('select key, value, updated_at, updated_by from settings order by key');
      return sendJson(res, 200, { settings: rows });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    safeError(`admin:${path}`, e);
    return sendJson(res, 500, { error: 'Something went wrong. Try again.' });
  }
}
