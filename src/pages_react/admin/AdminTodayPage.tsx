/**
 * Today's route — the one screen a crew session can reach (P18 §4 item 1).
 *
 * IT DOES NOT CLAIM A PROOF IT CANNOT WRITE. `visit.require_completion_photo` is true in settings
 * and there is no photo storage on this project, so this screen lists stops and does not offer a
 * "mark complete with a photo" button that would have nowhere to put the photo. STANDARD.md §6
 * calls the crew app deliberately unsettled; this is the landing place for it, not the app.
 *
 * The gate code is here because the person standing at the gate needs it, and it is nowhere else:
 * `visit.gate_code_visible_to` is 'assigned_crew_only'.
 */
import { useEffect, useState } from 'react';
import { adminApi, type Stop } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';

export default function AdminTodayPage() {
  const [data, setData] = useState<{ date: string; stops: Stop[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { (async () => {
    try { setData(await adminApi.today()); } catch (e) { setError((e as Error).message); }
  })(); }, []);

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Today</h1>
        <p className="mt-2 text-base text-ink-500">
          {data ? new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Loading…'}
        </p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {data && data.stops.length === 0 && (
          <p className="mt-8 rounded-lg border border-line bg-paper p-6 text-base text-ink-700">No stops scheduled today.</p>
        )}
        <ul className="mt-8 space-y-3">
          {data?.stops.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-line bg-paper p-5">
              <div className="flex items-start gap-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest-600 text-sm font-semibold text-white">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-forest-900">{s.address}</p>
                  <p className="text-base text-ink-700">{s.city} · {s.customer_name}</p>
                  {s.gate_code && <p className="mt-2 text-base text-forest-800">Gate code: <strong className="font-semibold">{s.gate_code}</strong></p>}
                  {s.access_notes && <p className="mt-1 text-base text-ink-700">{s.access_notes}</p>}
                  <a href={`tel:${String(s.phone ?? '').replace(/\D/g, '')}`} className="link mt-2 inline-block text-base">{s.phone}</a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AdminLayout>
  );
}
