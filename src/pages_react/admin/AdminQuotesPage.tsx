/**
 * Every custom quote, newest first, with the one fact that says what to do next: not opened, opened
 * and waiting, approved and waiting on a deposit, booked, done and owed, paid.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type QuoteListRow, type Nudge } from '../../lib/adminApi';
import { money } from '../../shared/quote-math';

function nextStep(q: QuoteListRow): string {
  if (q.state === 'draft') return 'Draft — not sent';
  if (q.state === 'sent') return q.view_count ? `Opened ${q.view_count}× — waiting on them` : 'Sent — not opened yet';
  if (q.state === 'accepted') {
    if (q.balance_paid_at) return 'Paid in full';
    if (q.completed_at) return 'Done — balance owed';
    if (q.deposit_cents && !q.deposit_paid_at) return 'Approved — deposit not paid';
    return 'Booked';
  }
  return q.state.charAt(0).toUpperCase() + q.state.slice(1);
}

export default function AdminQuotesPage() {
  const [rows, setRows] = useState<QuoteListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The follow-up list the daily run fills (server/lib/daily.ts): opened two days ago, not approved,
  // a text already written. One tap opens Messages on his phone; "Done" takes it off the list.
  const [nudges, setNudges] = useState<Nudge[]>([]);
  useEffect(() => { adminApi.quotes().then((r) => setRows(r.quotes)).catch((e) => setError((e as Error).message)); }, []);
  useEffect(() => { adminApi.nudges().then((r) => setNudges(r.nudges)).catch(() => setNudges([])); }, []);
  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="font-serif text-3xl text-dark">Custom quotes</h1>
        <p className="mt-1 text-dark/60">Jobs priced one at a time. A quote starts from a lead: open it and tap "Build a quote".</p>
      </div>
      {error && <p className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
      {nudges.length > 0 && (
        <section className="mb-6 rounded-card border border-amber-300 bg-amber-50 p-4" data-nudges>
          <h2 className="font-semibold text-dark">Follow up ({nudges.length})</h2>
          <p className="text-sm text-dark/60">Opened two or more days ago and not approved. A short text usually settles it.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {nudges.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-dark">#{n.number} · {n.name.replace(/^DEMO—/, '')} · {money(n.total_cents)}</span>
                <span className="flex gap-2">
                  <a className="btn-primary btn-sm" href={n.sms_href}>Text {n.name.replace(/^DEMO—/, '').split(' ')[0]}</a>
                  <button type="button" className="btn-ghost btn-sm" onClick={async () => { await adminApi.nudged(n.id); setNudges(nudges.filter((x) => x.id !== n.id)); }}>Done</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!rows && !error && <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-sage border-t-forest rounded-full animate-spin" /></div>}
      {rows && rows.length === 0 && <div className="bg-white rounded-card shadow-card p-8 text-center text-dark/60" data-quotes-empty>No quotes yet. When somebody asks for a custom job it arrives in Leads.</div>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-3" data-quotes-list>
          {rows.map((q) => (
            <li key={q.id}>
              <a href={`/admin/quotes/${q.id}`} className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-card shadow-card p-4 hover:shadow-md">
                <div>
                  <p className="font-semibold text-dark">#{q.number} · {q.name.replace(/^DEMO—/, '')}{q.city ? `, ${q.city}` : ''}</p>
                  <p className="text-sm text-dark/60">{q.title || 'Custom job'}{q.is_improvement ? ' · install' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="font-serif text-xl text-dark">{money(q.total_cents ?? q.required_cents)}</p>
                  <p className="text-sm text-forest">{nextStep(q)}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>
  );
}
