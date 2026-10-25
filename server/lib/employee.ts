/**
 * Scoop Dogg's AI employee is told of every lead the moment it is saved (2026-10-25).
 *
 * The employee (AMTECH's platform, scoop-dogg-scoop-dogg.amtechai.com) wrote its own route and the shape it wants:
 * one envelope for bookings, quote requests, contact messages and the waitlist, signed GitHub-style
 * (`X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`), the kind in `X-Webhook-Event`. When one arrives it
 * tells the owner the name, what they want and their town, and drafts a reply for him to look at.
 *
 * It is told AFTER the lead is saved and Josue's own email has gone, and it can never cost a lead: no URL or secret
 * configured means nothing is sent; any failure is logged and swallowed; it gives up after three seconds.
 *   LEAD_WEBHOOK_URL     where (not a secret)
 *   LEAD_WEBHOOK_SECRET  the route's signing secret, copied from the employee without being read by anyone
 */
import { createHmac } from 'node:crypto';
import { safeError } from './http.js';

export type LeadType = 'booking' | 'quote' | 'contact' | 'waitlist';

export type Lead = {
  name: string; phone: string; email: string; town: string; postal_code: string; address: string;
  what_they_want: string; service_slug: string; package_id: string; timing: string; job_kinds: string[];
  photos_expected: number; access_notes: string; gate_code: string; source_page: string;
};

const EMPTY: Lead = {
  name: '', phone: '', email: '', town: '', postal_code: '', address: '', what_they_want: '', service_slug: '',
  package_id: '', timing: '', job_kinds: [], photos_expected: 0, access_notes: '', gate_code: '', source_page: '',
};

/** True for a request AMTECH's own walks make on themselves (the site's existing convention). */
export const isAmtechTest = (headers: Record<string, unknown> | undefined) =>
  String(headers?.['x-scoopdogg-verifier'] ?? '') === 'gate';

export async function tellEmployee(type: LeadType, lead: Partial<Lead>, raw: unknown, test = false): Promise<void> {
  const url = process.env.LEAD_WEBHOOK_URL;
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!url || !secret) return;
  try {
    // Every key present: the employee reads "" as "not asked" and a missing key as "the site forgot to map it".
    const filled = { ...EMPTY } as Record<string, unknown>;
    for (const [k, v] of Object.entries(lead)) if (v !== undefined && v !== null && k in EMPTY) filled[k] = v;
    const body = JSON.stringify({ type, received_at: new Date().toISOString(), test, lead: filled, raw: raw ?? {} });
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}`, 'X-Webhook-Event': type },
      body,
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) safeError('employee:handoff', new Error(`the employee answered ${r.status}`));
  } catch (e) {
    safeError('employee:handoff', e);
  }
}
