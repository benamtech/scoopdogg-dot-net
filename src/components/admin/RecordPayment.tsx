/**
 * Record a payment that did not go through the site: cash, Venmo, Zelle, a check. Used on the Jobs
 * screen and the customer's page. It is written down as a manual payment with no AMTECH fee and
 * stays out of the fee report (server/lib/business.ts recordManualPayment).
 */
import { useState } from 'react';
import { adminApi, type ManualMethod } from '../../lib/adminApi';

const METHODS: [ManualMethod, string][] = [['cash', 'Cash'], ['venmo', 'Venmo'], ['zelle', 'Zelle'], ['check', 'Check'], ['other', 'Other']];

export default function RecordPayment({ customerId, quoteId, invoiceId, suggestCents, onDone, onCancel }: {
  customerId: string; quoteId?: string | null; invoiceId?: string | null; suggestCents?: number;
  onDone: (message: string) => void; onCancel: () => void;
}) {
  const [amount, setAmount] = useState(suggestCents ? String(suggestCents / 100) : '');
  const [method, setMethod] = useState<ManualMethod>('cash');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, '')) * 100);

  const save = async () => {
    setBusy(true); setError('');
    try {
      await adminApi.recordPayment({ customer_id: customerId, amount_cents: cents, method, note, quote_id: quoteId ?? null, invoice_id: invoiceId ?? null, paid_on: paidOn });
      onDone(`Recorded $${(cents / 100).toFixed(2).replace(/\.00$/, '')} by ${METHODS.find((m) => m[0] === method)?.[1]}. No fee is taken on it.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 grid gap-3 border border-line bg-cream p-4" data-record-payment>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm text-ink-700">Amount
          <span className="flex items-center gap-1"><span className="text-ink-500">$</span>
            <input className="field tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount paid" /></span>
        </label>
        <label className="grid gap-1 text-sm text-ink-700">How
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-ink-700">Paid on
          <input type="date" className="field" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1 text-sm text-ink-700">Note (optional)
        <input className="field" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Venmo @name" />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-3">
        <button type="button" className="btn-primary btn-sm" disabled={busy || !(cents > 0)} onClick={save}>{busy ? 'Saving…' : 'Record payment'}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
