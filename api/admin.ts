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
import { demoMode, demoStatus } from '../server/lib/notify.js';
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { startLogin, verifyLogin, getSession, endSession, rateLimit, isOverLimit, type AdminSession } from '../server/lib/admin-auth.js';
import { probeAccount, createConnectedAccount, onboardingLink, publishAllPrices, connection, type StripeMode } from '../server/lib/stripe.js';

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
      } catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
        safeError('admin:login/start:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not reach the sign-in service. Try again in a moment.' });
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
      } catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
        safeError('admin:login/verify:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not reach the sign-in service. Try again in a moment.' });
      }
      const session = await verifyLogin(res, email, code);
      if (!session) return sendJson(res, 401, { error: 'That code is not right, or it has expired.' });
      return sendJson(res, 200, { ok: true, user: session });
    }

    // ---- everything below needs a session --------------------------------
    const session = await getSession(req);
    if (path === 'session') {
      if (!session) return sendJson(res, 401, { error: 'Not signed in.' });
      // `demo_mode` rides the session response so EVERY admin screen can show the banner
      // without each one remembering to ask. A mode you cannot see from the screen is a
      // mode that ships.
      const demo = await demoMode();
      return sendJson(res, 200, { user: session, ...demoStatus(demo) });
    }
    if (!session) return sendJson(res, 401, { error: 'Not signed in.' });

    // ---- demo mode -------------------------------------------------------
    // Deliberately NOT behind requireSuper. It is the control that makes the system
    // exercisable at all, and the owner is the person who will be shown it.
    if (path === 'demo') {
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (typeof body.mode !== 'boolean') {
          return sendJson(res, 400, { error: 'Send { "mode": true } or { "mode": false }.' });
        }
        const before = await demoMode();
        await db().query(
          `insert into settings (key, value, updated_by) values ('demo.mode', $1::jsonb, $2)
             on conflict (key) do update set value = excluded.value, updated_by = $2, updated_at = now()`,
          [JSON.stringify(body.mode), session.email]);
        const after = await demoMode();
        // Mail and the booking journey read this setting on every request, so they change
        // now. The public pages are statically built, so their banner and their noindex
        // change on the next publish - saying so is the difference between a control that
        // works and one that looks like it did nothing.
        return sendJson(res, 200, {
          ...demoStatus(after),
          was: before.mode,
          effective_now: ['mail', 'booking journey', 'admin'],
          effective_on_publish: ['public pages'],
        });
      }
      const demo = await demoMode();
      return sendJson(res, 200, demoStatus(demo));
    }

    if (path === 'logout') {
      await endSession(req, res);
      return sendJson(res, 200, { ok: true });
    }

    // ---- payments: Stripe onboarding, readiness and published prices ----------
    // Josue (admin) can run all of this himself: onboarding is his to do, and the status is
    // read from Stripe with its age rather than trusted from a stored boolean.
    if (path === 'payments') {
      const modes: StripeMode[] = ['live', 'test'];
      const status: Record<string, unknown> = {};
      for (const m of modes) {
        const conn = await connection(m).catch(() => null);
        let probe = null;
        try { probe = conn?.account_id ? await probeAccount(m) : null; } catch (e) { safeError(`admin:payments:${m}`, e); }
        status[m] = { account_id: conn?.account_id ?? null, display_name: conn?.display_name ?? null, ready: probe?.ready ?? false, card_payments: probe?.card_payments ?? conn?.card_payments_status ?? null, requirements: probe?.requirements ?? null, probed_at: probe?.probed_at ?? conn?.last_probed_at ?? null };
      }
      const { rows: packages } = await db().query(
        `select p.slug, p.name, p.monthly_price_cents, p.source, p.derivation, p.version,
                exists(select 1 from stripe_prices sp where sp.package_id = p.id and sp.version = p.version and sp.livemode = false) as published_test,
                exists(select 1 from stripe_prices sp where sp.package_id = p.id and sp.version = p.version and sp.livemode = true) as published_live
           from packages p where p.status = 'active' order by p.sort_order`);
      return sendJson(res, 200, { status, packages });
    }
    if (path === 'payments/onboard' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const mode: StripeMode = body.mode === 'live' ? 'live' : 'test';
      await createConnectedAccount(mode, { displayName: 'Scoop Dogg', email: session.email, by: session.email });
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
      const proto = host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https';
      return sendJson(res, 200, { url: await onboardingLink(mode, `${proto}://${host}`) });
    }
    if (path === 'payments/publish' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const mode: StripeMode = body.mode === 'live' ? 'live' : 'test';
      return sendJson(res, 200, { published: await publishAllPrices(mode) });
    }

    // ---- business: subscriptions and the pace to 200 --------------------------
    if (path === 'business') {
      const { rows: [m] } = await db().query(
        `select count(*) filter (where state = 'active')::int as active,
                count(*) filter (where state = 'paused')::int as paused,
                count(*) filter (where state = 'active' and created_at > date_trunc('month', now()))::int as new_this_month,
                count(*) filter (where state = 'cancelled' and cancelled_at > date_trunc('month', now()))::int as cancelled_this_month,
                coalesce(sum(monthly_price_cents) filter (where state = 'active'), 0)::int as mrr_cents,
                count(*) filter (where payment_state = 'past_due')::int as past_due
           from subscriptions where customer_id not in (select id from customers where name like 'DEMO—%')`);
      const { rows: recent } = await db().query(
        `select s.id, s.state, s.starts_on::text as starts_on, s.monthly_price_cents, s.payment_state, s.created_at, c.name, c.email, c.phone,
                p.address, p.city, pk.name as package_name
           from subscriptions s join customers c on c.id = s.customer_id join properties p on p.id = s.property_id
           left join packages pk on pk.id = s.package_id
          where s.source = 'online' order by s.created_at desc limit 25`);
      const target = 200;
      const targetDate = '2027-05-16';
      const monthsLeft = Math.max(1, (new Date(targetDate).getTime() - Date.now()) / (30.44 * 86_400_000));
      return sendJson(res, 200, { ...m, target, target_date: targetDate, needed_per_month: Math.ceil((target - m.active) / monthsLeft), recent });
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
