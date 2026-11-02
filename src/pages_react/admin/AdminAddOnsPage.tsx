/**
 * What goes with what. A service is listed with the work it does; under it, everything that could
 * go with it, worked out from that work. The owner turns each on or off and writes the sentence the
 * customer reads. What the work rules out (already included, would replace the job) never appears
 * here, so it cannot be switched on by mistake.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';

type Option = { slug: string; name: string; relation: string; why: string; approved: { customer_line: string } | null };
type Row = { slug: string; name: string; work: { zone: string; task: string }[]; options: Option[] };
type Data = { services: Row[]; problems: string[] };

async function call(method: string, body?: unknown): Promise<any> {
  const r = await fetch('/api/admin/service-graph', { method, credentials: 'same-origin', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'That did not save.');
  return j;
}

const LABEL: Record<string, string> = { add_on: 'Same visit', follow_on: 'Keeps it going' };

export default function AdminAddOnsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = () => call('GET').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const save = async (base: string, o: Option) => {
    setError('');
    try { await call('POST', { base, other: o.slug, customer_line: draft[`${base}|${o.slug}`] ?? o.approved?.customer_line ?? '' }); await load(); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (base: string, other: string) => { await call('DELETE', { base, other }).catch((e) => setError(e.message)); await load(); };

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <h1 className="font-serif text-h2 text-forest-900">Add-ons</h1>
        <p className="mt-2 text-base text-ink-500">What customers are offered with each job. Turn one on, write the line they read, and it is live.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {data?.problems.map((p) => <p key={p} className="mt-3 rounded-md bg-amber-100 px-4 py-3 text-amber-700">{p}</p>)}
        {!data ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : data.services.map((s, i) => (
          <details key={s.slug} open={i === 0} className="mt-4 rounded-lg border border-line bg-paper p-4 sm:p-5">
            <summary className="cursor-pointer font-serif text-h3 text-forest-900">{s.name}</summary>
            <p className="mt-3 text-sm text-ink-500">On the visit, in order: {[...new Set(s.work.map((w) => w.task))].join(', ')}.</p>
            <ul className="mt-4 divide-y divide-line">
              {s.options.map((o) => {
                const key = `${s.slug}|${o.slug}`;
                const on = Boolean(o.approved);
                return (
                  <li key={o.slug} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-base font-medium text-forest-900">{o.name} <span className="ml-2 text-micro text-ink-500">{LABEL[o.relation] ?? o.relation}</span></p>
                      {on
                        ? <button type="button" className="btn-ghost btn-sm" onClick={() => remove(s.slug, o.slug)}>Turn off</button>
                        : <button type="button" className="btn-primary btn-sm" onClick={() => save(s.slug, o)}>Turn on</button>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input className="field flex-1" maxLength={70} aria-label={`What customers read for ${o.name}`} placeholder="The line the customer reads"
                        value={draft[key] ?? o.approved?.customer_line ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                      {on && draft[key] !== undefined && draft[key] !== o.approved?.customer_line && <button type="button" className="btn-primary btn-sm" onClick={() => save(s.slug, o)}>Save</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </AdminLayout>
  );
}
