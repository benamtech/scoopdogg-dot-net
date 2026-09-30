/**
 * The week: every visit and every booked custom job for the next seven days, by day, then by city
 * so a day reads in the order the van drives it. A tap opens the visit. Built for a phone.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi } from '../../lib/adminApi';

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const STATE: Record<string, string> = { scheduled: '', assigned: '', en_route: 'on the way', completed: 'done', skipped: 'skipped', failed_access: 'could not get in' };

export default function AdminWeekPage() {
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.week>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); adminApi.week(from).then(setData).catch((e) => setError((e as Error).message)); }, [from]);
  const total = data?.days.reduce((n, d) => n + d.visits.length + d.jobs.length, 0) ?? 0;

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">The week</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={!data} onClick={() => data && setFrom(shift(data.from, -7))}>Previous week</button>
          <button type="button" className="btn-ghost btn-sm" disabled={!data} onClick={() => setFrom(undefined)}>This week</button>
          <button type="button" className="btn-ghost btn-sm" disabled={!data} onClick={() => data && setFrom(shift(data.from, 7))}>Next week</button>
          {data && <span className="text-sm text-ink-500">{total} stop{total === 1 ? '' : 's'} from {dayLabel(data.from)}</span>}
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {!data ? (!error && <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" />) : (
          <div className="mt-6 grid gap-6" data-week>
            {data.days.map((d) => (
              <section key={d.day}>
                <h2 className="text-lg font-semibold text-forest-900">{dayLabel(d.day)} <span className="text-sm font-normal text-ink-500">({d.visits.length + d.jobs.length})</span></h2>
                {d.visits.length + d.jobs.length === 0 ? <p className="mt-2 text-sm text-ink-500">Nothing booked.</p> : (
                  <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-paper">
                    {d.jobs.map((j) => (
                      <li key={j.id}><a href={`/admin/quotes/${j.id}`} className="block px-4 py-3 text-sm hover:bg-cream">
                        <span className="font-medium text-forest-900">Custom job #{j.number}</span> · {j.name} · {j.address || j.city}
                      </a></li>
                    ))}
                    {d.visits.map((v) => (
                      <li key={v.id}><a href={`/admin/visits/${v.id}`} className="block px-4 py-3 text-sm hover:bg-cream">
                        <span className="text-forest-900">{v.name}</span> · {v.address}{v.area_name ? `, ${v.area_name}` : ''}
                        <span className="block text-ink-500">{v.service_name}{STATE[v.state] ? ` · ${STATE[v.state]}` : ''}{v.photos ? ` · ${v.photos} photo${v.photos === 1 ? '' : 's'}` : ''}</span>
                      </a></li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
