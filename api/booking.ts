/**
 * /api/booking/* — one function for the booking journey (Hobby caps functions at 12).
 *
 *   POST price      { city, package_id, extra_tier_ids?, with_package_ids? } -> server price + start days
 *   POST checkout   the whole booking -> { mode: 'checkout', url } or { mode: 'request' }
 *   POST complete   { booking_id, session_id } -> activates, signs the customer in
 *   POST waitlist   { email, address, city } -> saved, Josue told
 */
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { rateLimit } from '../server/lib/admin-auth.js';
import { BookingError, parseInput, priceBooking, createBooking, completeBooking, joinWaitlist } from '../server/lib/booking.js';

const routePath = (req: ApiRequest) =>
  (new URL(req.url || '/', 'https://local.test').searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');

const baseUrl = (req: ApiRequest) => {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'scoopdogg.net';
  const proto = (req.headers['x-forwarded-proto'] as string) || (host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'Method not allowed.' }); }
  const path = routePath(req);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    const body = await readJsonBody(req);
    if (path === 'price') {
      const { quote, area, dates } = await priceBooking({
        city: String(body.city ?? ''), package_id: String(body.package_id ?? ''), start_date: '',
        extra_tier_ids: Array.isArray(body.extra_tier_ids) ? body.extra_tier_ids.map(String) : [],
        with_package_ids: Array.isArray(body.with_package_ids) ? body.with_package_ids.map(String) : [],
      });
      if (!quote.ok) return sendJson(res, 400, { error: 'Please choose your plan again.' });
      return sendJson(res, 200, {
        area: { slug: area.slug, name: area.name },
        monthly_cents: quote.monthlyCents, first_charge_cents: quote.firstChargeCents,
        discount_cents: quote.discountCents, extras_cents: quote.extrasCents,
        lines: quote.lines, offers: quote.appliedOffers, dates,
      });
    }
    if (path === 'checkout') {
      try { await rateLimit(`booking:${ip}`, 12, 60 * 60); } catch { return sendJson(res, 429, { error: 'Too many attempts. Please call us on (805) 869-8070.' }); }
      const result = await createBooking(parseInput(body), baseUrl(req));
      return sendJson(res, 200, result);
    }
    if (path === 'complete') {
      const result = await completeBooking(String(body.booking_id ?? ''), body.session_id ? String(body.session_id) : null, res);
      return sendJson(res, 200, result);
    }
    if (path === 'waitlist') {
      try { await rateLimit(`waitlist:${ip}`, 10, 60 * 60); } catch { return sendJson(res, 429, { error: 'Too many attempts.' }); }
      return sendJson(res, 200, await joinWaitlist(body));
    }
    return sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof BookingError) return sendJson(res, e.status, { error: e.userMessage, code: e.code });
    safeError(`booking:${path}`, e);
    return sendJson(res, 503, { error: 'Something went wrong on our side. Please try again, or call (805) 869-8070.' });
  }
}
