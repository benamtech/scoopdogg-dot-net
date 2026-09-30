/**
 * Areas: the cities the owner serves and the days he is in each one. A change is on that city's
 * page and in the booking form within seconds (the save purges the page cache).
 *
 * WHAT A CITY WITH NO DAYS DOES, measured 2026-09-30 rather than assumed: startDates()
 * (src/shared/pricing.ts) falls back to every day in `schedule.service_days`, so a customer there
 * can start on any day he works — it books, but it does not sit on a route. On 2026-09-30 that was
 * Malibu, Simi Valley and Thousand Oaks. The screen says so on those rows instead of showing a
 * blank that reads like "never".
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type AdminArea } from '../../lib/adminApi';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AdminAreasPage() {
  const [areas, setAreas] = useState<AdminArea[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = async () => { try { setAreas((await adminApi.areas()).areas); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);

  const toggleDay = async (a: AdminArea, d: number) => {
    const next = a.service_weekdays.includes(d) ? a.service_weekdays.filter((x) => x !== d) : [...a.service_weekdays, d].sort();
    setBusy(a.slug); setError(''); setNote('');
    try {
      await adminApi.setAreaDays(a.slug, next);
      setNote(next.length ? `${a.name}: ${next.map((x) => DAYS[x]).join(', ')}. The city page and the booking form show it now.` : `${a.name} has no set days now: customers there can start on any day you work.`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const toggleBookable = async (a: AdminArea) => {
    if (a.bookable && !confirm(`Stop taking new bookings in ${a.name}? Customers already there are not affected.`)) return;
    setBusy(a.slug); setError(''); setNote('');
    try { await adminApi.setAreaBookable(a.slug, !a.bookable); setNote(a.bookable ? `${a.name} no longer takes new bookings.` : `${a.name} takes bookings again.`); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Areas</h1>
        <p className="mt-2 text-base text-ink-500">The days you are in each city. Tap a day to add or remove it.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}
        {!areas ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : (
          <ul className="mt-6 grid gap-3" data-areas>
            {areas.map((a) => (
              <li key={a.slug} className={`rounded-lg border bg-paper p-4 ${a.bookable ? 'border-line' : 'border-dashed border-line text-ink-500'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-forest-900">{a.name}</p>
                    <p className="text-sm text-ink-500">{a.customers} customer{a.customers === 1 ? '' : 's'} · {a.visits_next_14} visit{a.visits_next_14 === 1 ? '' : 's'} in the next two weeks{a.bookable ? '' : ' · not taking new bookings'}</p>
                  </div>
                  <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => toggleBookable(a)}>{a.bookable ? 'Stop new bookings' : 'Take bookings again'}</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Days in ${a.name}`}>
                  {DAYS.map((label, d) => {
                    const on = a.service_weekdays.includes(d);
                    return (
                      <button key={d} type="button" aria-pressed={on} disabled={busy === a.slug}
                              className={`min-w-[3rem] border px-2 py-2 text-sm ${on ? 'border-forest bg-forest text-white' : 'border-line bg-paper text-ink-700'}`}
                              onClick={() => toggleDay(a, d)}>{label}</button>
                    );
                  })}
                </div>
                {a.service_weekdays.length === 0 && a.bookable && (
                  <p className="mt-2 text-sm text-ink-600" data-no-route-days>No set days: a customer here can start on any day you work, so these visits are not on a route. Pick the days you are nearby.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminLayout>
  );
}
