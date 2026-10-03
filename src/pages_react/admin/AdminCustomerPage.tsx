/**
 * One customer, everything about them in one place: how to reach them, their property, their plans,
 * their custom jobs, every payment (card and cash), their invoices, the photos from their visits and
 * their messages. And the one thing the owner does from here most: record a cash or Venmo payment.
 *
 * Read from server/lib/business.ts customerDetail — every section is rows, nothing is computed here
 * except sums for display. Built for a phone.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import RecordPayment from '../../components/admin/RecordPayment';
import { adminApi } from '../../lib/adminApi';

const money = (c: number | null | undefined) => (c == null ? '—' : `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: Math.abs(c) % 100 ? 2 : 0 })}`);
const date = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : undefined }) : '—');
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const KIND: Record<string, string> = { charge: 'Card', deposit: 'Deposit (card)', refund: 'Refund', manual: 'Recorded by hand' };

function Section({ title, children, count }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-forest-900">{title}{count != null && <span className="ml-2 text-sm font-normal text-ink-500">({count})</span>}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-line bg-paper px-4 py-4 text-sm text-ink-500">{children}</p>;

export default function AdminCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(false);
  const load = async () => { try { setD(await adminApi.customer(id!)); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { if (id) load(); }, [id]);

  const c = d?.customer;
  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <a href="/admin/customers" className="text-sm text-ink-500 underline">All customers</a>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}
        {!d ? (!error && <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" />) : (
          <>
            <h1 className="mt-2 font-serif text-h2 text-forest-900" data-customer-name>{c.name}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {c.phone && <a className="btn-secondary btn-sm" href={`tel:${c.phone}`}>Call {c.phone}</a>}
              {c.phone && <a className="btn-ghost btn-sm" href={`sms:${c.phone}`}>Text</a>}
              {c.email && <a className="btn-ghost btn-sm" href={`mailto:${c.email}`}>{c.email}</a>}
            </div>
            <p className="mt-3 text-sm text-ink-500">Customer since {date(c.created_at)} · {money(d.totals.paid_cents)} paid in all{d.totals.open_invoices ? ` · ${d.totals.open_invoices} open invoice${d.totals.open_invoices === 1 ? '' : 's'}` : ''}</p>
            {c.notes && <p className="mt-2 text-sm text-ink-700">{c.notes}</p>}

            <div className="mt-4">
              {paying
                ? <RecordPayment customerId={c.id} onDone={async (m) => { setPaying(false); setNote(m); await load(); }} onCancel={() => setPaying(false)} />
                : <button type="button" className="btn-primary btn-sm" onClick={() => setPaying(true)}>Record cash or Venmo</button>}
            </div>

            <Section title="Property" count={d.properties.length}>
              {d.properties.length === 0 ? <Empty>No address on file.</Empty> : d.properties.map((p: any) => (
                <div key={p.id} className="rounded-lg border border-line bg-paper px-4 py-3 text-sm text-ink-700">
                  <p className="text-base text-forest-900">{p.address}{p.city && !p.address?.includes(p.city) ? `, ${p.city}` : ''}</p>
                  <p>{p.num_dogs} dog{p.num_dogs === 1 ? '' : 's'}{p.yard_size ? ` · ${p.yard_size} yard` : ''}{p.gate_code ? ` · gate ${p.gate_code}` : ''}</p>
                  {p.access_notes && <p className="text-ink-500">{p.access_notes}</p>}
                </div>
              ))}
            </Section>

            <Section title="Plans" count={d.subscriptions.length}>
              {d.subscriptions.length === 0 ? <Empty>No plan.</Empty> : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-paper" data-customer-plans>
                  {d.subscriptions.map((s: any) => (
                    <li key={s.id} className="px-4 py-3 text-sm text-ink-700">
                      <p className="text-base text-forest-900">{s.service_name ?? s.service_slug} <span className="text-sm text-ink-500">— {s.state}{s.payment_state && s.payment_state !== 'ok' ? `, payment ${s.payment_state}` : ''}</span></p>
                      <p>{s.monthly_price_cents ? `${money(s.monthly_price_cents)} a month` : s.price_cents ? money(s.price_cents) : ''}{s.service_weekday != null ? ` · ${DAYS[s.service_weekday]}` : ''}{s.starts_on ? ` · since ${date(s.starts_on)}` : ''}</p>
                      <p className="text-ink-500">{s.visits_done} visit{s.visits_done === 1 ? '' : 's'} done{s.next_visit ? ` · next ${date(s.next_visit)}` : ''}{s.paused_until ? ` · paused until ${date(s.paused_until)}` : ''}{s.discount?.name ? ` · ${s.discount.name}` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Custom jobs" count={d.jobs.length}>
              {d.jobs.length === 0 ? <Empty>No custom jobs.</Empty> : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
                  {d.jobs.map((j: any) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="text-forest-900">#{j.number} {j.title || 'Custom job'} · {money(j.total_cents)}{j.owed_cents > 0 ? ` · ${money(j.owed_cents)} owed` : ''}</span>
                      <a className="underline text-ink-600" href={`/admin/quotes/${j.id}`}>Open</a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Payments" count={d.payments.length}>
              {d.payments.length === 0 ? <Empty>No payments yet.</Empty> : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-paper" data-customer-payments>
                  {d.payments.map((p: any) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-ink-700">
                      <span>{date(p.created_at)} · {KIND[p.kind] ?? p.kind}{p.method ? ` (${p.method})` : ''}{p.state !== 'succeeded' ? ` — ${p.state}` : ''}{p.note ? ` — ${p.note}` : ''}{p.livemode === false ? ' · test' : ''}</span>
                      <span className="tabular-nums text-forest-900">{money(p.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Invoices" count={d.invoices.length}>
              {d.invoices.length === 0 ? <Empty>No invoices.</Empty> : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
                  {d.invoices.map((i: any) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-ink-700">
                      <span>{date(i.issued_at)} · {i.state}{i.period_start ? ` · ${date(i.period_start)} to ${date(i.period_end)}` : ''}</span>
                      <span className="tabular-nums text-forest-900">{money(i.total_cents)}{i.hosted_invoice_url && <a className="ml-2 underline" href={i.hosted_invoice_url} target="_blank" rel="noreferrer">View</a>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Photos" count={d.photos.length}>
              {d.photos.length === 0 ? <Empty>No visit photos yet.</Empty> : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {d.photos.map((p: any) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                      <img src={p.url} alt={`Visit on ${date(p.visit_day)}`} loading="lazy" className="aspect-square w-full object-cover" />
                      <span className="text-micro text-ink-500">{date(p.visit_day)}</span>
                    </a>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Messages" count={d.messages.length}>
              {d.messages.length === 0 ? <Empty>No messages.</Empty> : (
                <ul className="grid gap-2">
                  {d.messages.map((m: any) => (
                    <li key={m.id} className={`max-w-[90%] rounded-lg border px-4 py-2 text-sm ${m.direction === 'inbound' ? 'border-line bg-paper' : 'ml-auto border-forest-400 bg-cream'}`}>
                      <p className="text-ink-700">{m.body}</p>
                      <p className="text-micro text-ink-500">{m.direction === 'inbound' ? c.name : 'You'} · {m.channel} · {new Date(m.created_at).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
