/**
 * Customers, and the invite that brings the ones Josue already has onto the rail (P18 §3).
 *
 * THE PRICE FIELD IS THE POINT OF THIS SCREEN. It is prefilled with nothing and the label says
 * "what they pay you now", because these are people who agreed a price before this software
 * existed. The published ladder went up 11% on 2026-09-18 and none of that reaches them: the
 * invite charges the number typed here, and "a price change applies to new customers only" is
 * kept by the data rather than by anyone remembering it.
 *
 * Nobody is forced onto it either. The email says so in Josue's own terms — keep paying cash or
 * Venmo if you'd rather — because a portal that cannot represent how a business is actually paid
 * gets worked around within a week, and then the database is fiction.
 */
import { useEffect, useState } from 'react';
import { adminApi, type CustomerRow } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';
import { areas } from '../../lib/catalog';

const money = (c: number | null) => (c == null ? '—' : `$${(c / 100).toFixed(0)}`);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const BLANK = { name: '', email: '', phone: '', address: '', area_slug: '', price: '', starts_on: '', notes: '' };

export default function AdminCustomersPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => { try { setRows((await adminApi.customers()).customers); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);

  const send = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const r = await adminApi.invite({
        name: form.name, email: form.email, phone: form.phone, address: form.address,
        area_slug: form.area_slug, price_cents: Math.round(Number(form.price) * 100),
        starts_on: form.starts_on || null, notes: form.notes,
      });
      setNote(r.link_sent
        ? `Invite sent to ${form.email}. Their price stays ${money(Math.round(Number(form.price) * 100))} a month.`
        : `Saved, but the email did not go out (${r.email_state}). Tell AMTECH.`);
      setForm({ ...BLANK });
      setOpen(false);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const status = (c: CustomerRow) => {
    if (c.state === 'active') return { label: 'On the rail', cls: 'bg-success-100 text-success' };
    if (c.state === 'deposit_pending') return { label: 'Adding a card', cls: 'bg-amber-100 text-amber-700' };
    if (c.invite_id && !c.accepted_at) return { label: 'Invited', cls: 'bg-forest-50 text-forest-800' };
    if (c.state === 'cancelled') return { label: 'Cancelled', cls: 'bg-line text-ink-500' };
    return { label: 'Off the rail', cls: 'bg-line text-ink-500' };
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-h2 text-forest-900">Customers</h1>
            <p className="mt-2 text-base text-ink-500">Everyone on a plan, and the ones you've invited to move off cash.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : 'Invite a customer'}
          </button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {open && (
          <form className="mt-6 rounded-lg border border-line bg-paper p-6" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <h2 className="text-lg font-semibold text-forest-900">Invite someone you already serve</h2>
            <p className="mt-1 text-base text-ink-700">
              They get one email: add a card, same service, same price, same day. Nothing about their service changes.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label><span className="field-label">Their name</span>
                <input className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label><span className="field-label">Email</span>
                <input className="field" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label><span className="field-label">Mobile phone</span>
                <input className="field" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label><span className="field-label">City</span>
                <select className="field" required value={form.area_slug} onChange={(e) => setForm({ ...form, area_slug: e.target.value })}>
                  <option value="">Choose</option>
                  {areas.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                </select></label>
              <label className="sm:col-span-2"><span className="field-label">Address</span>
                <input className="field" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
              <label><span className="field-label">What they pay you now, a month</span>
                <input className="field" inputMode="decimal" required placeholder="120" value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })} />
                <span className="mt-1 block text-sm text-ink-500">This is what they will be charged. Not the published price.</span></label>
              <label><span className="field-label">Next visit <span className="font-normal text-ink-400">(optional)</span></span>
                <input className="field" type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className="field-label">Anything to remember <span className="font-normal text-ink-400">(optional)</span></span>
                <input className="field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send the invite'}</button>
              <span className="text-sm text-ink-500">They can ignore it and keep paying cash.</span>
            </div>
          </form>
        )}

        {!rows ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" />
          : rows.length === 0 ? (
            <p className="mt-8 rounded-lg border border-line bg-paper p-6 text-base text-ink-700">
              No customers on the system yet. Invite the ones you already serve — each one that moves
              takes the same money it does today, without you chasing it.
            </p>
          ) : (
            <div className="mt-8 overflow-x-auto rounded-lg border border-line bg-paper">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-cream text-ink-500">
                  <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Where</th>
                    <th className="px-4 py-3">Day</th><th className="px-4 py-3">Monthly</th><th className="px-4 py-3">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => {
                    const s = status(c);
                    return (
                      <tr key={c.id}>
                        <td className="px-4 py-3">
                          <span className="font-medium text-forest-900">{c.name}</span>
                          <span className="block text-ink-500">{c.phone}{c.email ? ` · ${c.email}` : ''}</span>
                        </td>
                        <td className="px-4 py-3 text-ink-700">{c.address ?? '—'}{c.area_name ? `, ${c.area_name}` : ''}</td>
                        <td className="px-4 py-3 text-ink-700">{c.service_weekday == null ? '—' : DAYS[c.service_weekday]}</td>
                        <td className="px-4 py-3 tabular-nums text-forest-900">{money(c.monthly_price_cents)}</td>
                        <td className="px-4 py-3"><span className={`rounded-sm px-2 py-1 text-micro font-semibold uppercase ${s.cls}`}>{s.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </AdminLayout>
  );
}
