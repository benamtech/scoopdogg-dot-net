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
import { expireDuePauses } from '../server/lib/account.js';
import { demoMode, demoStatus } from '../server/lib/notify.js';
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { startLogin, verifyLogin, getSession, endSession, rateLimit, isOverLimit, type AdminSession } from '../server/lib/admin-auth.js';
import { probeAccount, createConnectedAccount, onboardingLink, publishAllPrices, connection, requirementsOf, disconnect, reconnect, type StripeMode } from '../server/lib/stripe.js';
import { checklist, setRouteDays, setOwnerSetting, setAreaBookable, confirmPrices } from '../server/lib/onboarding.js';
import { growthBoard, unfinished } from '../server/lib/growth.js';
import { createInvite, customerList, InviteError } from '../server/lib/invites.js';
import { completeVisit, completionReadiness, markArrived, markEnRoute, stopDurations, VisitError } from '../server/lib/visits.js';
import { put, PhotoError } from '../server/lib/photos.js';
import { sendVisitComplete, runCommsSweeps } from '../server/lib/comms.js';

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

    // ---- what a crew session may reach -----------------------------------
    // DEFAULT DENY, and that is the whole point. P18 §5's admin-roles gate asks whether a crew
    // session can read money, customers or settings; a per-route check answers that correctly
    // for every route somebody remembered and wrongly for the one they add next month. So crew
    // is an allowlist of paths and everything else is 403, including routes that do not exist
    // yet. gates/admin-roles.mjs proves it by asking for a route the list does not name.
    // `visits/complete` is here because P4 gives the completion verb to the assigned crew: the
    // person standing in the yard is the one who knows the yard is clean.
    // `visits/en-route` and `visits/arrived` join the list for the same reason `visits/complete`
    // is on it: the person standing in the yard is the only one who knows when the van got there.
    // They are the writers for `en_route_at` and `arrived_at`, which had none until migration 035.
    const CREW_PATHS = new Set(['session', 'logout', 'today', 'visits/complete', 'visits/photo',
      'visits/en-route', 'visits/arrived']);
    if (session.role === 'crew' && !CREW_PATHS.has(path)) {
      return sendJson(res, 403, { error: 'Your account sees today\'s route only.' });
    }

    // ---- today's route, the one screen a crew member has -----------------
    if (path === 'today') {
      const { rows } = await db().query(
        `select v.id, v.scheduled_for::text as scheduled_for, v.state, v.crew_notes,
                v.en_route_at, v.arrived_at, v.completed_at,
                c.name as customer_name, c.phone, p.address, p.city, p.gate_code, p.access_notes
           from visits v
           join subscriptions s on s.id = v.subscription_id
           join customers c on c.id = s.customer_id
           join properties p on p.id = v.property_id
          where v.scheduled_for = current_date and v.state not in ('cancelled','skipped')
          order by p.city, p.address`);
      // The gate code is on this screen because the person at the gate needs it, and nowhere
      // else: visit.gate_code_visible_to is 'assigned_crew_only'.
      //
      // `completion` says whether the Mark-done action can be offered at all. The screen asks
      // rather than assumes, so it can print the reason instead of showing a button that always
      // fails. It reads the database rather than a hardcoded sentence about the project.
      return sendJson(res, 200, {
        date: new Date().toISOString().slice(0, 10),
        stops: rows,
        completion: await completionReadiness(),
        // What the stops recorded so far actually say. Zero measured is the honest state on the
        // day 035 lands, and the screen can say that instead of showing a median of nothing.
        durations: await stopDurations(),
      });
    }

    // ---- demo mode -------------------------------------------------------
    // Deliberately NOT behind requireSuper. It is the control that makes the system
    // exercisable at all, and the owner is the person who will be shown it.
    // ---- mark a stop done ------------------------------------------------
    // The messages are sent AFTER the transaction commits and their failure is swallowed: the
    // yard is clean whether or not a mail provider is reachable, and the outbox row records
    // what happened either way.
    // ---- upload the completion photo -------------------------------------
    // A data URL and not multipart, because the browser has already had to decode the file into
    // a canvas to resize it (server/lib/photos.ts does not resize: sharp in this bundle would be
    // ~30MB to fix a problem a canvas solves for free). What comes back out of a canvas is a
    // data URL, so accepting one means no multipart parser on either side.
    //
    // The limit is the byte cap plus base64's 33% plus room for the envelope. photos.put()
    // enforces the real cap on the DECODED bytes, which is the number the setting names.
    if (path === 'visits/photo' && req.method === 'POST') {
      const body = await readJsonBody(req, 2 * 1024 * 1024);
      const dataUrl = String((body as Record<string, unknown>).data_url ?? '');
      const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) return sendJson(res, 400, { error: 'Send a JPEG, WebP or PNG as a base64 data URL.', code: 'bad_data_url' });
      try {
        const stored = await put({
          visitId: String((body as Record<string, unknown>).visit_id ?? ''),
          bytes: Buffer.from(m[2], 'base64'),
          mime: m[1],
          uploadedBy: session.teamId,
        });
        return sendJson(res, 200, { photo: stored });
      } catch (e) {
        if (e instanceof PhotoError) return sendJson(res, e.status, { error: e.message, code: e.code });
        throw e;
      }
    }

    /**
     * THE STOP CLOCK (migration 035). Two taps on the screen that already exists, and between
     * them the only measurement that can settle what a visit is worth: `arrived_at` to
     * `completed_at` is the service time that `service_tiers.est_minutes` has been an estimate
     * of since somebody wrote "replace with the median of real visit durations" in its column
     * comment. Neither is required to close a visit — see server/lib/visits.ts.
     */
    if ((path === 'visits/en-route' || path === 'visits/arrived') && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const mark = path === 'visits/en-route' ? markEnRoute : markArrived;
        return sendJson(res, 200, { visit: await mark(String(body.visit_id ?? ''), session.teamId) });
      } catch (e) {
        if (e instanceof VisitError) return sendJson(res, e.status, { error: e.message, code: e.code });
        throw e;
      }
    }

    if (path === 'visits/complete' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const done = await completeVisit({
          visitId: String(body.visit_id ?? ''),
          completedBy: session.teamId,
          photoUrls: Array.isArray(body.photo_urls) ? body.photo_urls.map(String) : [],
          crewNotes: typeof body.crew_notes === 'string' ? body.crew_notes : '',
        });
        const told = await sendVisitComplete(done.id).catch((e) => {
          safeError('admin:visit-complete-notify', e);
          return { sent: false, channel: 'none', reason: 'notify failed' };
        });
        return sendJson(res, 200, { visit: done, told });
      } catch (e) {
        if (e instanceof VisitError) return sendJson(res, e.status, { error: e.message, code: e.code });
        throw e;
      }
    }

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
        const { rows: rev } = await db().query(`select revoked_at, revoked_by from stripe_connection where livemode = $1`, [m === 'live']);
        status[m] = { account_id: conn?.account_id ?? null, display_name: conn?.display_name ?? null, ready: probe?.ready ?? false, card_payments: probe?.card_payments ?? conn?.card_payments_status ?? null, requirements: probe?.requirements ?? null, probed_at: probe?.probed_at ?? conn?.last_probed_at ?? null, revoked_at: rev[0]?.revoked_at ?? null, platform_fee_bps: conn?.platform_fee_bps ?? null };
      }
      // What Stripe still wants, in Stripe's words. P18 §1.3: an account that quietly stops
      // paying out because a document expired is the worst silent failure in this system, so a
      // non-empty requirements list is never summarised away into "needs onboarding".
      for (const m of modes) {
        const st = status[m] as Record<string, unknown>;
        if (!st.account_id) continue;
        try {
          const r = await requirementsOf(m);
          st.requirement_entries = r?.entries ?? [];
        } catch (e) { safeError(`admin:payments:requirements:${m}`, e); st.requirement_entries = null; }
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
      // The second of the two places a due pause comes back on. Josue opening his board is at
      // least as likely as the customer opening theirs, and the plan must not sit paused
      // waiting for whichever of them looks first.
      await expireDuePauses();
      // The same reason, for the same absence of a scheduler: nothing on Vercel runs on a
      // timer, so the card-expiry sweep and the review request happen when Josue opens his
      // board. If he never opens it, nothing is sent - which is the safe direction.
      await runCommsSweeps();
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

    // ---- disconnecting, in the right order (P18 §1.4) ---------------------
    if (path === 'payments/disconnect' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const mode: StripeMode = body.mode === 'live' ? 'live' : 'test';
      try {
        const r = await disconnect(mode, session.email);
        return sendJson(res, 200, { ...r, message: `Stopped. ${r.cleared} subscription(s) no longer carry our fee, and the Stripe account stays yours.` });
      } catch (e) {
        safeError('admin:payments/disconnect', e);
        return sendJson(res, 502, { error: 'We could not clear our fee from every subscription, so nothing was disconnected. Try again, or tell AMTECH.' });
      }
    }
    if (path === 'payments/reconnect' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await reconnect(body.mode === 'live' ? 'live' : 'test'));
    }

    // ---- the onboarding checklist (P18 §2) --------------------------------
    if (path === 'checklist') return sendJson(res, 200, await checklist());

    if (path === 'checklist/route-days' && req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const days = Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [];
      try { return sendJson(res, 200, { area: await setRouteDays(String(body.slug ?? ''), days, session.email) }); }
      catch { return sendJson(res, 404, { error: 'We do not have that city.' }); }
    }
    if (path === 'checklist/business' && req.method === 'PATCH') {
      const body = await readJsonBody(req);
      try { return sendJson(res, 200, { setting: await setOwnerSetting(String(body.key ?? ''), body.value, session.email) }); }
      catch { return sendJson(res, 400, { error: 'That is not something this screen can change.' }); }
    }
    if (path === 'checklist/area' && req.method === 'PATCH') {
      const body = await readJsonBody(req);
      try { return sendJson(res, 200, { area: await setAreaBookable(String(body.slug ?? ''), Boolean(body.bookable)) }); }
      catch { return sendJson(res, 404, { error: 'We do not have that city.' }); }
    }
    if (path === 'checklist/prices/confirm' && req.method === 'POST') {
      return sendJson(res, 200, await confirmPrices(session.email));
    }

    // ---- the growth board, and the hour (P18 §4, P16 §7) -------------------
    if (path === 'growth') return sendJson(res, 200, await growthBoard());
    if (path === 'unfinished') return sendJson(res, 200, await unfinished(60));

    // ---- customers, and the invites that bring them onto the rail ----------
    if (path === 'customers') return sendJson(res, 200, await customerList());
    if (path === 'customers/invite' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
      const proto = host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https';
      try {
        return sendJson(res, 200, await createInvite({
          name: String(body.name ?? ''), email: String(body.email ?? ''), phone: String(body.phone ?? ''),
          address: String(body.address ?? ''), area_slug: String(body.area_slug ?? ''),
          price_cents: Number(body.price_cents ?? 0), package_id: body.package_id ? String(body.package_id) : null,
          starts_on: body.starts_on ? String(body.starts_on) : null,
          num_dogs: body.num_dogs != null ? Number(body.num_dogs) : null,
          notes: String(body.notes ?? ''),
        }, session.email, `${proto}://${host}`));
      } catch (e) {
        if (e instanceof InviteError) return sendJson(res, e.status, { error: e.userMessage, code: e.code });
        throw e;
      }
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
