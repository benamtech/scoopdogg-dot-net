import type { MessageStatus } from './types';
/**
 * The admin's only way to reach data. Every call goes to /api/admin/*, which runs on the
 * server and holds the sole database credential. The browser has none — that is the
 * whole point, and it is what the old admin got wrong: it queried the database directly
 * with a key that shipped in the bundle and could read every customer record.
 */
export type AdminRole = 'superadmin' | 'admin' | 'crew';
export interface AdminUser { id: string; teamId: string; name: string; email: string; role: AdminRole }

export interface Lead {
  id: string; name: string; phone: string; email: string; address: string; city: string;
  service_slug: string; yard_size: string | null; num_dogs: number | null; notes: string;
  source_page: string; status: string; created_at: string; updated_at: string;
}
export interface Message {
  id: string; name: string; email: string; phone: string; subject: string;
  message: string; status: MessageStatus; created_at: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export const adminApi = {
  startLogin:  (email: string) => call<{ ok: true; message: string }>('login/start', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyLogin: (email: string, code: string) => call<{ ok: true; user: AdminUser }>('login/verify', { method: 'POST', body: JSON.stringify({ email, code }) }),
  session:     () => call<{ user: AdminUser; demo_mode: boolean; demo_address: string | null }>('session'),
  logout:      () => call<{ ok: true }>('logout', { method: 'POST' }),

  // Demo mode. `effective_on_publish` is why the response is worth reading: mail and the
  // booking journey change on the setting, the static public pages change on a publish.
  demo:        () => call<{ demo_mode: boolean; demo_address: string | null }>('demo'),
  setDemo:     (mode: boolean) => call<{
    demo_mode: boolean; was: boolean; effective_now: string[]; effective_on_publish: string[];
  }>('demo', { method: 'POST', body: JSON.stringify({ mode }) }),

  summary:     () => call<{
    leads_by_status: Record<string, number>; total_leads: number;
    unread_messages: number; active_customers: number; recent: Lead[];
  }>('summary'),

  leads:       (opts: { status?: string; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.status) p.set('status', opts.status);
    if (opts.q) p.set('q', opts.q);
    const qs = p.toString();
    return call<{ leads: Lead[] }>(`leads${qs ? '&' + qs : ''}`);
  },
  lead:        (id: string) => call<{ lead: Lead }>(`lead/${id}`),
  updateLead:  (id: string, patch: { status?: string; notes?: string }) =>
    call<{ lead: Lead }>(`lead/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  messages:      () => call<{ messages: Message[] }>('messages'),
  message:       (id: string) => call<{ message: Message }>(`message/${id}`),
  updateMessage: (id: string, status: string) =>
    call<{ message: Message }>(`message/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  settings:      () => call<{ settings: Array<{ key: string; value: unknown; updated_at: string; updated_by: string | null }> }>('settings'),
  setSetting:    (key: string, value: unknown) =>
    call<{ setting: { key: string; value: unknown } }>('settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),

  // ---- the onboarding checklist (P18 §2). `done: null` means NOT MEASURABLE, never "no". ----
  checklist:   () => call<{ items: ChecklistItem[]; done: number; measurable: number; areas: ChecklistArea[]; facts: Record<string, unknown> }>('checklist'),
  setRouteDays:(slug: string, weekdays: number[]) =>
    call<{ area: { slug: string; name: string; service_weekdays: number[] } }>('checklist/route-days', { method: 'PATCH', body: JSON.stringify({ slug, weekdays }) }),
  setBusinessFact: (key: string, value: unknown) =>
    call<{ setting: { key: string; value: unknown } }>('checklist/business', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
  setAreaBookable: (slug: string, bookable: boolean) =>
    call<{ area: { slug: string; name: string; bookable: boolean } }>('checklist/area', { method: 'PATCH', body: JSON.stringify({ slug, bookable }) }),
  confirmPrices: () => call<{ confirmed: number }>('checklist/prices/confirm', { method: 'POST', body: JSON.stringify({}) }),

  // ---- the growth board, and the hour ----
  growth:     () => call<GrowthBoard>('growth'),
  unfinished: () => call<{ measured: boolean; note?: string; rows: UnfinishedRow[] }>('unfinished'),

  // ---- customers and invites (P18 §3) ----
  customers:  () => call<{ customers: CustomerRow[] }>('customers'),
  invite:     (body: InviteBody) => call<{ invite_id: string; subscription_id: string; link_sent: boolean; email_state: string }>('customers/invite', { method: 'POST', body: JSON.stringify(body) }),

  // ---- the team (server/lib/team.ts) ----
  team:       () => call<{ team: TeamMember[]; me: string }>('team'),
  addTeamMember: (body: { name: string; email: string; phone?: string; role: 'crew' | 'admin' }) =>
    call<{ member: TeamMember }>('team/add', { method: 'POST', body: JSON.stringify(body) }),
  setTeamStatus: (id: string, status: 'active' | 'inactive') =>
    call<{ member: TeamMember }>('team/status', { method: 'POST', body: JSON.stringify({ id, status }) }),

  // ---- payments ----
  payments:   () => call<PaymentsData>('payments'),
  disconnect: (mode: 'test' | 'live') => call<{ cleared: number; message: string }>('payments/disconnect', { method: 'POST', body: JSON.stringify({ mode }) }),

  // ---- today, the crew screen ----
  today:      () => call<{ date: string; stops: Stop[]; completion: CompletionReadiness; durations: StopDurations }>('today'),
  // The stop clock (migration 035). Neither is required to close a visit — a stop with no clock
  // is one we learn nothing from, not one that cannot be done — but together they are the only
  // measurement that can replace the estimate the whole price ladder was derived from.
  markEnRoute: (visitId: string) =>
    call<{ visit: StopClock }>('visits/en-route', { method: 'POST', body: JSON.stringify({ visit_id: visitId }) }),
  markArrived: (visitId: string) =>
    call<{ visit: StopClock }>('visits/arrived', { method: 'POST', body: JSON.stringify({ visit_id: visitId }) }),
  // Marking a stop done is the one write a crew session may make. `told` reports what happened
  // to the customer message afterwards - it is not an error if that half did not go out.
  completeVisit: (visitId: string, body: { crew_notes?: string; photo_urls?: string[] } = {}) =>
    call<{ visit: { id: string; state: string; completed_at: string; photos: number };
           told: { sent: boolean; channel: string; reason?: string } }>(
      'visits/complete', { method: 'POST', body: JSON.stringify({ visit_id: visitId, ...body }) }),
  // The photo goes up BEFORE the completion, as its own request, and the completion is given the
  // URL it returns. Two requests rather than one because the upload is the part that fails on a
  // yard's worth of signal, and a failed upload must not also lose the crew notes or leave the
  // caller guessing whether the visit was completed.
  uploadVisitPhoto: (visitId: string, dataUrl: string) =>
    call<{ photo: { id: string; url: string; bytes: number; deduped: boolean } }>(
      'visits/photo', { method: 'POST', body: JSON.stringify({ visit_id: visitId, data_url: dataUrl }) }),
};

export interface ChecklistItem {
  key: 'stripe' | 'route_days' | 'business_facts' | 'prices' | 'where_you_work' | 'photos';
  title: string; what_it_changes: string;
  done: boolean | null; measurable: boolean; detail: string; blocked_reason?: string;
}
export interface ChecklistArea { slug: string; name: string; bookable: boolean; service_weekdays: number[] }
/** `measured: false` and `value: 0` are different answers and the screen must never merge them. */
export interface Metric { value: number | null; measured: boolean; note?: string }
export interface FeeRow { period: string; collected_cents: number; fee_cents: number; payments: number }
export interface AreaDensity {
  slug: string; name: string; bookable: boolean; zips: number;
  depot_miles: number; area_sq_mi: number; customers_now: number;
  /** Driving minutes one more customer here adds. The acquisition number. */
  marginal_drive_minutes: number;
  /** That, over the reference service time. At or below 1.0 the stop is worth the drive. */
  marginal_ratio: number;
  /** null means "more customers than a day holds", which is not the same as a big number. */
  customers_for_parity: number | null;
  drive_minutes_per_visit_now: number | null;
  margin_per_visit: Metric;
}

export interface GrowthBoard {
  instrumented: boolean; month: string;
  metrics: Record<'booking_intent_starts' | 'price_step_reached' | 'booked' | 'conversion_pct'
    | 'new_customers_this_month' | 'customers_now' | 'mrr_cents' | 'platform_fee_this_month_cents', Metric>;
  fees_by_month: FeeRow[]; fees_by_year: FeeRow[];
  /**
   * Where the next customer should come from (server/lib/density.ts). `measured: false` when
   * migration 031 has not been applied to this database — the same rule as every Metric above:
   * a board that cannot compute this says so instead of printing a plausible order.
   */
  where_next?: {
    measured: boolean; note?: string; day_capacity?: number;
    /** `population` once migration 032 is applied; `polygon` means 93001 is still in the ocean. */
    geo_basis?: 'population' | 'polygon';
    /** How many active subscriptions the order rests on. One is enough to move a town to the top. */
    total_customers?: number;
    /** `referenceBasis` says whether the minutes are timed stops or the estimate. */
    parameters?: { referenceServiceMinutes: number; referenceTier: string; referenceBasis?: string };
    areas: AreaDensity[];
  };
  waitlist?: {
    measured: boolean; note?: string; geo_basis?: 'population' | 'polygon';
    zips: {
      postal_code: string; city_name: string; depot_miles: number; area_sq_mi: number;
      /** Where the ZIP's LAND is. 93042's is an island; its people are at Point Mugu. */
      polygon_miles?: number;
      customers_for_parity: number | null;
    }[];
  };
  /** False before migration 033: the counts above then include AMTECH's own gate runs. */
  attributed?: boolean;
  /** Sessions this month that were ours and are NOT in the counts above. Said, never silent. */
  verifier_sessions_excluded?: number | null;
  /** Where this month's real sessions came from. 'direct' is a real answer, not a gap. */
  by_source?: { source: string; sessions: number; priced: number }[];
}
export interface UnfinishedRow {
  id: string; postal_code: string | null; step: string | null; price_cents_seen: number | null;
  name: string | null; phone: string | null; email: string | null; area: string; plan: string | null;
  started_at: string; last_seen_at: string; sms_href: string | null; sms_body: string;
}
export interface CustomerRow {
  id: string; name: string; email: string | null; phone: string; created_at: string;
  subscription_id: string | null; state: string | null; payment_state: string | null;
  monthly_price_cents: number | null; starts_on: string | null; service_weekday: number | null;
  source: string | null; address: string | null; area_name: string | null;
  invite_id: string | null; sent_at: string | null; accepted_at: string | null;
}
export interface InviteBody {
  name: string; email: string; phone: string; address: string; area_slug: string;
  price_cents: number; starts_on?: string | null; num_dogs?: number | null; notes?: string;
}
export interface ModeStatus {
  account_id: string | null; display_name: string | null; ready: boolean;
  card_payments: string | null; requirements: string | null; probed_at: string | null;
  revoked_at: string | null; platform_fee_bps: number | null; requirement_entries?: string[] | null;
}
/** What opening the Payments screen did about prices. Never a person's job (stripe.ts). */
export interface PricePublishResult { attempted: boolean; created: number; already: number; reason: string | null }
export interface PaymentsData {
  status: { live: ModeStatus; test: ModeStatus };
  published?: { live: PricePublishResult; test: PricePublishResult };
  packages: Array<{ slug: string; name: string; monthly_price_cents: number; source: string; derivation: string; version: number; published_test: boolean; published_live: boolean }>;
}
/**
 * Whether the Mark-done action can be offered at all, and why not when it cannot. The server
 * ASKS whether photo storage exists (migration 029) rather than asserting it, and the screen
 * prints its reason rather than showing a button that always fails.
 */
export interface TeamMember {
  id: string; name: string; email: string | null; phone: string | null;
  role: 'superadmin' | 'admin' | 'crew'; status: 'active' | 'inactive' | 'invited';
  started_at: string | null; ended_at: string | null; last_login_at: string | null;
}
export interface CompletionReadiness {
  ready: boolean; requiresPhoto: boolean; reason: string | null;
}

export interface Stop {
  id: string; scheduled_for: string; state: string; crew_notes: string;
  customer_name: string; phone: string; address: string; city: string;
  gate_code: string | null; access_notes: string;
  /** The stop clock. Null means not tapped, which is allowed — never a zero. */
  en_route_at: string | null; arrived_at: string | null; completed_at: string | null;
}
export interface StopClock {
  id: string; state: string;
  en_route_at: string | null; arrived_at: string | null; completed_at: string | null;
  drive_minutes: number | null; service_minutes: number | null;
}
/** Medians over timed stops, with how many each rests on. `measured` is part of the answer. */
export interface StopDurations {
  service_minutes: number | null; service_measured: number;
  drive_minutes: number | null; drive_measured: number;
  by_tier: { service_slug: string; label: string; est_minutes: number | null; median_minutes: number; measured: number }[];
}
