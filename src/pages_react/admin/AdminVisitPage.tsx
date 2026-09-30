/**
 * One visit: where, who, how to get in, what happened, and the photos the crew took.
 * Read from server/lib/business.ts visitDetail.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi } from '../../lib/adminApi';

const at = (t: string | null) => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null);

export default function AdminVisitPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (id) adminApi.visit(id).then(setD).catch((e) => setError((e as Error).message)); }, [id]);
  const v = d?.visit;
  return (
    <AdminLayout>
      <div className="max-w-2xl">
        <a href="/admin/week" className="text-sm text-ink-500 underline">The week</a>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {!d ? (!error && <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" />) : (
          <>
            <h1 className="mt-2 font-serif text-h2 text-forest-900" data-visit>{v.name}</h1>
            <p className="text-base text-ink-700">{new Date(`${v.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} · {v.service_name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {v.phone && <a className="btn-secondary btn-sm" href={`tel:${v.phone}`}>Call</a>}
              <a className="btn-ghost btn-sm" href={`https://maps.google.com/?q=${encodeURIComponent(`${v.address}, ${v.city}`)}`} target="_blank" rel="noreferrer">Map</a>
              <a className="btn-ghost btn-sm" href={`/admin/customers/${v.customer_id}`}>Customer</a>
            </div>
            <dl className="mt-6 grid gap-2 rounded-lg border border-line bg-paper p-4 text-sm text-ink-700">
              <div><dt className="inline text-ink-500">Address </dt><dd className="inline">{v.address}, {v.city}</dd></div>
              {v.gate_code && <div><dt className="inline text-ink-500">Gate </dt><dd className="inline">{v.gate_code}</dd></div>}
              {v.access_notes && <div><dt className="inline text-ink-500">Getting in </dt><dd className="inline">{v.access_notes}</dd></div>}
              <div><dt className="inline text-ink-500">Dogs </dt><dd className="inline">{v.num_dogs}{v.yard_size ? ` · ${v.yard_size} yard` : ''}</dd></div>
              <div><dt className="inline text-ink-500">Status </dt><dd className="inline">{v.state.replace(/_/g, ' ')}
                {at(v.en_route_at) ? ` · left ${at(v.en_route_at)}` : ''}{at(v.arrived_at) ? ` · arrived ${at(v.arrived_at)}` : ''}{at(v.completed_at) ? ` · done ${at(v.completed_at)}` : ''}{v.completed_by_name ? ` by ${v.completed_by_name}` : ''}</dd></div>
              {v.customer_note && <div><dt className="inline text-ink-500">Customer's note </dt><dd className="inline">{v.customer_note}</dd></div>}
              {v.crew_notes && <div><dt className="inline text-ink-500">Crew notes </dt><dd className="inline">{v.crew_notes}</dd></div>}
            </dl>
            <h2 className="mt-6 text-lg font-semibold text-forest-900">Photos ({d.photos.length})</h2>
            {d.photos.length === 0 ? <p className="mt-2 text-sm text-ink-500">No photos from this visit.</p> : (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {d.photos.map((p: any) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="Visit photo" loading="lazy" className="aspect-square w-full object-cover" /></a>)}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
