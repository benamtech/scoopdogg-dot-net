/**
 * POST /api/contact — the contact form.
 *
 * Same reason as api/lead.ts: the browser must not hold a database credential. This is
 * a lower-stakes path than a booking, but the same rule applies — save it, notify best
 * effort, and never tell someone it worked when it did not.
 */
import { db } from '../server/lib/db.js';
import { sendEmail } from '../server/lib/notify.js';
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  let m: Record<string, string>;
  try {
    const b = await readJsonBody(req);
    const name = str(b.name, 120), email = str(b.email, 200), message = str(b.message, 5000);
    if (!name || !email || !message) {
      return sendJson(res, 400, { error: 'Please fill in your name, email and message.' });
    }
    m = { name, email, message, phone: str(b.phone, 40), subject: str(b.subject, 200), source_page: str(b.source_page, 300) };
  } catch (e) {
    safeError('contact:parse', e);
    return sendJson(res, 400, { error: 'We could not read that request. Please try again.' });
  }

  try {
    await db().query(
      `insert into contact_messages (name, email, phone, subject, message, source_page)
       values ($1,$2,$3,$4,$5,$6)`,
      [m.name, m.email, m.phone, m.subject, m.message, m.source_page],
    );
  } catch (e) {
    safeError('contact:insert', e);
    return sendJson(res, 503, {
      error: 'We could not send that just now. Please call us on (805) 869-8070.',
    });
  }

  // Through the one send function: it owns the recipient list, the demo-mode rewrite and
  // the outbox row. No fallback recipient - see server/lib/notify.ts.
  try {
    await sendEmail({
      purpose: 'contact',
      // AMTECH is copied, not addressed. The owner is the recipient; we are oversight.
      recipients: { settingKey: 'notify.lead_recipients' },
      ccSettingKey: 'notify.lead_cc',
      replyTo: m.email,
      subject: `Contact form: ${m.subject || 'General Question'} — ${m.name}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
        <h2 style="color:#1B4332">Message from scoopdogg.net</h2>
        <p><strong>${m.name}</strong> &lt;${m.email}&gt;${m.phone ? ` · ${m.phone}` : ''}</p>
        <p style="color:#444;white-space:pre-wrap">${m.message.replace(/</g, '&lt;')}</p>
      </div>`,
    });
  } catch (e) {
    safeError('contact:notify', e);
  }

  return sendJson(res, 201, { ok: true });
}
