/**
 * /api/booking/* — one function for the booking journey (Hobby caps functions at 12).
 *
 *   POST zip        { postal_code }                -> served / known-but-not-served / unknown
 *   POST track      { session_id, step, ... }      -> the funnel's own measurement (P16 §9)
 *   POST price      { city|postal_code, package_id|tier_id, ... } -> server price + start days
 *   POST checkout   the whole booking -> { mode: 'checkout', url } or { mode: 'request' }
 *   POST complete   { booking_id, session_id } -> activates, signs the customer in
 *   POST waitlist   { email, address, city } -> saved, Josue told
 */
import { sendJson, readJsonBody, safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';
import { rateLimit, isOverLimit } from '../server/lib/admin-auth.js';
import { BookingError, parseInput, priceBooking, createBooking, completeBooking, joinWaitlist } from '../server/lib/booking.js';
import { resolveZip, track } from '../server/lib/funnel.js';

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
    // The first question: five digits. Three answers, and the third is not the second (P16 §2).
    if (path === 'zip') {
      const answer = await resolveZip(String(body.postal_code ?? ''));
      return sendJson(res, 200, answer);
    }

    // The funnel's own instrumentation. It is rate-limited like anything else a browser can
    // call, and it writes nothing a person could be identified by that they did not type in.
    if (path === 'track') {
      try { await rateLimit(`track:${ip}`, 120, 60 * 60); }
      catch (e) {
        if (isOverLimit(e)) return sendJson(res, 200, { recorded: false });   // never break a booking to record one
        safeError('booking:track:ratelimit', e);
        return sendJson(res, 200, { recorded: false });
      }
      try {
        const r = await track({
          session_id: String(body.session_id ?? ''), step: String(body.step ?? ''),
          postal_code: body.postal_code ? String(body.postal_code) : null,
          area_slug: body.area_slug ? String(body.area_slug) : null,
          city_name: body.city_name ? String(body.city_name) : null,
          service_slug: body.service_slug ? String(body.service_slug) : null,
          package_id: body.package_id ? String(body.package_id) : null,
          price_cents_seen: body.price_cents_seen != null ? Number(body.price_cents_seen) : null,
          lane: body.lane ? String(body.lane) : null,
          name: body.name ? String(body.name) : null,
          email: body.email ? String(body.email) : null,
          phone: body.phone ? String(body.phone) : null,
        });
        return sendJson(res, 200, r);
      } catch (e) {
        // Measurement must never be able to stop a customer booking.
        safeError('booking:track', e);
        return sendJson(res, 200, { recorded: false });
      }
    }

    if (path === 'price') {
      const { quote, oneTime, area, dates } = await priceBooking({
        city: String(body.city ?? ''), postal_code: String(body.postal_code ?? ''),
        package_id: String(body.package_id ?? ''), tier_id: String(body.tier_id ?? ''), start_date: '',
        extra_tier_ids: Array.isArray(body.extra_tier_ids) ? body.extra_tier_ids.map(String) : [],
        with_package_ids: Array.isArray(body.with_package_ids) ? body.with_package_ids.map(String) : [],
      });
      if (oneTime) {
        return sendJson(res, 200, {
          area: { slug: area.slug, name: area.name },
          shape: 'one_time',
          monthly_cents: null, first_charge_cents: oneTime.cents, discount_cents: 0, extras_cents: 0,
          label: oneTime.label, service_slug: oneTime.service.slug,
          lines: [{ kind: 'package', label: oneTime.label, cents: oneTime.cents, recurring: false, ref: oneTime.tier.id }],
          offers: [], dates,
        });
      }
      if (!quote || !quote.ok) return sendJson(res, 400, { error: 'Please choose your plan again.' });
      return sendJson(res, 200, {
        area: { slug: area.slug, name: area.name },
        shape: 'recurring',
        monthly_cents: quote.monthlyCents, first_charge_cents: quote.firstChargeCents,
        discount_cents: quote.discountCents, extras_cents: quote.extrasCents,
        lines: quote.lines, offers: quote.appliedOffers, dates,
      });
    }

    if (path === 'checkout') {
      try { await rateLimit(`booking:${ip}`, 12, 60 * 60); }
      catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts. Please call us on (805) 869-8070.' });
        safeError('booking:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not take that just now. Please call us on (805) 869-8070.' });
      }
      const result = await createBooking(parseInput(body), baseUrl(req));
      return sendJson(res, 200, result);
    }
    if (path === 'complete') {
      const result = await completeBooking(String(body.booking_id ?? ''), body.session_id ? String(body.session_id) : null, res);
      return sendJson(res, 200, result);
    }
    if (path === 'waitlist') {
      try { await rateLimit(`waitlist:${ip}`, 10, 60 * 60); }
      catch (e) {
        if (isOverLimit(e)) return sendJson(res, 429, { error: 'Too many attempts.' });
        safeError('waitlist:ratelimit', e);
        return sendJson(res, 503, { error: 'We could not take that just now. Please call us on (805) 869-8070.' });
      }
      return sendJson(res, 200, await joinWaitlist(body));
    }
    return sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof BookingError) return sendJson(res, e.status, { error: e.userMessage, code: e.code });
    safeError(`booking:${path}`, e);
    return sendJson(res, 503, { error: 'Something went wrong on our side. Please try again, or call (805) 869-8070.' });
  }
}
