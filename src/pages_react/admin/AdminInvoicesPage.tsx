/**
 * Invoices by state: what is owed, what is paid, what was written off. An open invoice paid in cash
 * or Venmo is marked paid from here (server/lib/business.ts recordManualPayment settles it).
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import RecordPayment from '../../components/admin/RecordPayment';
import { adminApi } from '../../lib/adminApi';

const STATES: [string, string][] = [['open', 'Owed'], ['paid', 'Paid'], ['uncollectible', 'Written off'], ['void', 'Cancelled'], ['draft', 'Drafts']];
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}`;
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export default function AdminInvoicesPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.invoices>> | null>(null);
  const [state, setState] = useState('open');
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = async () => { try { setData(await adminApi.invoices()); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);
  const list = data?.invoices.filter((i) => i.state === state) ?? [];

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Invoices</h1>
        {data && <p className="mt-2 text-base text-ink-500" data-invoices-owed>{data.counts.open ?? 0} owed, {money(data.owed_cents)} in all.</p>}
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}
        {!data ? (!error && <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" />) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2" role="tablist">
              {STATES.map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={state === k}
                        className={`border px-3 py-2 text-sm ${state === k ? 'border-forest bg-forest text-white' : 'border-line bg-paper text-ink-700'}`}
                        onClick={() => setState(k)}>{l} <span className="tabular-nums">({data.counts[k] ?? 0})</span></button>
              ))}
            </div>
            {list.length === 0 ? <p className="mt-6 rounded-lg border border-line bg-paper px-5 py-6 text-base text-ink-500">None.</p> : (
              <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper" data-invoices>
                {list.map((i) => (
                  <li key={i.id} className="px-4 py-3 text-sm text-ink-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><a className="text-forest-900 underline" href={`/admin/customers/${i.customer_id}`}>{i.name}</a> · {date(i.issued_at)}{i.paid_at ? ` · paid ${date(i.paid_at)}` : ''}{i.collection_method === 'offline' ? ' · by hand' : ''}</span>
                      <span className="tabular-nums text-forest-900">{money(i.total_cents)}</span>
                    </div>
                    {i.lines && <p className="text-ink-500">{i.lines}</p>}
                    {i.state === 'open' && (paying === i.id
                      ? <RecordPayment customerId={i.customer_id} invoiceId={i.id} suggestCents={i.total_cents} onCancel={() => setPaying(null)} onDone={async (m) => { setPaying(null); setNote(m); await load(); }} />
                      : <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => setPaying(i.id)}>Paid by cash or Venmo</button>)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
