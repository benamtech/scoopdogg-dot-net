/**
 * Tell Google Analytics a lead happened. The tag itself is one settings row
 * (analytics.measurement_id, Base.astro); with no tag on the page this does nothing.
 * The predecessor site sent `generate_lead` from its booking widget, so the name is kept and
 * GA's history reads straight across the change of site.
 */
export function gaLead(method: 'booking' | 'booking_request' | 'waitlist' | 'enquiry' | 'quote_request') {
  try { (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', 'generate_lead', { method }); }
  catch { /* never load-bearing */ }
}
