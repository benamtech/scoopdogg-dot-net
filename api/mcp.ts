/**
 * /mcp — Scoop Dogg as an MCP server for ChatGPT and other agents (server/lib/mcp.ts says what and why).
 *
 * Streamable HTTP, stateless: every POST carries one JSON-RPC message and gets one JSON answer, a
 * notification gets 202, and GET is refused because this server never pushes. The data sources are
 * the same functions the pages and the booking journey use; a start request goes through
 * /api/lead itself, so a ChatGPT lead is saved, mailed to Josue and marked in demo mode exactly as a
 * website lead is. Never a second lead path.
 */
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { rateLimit, isOverLimit } from '../server/lib/admin-auth.js';
import { loadPublicSnapshot } from '../server/lib/public-catalog.js';
import { resolveZip } from '../server/lib/funnel.js';
import { priceBooking, parseInput, createBooking } from '../server/lib/booking.js';
import { loadCatalog } from '../server/lib/catalog-db.js';
import { catchUpFor } from '../src/shared/pricing.js';
import { createHash } from 'node:crypto';
import { handleMessage, type McpDeps } from '../server/lib/mcp.js';
import { WIDGET_HTML } from '../server/lib/mcp-widget.js';

const origin = (req: ApiRequest) => {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
  const proto = (req.headers['x-forwarded-proto'] as string) || (host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
};

function deps(req: ApiRequest, ip: string): McpDeps {
  let snap: ReturnType<typeof loadPublicSnapshot> | null = null;   // one read per request
  const site = origin(req).includes('scoopdogg.net') ? 'https://scoopdogg.net' : origin(req);
  return {
    site,
    widget: WIDGET_HTML,
    snapshot: () => (snap ??= loadPublicSnapshot()),
    resolveZip: (zip) => resolveZip(zip) as any,
    price: async (zip, sel) => {
      const { quote, oneTime, area, dates } = await priceBooking({ city: '', postal_code: zip, package_id: sel.package_id || '', tier_id: sel.tier_id || '', extra_tier_ids: [], with_package_ids: [], start_date: '' });
      const open = (dates || []).filter((d: any) => !d.full).map((d: any) => ({ date: String(d.date), label: String(d.label || d.date) }));
      if (oneTime) return { area: area.name, monthly_cents: null, first_charge_cents: oneTime.cents, discount_cents: 0, offers: [], dates: open };
      if (!quote || !quote.ok) throw new Error('unpriced');
      return {
        area: area.name, monthly_cents: quote.monthlyCents, first_charge_cents: quote.firstChargeCents, discount_cents: quote.discountCents,
        offers: (quote.appliedOffers || []).map((o: any) => o.name || o.label || String(o)), dates: open,
      };
    },
    book: async (b) => {
      try { await rateLimit(`mcp-book:${ip}`, 6, 60 * 60); }
      catch (e) { if (isOverLimit(e)) throw Object.assign(new Error('rate'), { userMessage: 'Too many bookings from here. Please call (805) 869-8070.' }); throw e; }
      const zip = await resolveZip(b.postal_code);
      if (!zip.served) throw Object.assign(new Error('zip'), { userMessage: 'That ZIP is not on a route yet.' });
      // The same validation the booking page gets, then the two things only server code may set.
      const input = parseInput({
        address: b.address, city: zip.area_slug, postal_code: b.postal_code, package_id: b.package_id || '', tier_id: b.tier_id || '',
        last_cleaned: b.last_cleaned || null, start_date: b.start_date, name: b.name, email: b.email, phone: b.phone,
        gate_code: b.gate_code || '', access_notes: b.notes || '', source: 'chatgpt',
        idempotency_key: 'mcp-' + createHash('sha256').update([b.email, b.start_date, b.package_id, b.tier_id].join('|')).digest('hex').slice(0, 40),
      });
      input.channel = 'chatgpt';
      // A yard that is behind owes the catch-up visit the booking page would have added.
      if (input.package_id) {
        const c = catchUpFor(await loadCatalog() as any, 'weekly-pooper-scooper-service', input.last_cleaned);
        if (c.kind === 'charge') input.extra_tier_ids = [c.tier.id];
      }
      const r: any = await createBooking(input, origin(req));
      if (r.mode !== 'request') throw Object.assign(new Error('mode'), { userMessage: 'That booking did not go through. Please call (805) 869-8070.' });
      return { booking_id: r.booking_id, start_label: r.start_label };
    },
    submitLead: async (lead) => {
      try { await rateLimit(`mcp-lead:${ip}`, 6, 60 * 60); }
      catch (e) { if (isOverLimit(e)) return { ok: false, message: 'Too many requests from here. Please call (805) 869-8070.' }; throw e; }
      const r = await fetch(`${origin(req)}/api/lead`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'scoopdogg-mcp' }, body: JSON.stringify(lead),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true } : { ok: false, message: j.error };
    },
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-protocol-version, mcp-session-id, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'This MCP server answers POST only.' }); }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  let msg: any;
  try { msg = req.body && typeof req.body === 'object' ? req.body : await readJsonBody(req); }
  catch { return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try {
    const out = await handleMessage(deps(req, ip), msg);
    if (out === null) { res.statusCode = 202; return res.end(); }
    return sendJson(res, 200, out);
  } catch (e) {
    safeError('mcp', e);
    return sendJson(res, 200, { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: 'Internal error' } });
  }
}
