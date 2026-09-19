import type { MessageStatus } from './types';
/**
 * The admin's only way to reach data. Every call goes to /api/admin/*, which runs on the
 * server and holds the sole database credential. The browser has none — that is the
 * whole point, and it is what the old admin got wrong: it queried the database directly
 * with a key that shipped in the bundle and could read every customer record.
 */
export type AdminRole = 'superadmin' | 'admin';
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

  team:          () => call<{ team: Array<{ id: string; name: string; email: string | null; phone: string | null; role: string; status: string; last_login_at: string | null }> }>('team'),
  settings:      () => call<{ settings: Array<{ key: string; value: unknown; updated_at: string; updated_by: string | null }> }>('settings'),
  setSetting:    (key: string, value: unknown) =>
    call<{ setting: { key: string; value: unknown } }>('settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
};
