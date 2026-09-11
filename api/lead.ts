/**
 * POST /api/lead — the lead path, and it is the only real emergency on this site.
 *
 * The old site inserted straight from the browser into Supabase with an anon key that
 * shipped in the JavaScript bundle. That key could also READ the whole leads table, so
 * every customer's name, phone, email and address was public. This endpoint exists so
 * the browser holds no database credential at all.
 *
 * Two rules it is built around:
 *   1. NEVER LOSE A LEAD. If the notification email fails, the lead is still saved and
 *      the customer still gets a success screen. If the database itself is unreachable,
 *      the customer is told to phone, because pretending it worked loses the job.
 *   2. Nothing internal reaches the customer. One reviewed sentence, always.
 */
import { randomUUID } from 'node:crypto';
import { db, setting } from '../server/lib/db.js';
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';

/**
 * What Josue reads in a lead notification. `src/lib/serviceLabel.ts` carries the same
 * wording for the admin screens; api/ is bundled separately from the browser code, so
 * they are two declarations and must be changed together.
 */
const SERVICE_LABELS: Record<string, string> = {
  weekly: 'Keep It Clean (Weekly)',
  turf: 'Turf Rescue (Surface Deodorizing)',
  'one-time': 'Turf Deep Clean (One-time)',
  'yard-deep-clean': 'Yard Deep Clean',
  'kitty-litter': 'Kitty Litter Exchange',
  'dog-run': 'Dog Run Cleanup',
  'cat-tree': 'Cat Tree Cleaning',
  'pressure-washing': 'Pressure Washing',
  'litter-robot': 'Litter-Robot Cleaning',
  'yard-maintenance': 'Yard Maintenance',
};

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  let lead: Record<string, string | number>;
  try {
    const body = await readJsonBody(req);
    const name = str(body.name, 120);
    const phone = str(body.phone, 40);
    const email = str(body.email, 200);
    const city = str(body.city, 80);
    if (!name || !phone || !email || !city) {
      return sendJson(res, 400, { error: 'Please fill in your name, phone, email and city.' });
    }
    const dogs = Number(body.num_dogs);
    lead = {
      id: randomUUID(),
      name, phone, email, city,
      address: str(body.address, 300),
      service_slug: str(body.service_type, 60),
      yard_size: str(body.yard_size, 20),
      num_dogs: Number.isFinite(dogs) ? Math.max(0, Math.min(50, Math.trunc(dogs))) : 0,
      notes: str(body.notes, 4000),
      source_page: str(body.source_page, 300),
    };
  } catch (e) {
    safeError('lead:parse', e);
    return sendJson(res, 400, { error: 'We could not read that request. Please try again.' });
  }

  // 1. Save it. This is the part that must not fail silently.
  try {
    await db().query(
      `insert into leads (id, name, phone, email, address, city, service_slug,
                          yard_size, num_dogs, notes, source_page, status, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new', now())`,
      [lead.id, lead.name, lead.phone, lead.email, lead.address, lead.city,
       lead.service_slug, lead.yard_size || null, lead.num_dogs, lead.notes, lead.source_page],
    );
  } catch (e) {
    safeError('lead:insert', e);
    // Telling the customer it worked when it did not is how a job is lost silently.
    return sendJson(res, 503, {
      error: 'We could not save your request just now. Please call us on (805) 869-8070 and we will sort it out.',
    });
  }

  // 2. Notify. Best effort: a failure here must never cost the lead we just saved.
  try {
    const key = process.env.RESEND_API_KEY;
    if (key) {
      const to = await setting<string[]>('notify.lead_recipients', ['josue@scoopdogg.net']);
      // AMTECH is copied, not addressed. The owner is the recipient; we are oversight.
      const cc = await setting<string[]>('notify.lead_cc', []);
      const from = await setting<string>('notify.from_address', 'leads@mail.amtechleads.com');
      const label = SERVICE_LABELS[String(lead.service_slug)] || String(lead.service_slug) || 'Not specified';
      const row = (k: string, v: unknown) =>
        `<tr><td style="padding:6px 12px;color:#666">${k}</td><td style="padding:6px 12px;font-weight:600">${String(v ?? '—') || '—'}</td></tr>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          // Resend sits behind Cloudflare, which answers a bare or library
          // user agent with 403 "error code: 1010". That reads exactly like a
          // dead API key and is not one. Send a real UA.
          'User-Agent': 'ScoopDogg-Site/1.0 (+https://scoopdogg.net)',
        },
        body: JSON.stringify({
          from: `Scoop Dogg Leads <${from}>`,
          to,
          ...(cc.length ? { cc } : {}),
          reply_to: String(lead.email),
          subject: `New Lead: ${lead.name} — ${label}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
            <h2 style="color:#1B4332">New lead from scoopdogg.net</h2>
            <table style="width:100%;border-collapse:collapse;background:#f9f8f5;border-radius:10px">
              ${row('Name', lead.name)}${row('Phone', lead.phone)}${row('Email', lead.email)}
              ${row('Address', [lead.address, lead.city].filter(Boolean).join(', '))}
              ${row('Service', label)}${row('Dogs', lead.num_dogs)}${row('Yard', lead.yard_size)}
              ${row('From page', lead.source_page)}
            </table>
            ${lead.notes ? `<p style="color:#444"><strong>Notes:</strong><br>${String(lead.notes).replace(/</g, '&lt;')}</p>` : ''}
          </div>`,
        }),
      });
    } else {
      // Visible degradation beats a silent one. The lead is safe in the database.
      console.warn('[api:lead] RESEND_API_KEY not set — lead saved, no notification sent');
    }
  } catch (e) {
    safeError('lead:notify', e);
  }

  return sendJson(res, 201, { ok: true, id: lead.id });
}
