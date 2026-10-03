/**
 * Jobs: every approved custom quote, by where it stands. The owner books a day for it, sees what is
 * owed, and records a cash or Venmo payment against it.
 *
 * The stage is derived on the server from dates the payment and completion paths already write
 * (server/lib/business.ts), so this screen cannot say "paid" while the books say otherwise. Built
 * for a phone: one column, big taps, the phone number a tap away.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type AdminJob, type JobStage } from '../../lib/adminApi';
import RecordPayment from '../../components/admin/RecordPayment';

const STAGES: { key: JobStage; label: string; hint: string }[] = [
  { key: 'to_schedule', label: 'To schedule', hint: 'Approved and paid what was asked up front. Pick a day.' },
  { key: 'scheduled', label: 'Booked', hint: 'On the calendar.' },
  { key: 'balance_owed', label: 'Balance owed', hint: 'Done, not paid in full.' },
  { key: 'deposit_due', label: 'Waiting on the deposit', hint: 'Approved; the customer has not paid the deposit yet.' },
  { key: 'done', label: 'Done and paid', hint: '' },
];
const money = (c: number | null) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}`);
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function AdminJobsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.jobs>> | null>(null);
  const [stage, setStage] = useState<JobStage>('to_schedule');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState<string | null>(null);

  const load = async () => { try { setData(await adminApi.jobs()); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!data) return;
    // Open on the first stage that has something in it, so the screen starts where the work is.
    const first = STAGES.find((s) => data.counts[s.key] > 0);
    if (first && data.counts[stage] === 0) setStage(first.key);
  }, [data]);

  const book = async (j: AdminJob, date: string | null) => {
    setBusy(j.id); setError(''); setNote('');
    try { await adminApi.scheduleJob(j.id, date); setNote(date ? `Quote #${j.number} is booked for ${dayLabel(date)}.` : `Quote #${j.number} no longer has a day.`); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  const list = data?.jobs.filter((j) => j.stage === stage) ?? [];
  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Jobs</h1>
        <p className="mt-2 text-base text-ink-500">Every custom job a customer has approved, by where it stands.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {!data ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : (
          <>
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" data-job-stages>
              {STAGES.map((s) => (
                <button key={s.key} type="button" role="tab" aria-selected={stage === s.key}
                        className={`border px-3 py-2 text-sm ${stage === s.key ? 'border-forest bg-forest text-white' : 'border-line bg-paper text-ink-700'}`}
                        onClick={() => setStage(s.key)}>
                  {s.label} <span className="tabular-nums">({data.counts[s.key] ?? 0})</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-500">{STAGES.find((s) => s.key === stage)?.hint}</p>
            {list.length === 0 ? (
              <p className="mt-6 rounded-lg border border-line bg-paper px-5 py-6 text-base text-ink-500">Nothing here right now.</p>
            ) : (
              <ul className="mt-4 grid gap-3" data-jobs>
                {list.map((j) => (
                  <li key={j.id} className="rounded-lg border border-line bg-paper p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-forest-900">#{j.number} {j.title || 'Custom job'}</p>
                        <p className="text-sm text-ink-600">{j.name} · {j.address || j.city}</p>
                        <p className="text-sm text-ink-500">
                          {money(j.total_cents)} total
                          {j.deposit_paid_at && j.deposit_cents ? ` · ${money(j.deposit_cents)} deposit paid` : ''}
                          {j.manual_paid_cents ? ` · ${money(j.manual_paid_cents)} recorded by hand` : ''}
                          {j.owed_cents > 0 && j.stage !== 'deposit_due' ? ` · ${money(j.owed_cents)} still owed` : ''}
                        </p>
                        {j.scheduled_for && <p className="text-sm font-medium text-forest-900">Booked for {dayLabel(j.scheduled_for)}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a className="btn-ghost btn-sm" href={`tel:${j.phone}`}>Call</a>
                        <a className="btn-ghost btn-sm" href={`/admin/quotes/${j.id}`}>Open</a>
                        {j.customer_id && <a className="btn-ghost btn-sm" href={`/admin/customers/${j.customer_id}`}>Customer</a>}
                      </div>
                    </div>
                    {(j.stage === 'to_schedule' || j.stage === 'scheduled') && (
                      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
                        {j.stage === 'scheduled' ? 'Move to' : 'Book for'}
                        <input type="date" className="field w-44" defaultValue={j.scheduled_for ?? ''} disabled={busy === j.id}
                               onChange={(e) => e.target.value && book(j, e.target.value)} aria-label={`Day for quote #${j.number}`} />
                        {j.scheduled_for && <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => book(j, null)}>Clear the day</button>}
                      </label>
                    )}
                    {j.customer_id && (j.stage === 'balance_owed' || j.stage === 'scheduled') && (
                      paying === j.id
                        ? <RecordPayment customerId={j.customer_id} quoteId={j.id} suggestCents={j.owed_cents}
                                         onDone={async (m) => { setPaying(null); setNote(m); await load(); }} onCancel={() => setPaying(null)} />
                        : <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => setPaying(j.id)}>Record cash or Venmo</button>
                    )}
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
