/**
 * Loop 1, speed to lead (P16 §7) — the block, on its own, so it can be on more than one screen.
 *
 * Oldroyd & McElheran across 2,241 US firms: replying inside the hour makes a lead about 7x
 * more likely to qualify, and 60x against a day. 23% of those firms never replied at all. So
 * this is not a report — it is the thing to do next, and one tap opens Josue's own SMS app with
 * the message already written. No Twilio, no 10DLC, no cost, and it comes from the number his
 * customers already have.
 *
 * IT WAS ONLY ON /admin/growth, which is a page nobody opens hourly. P16 §7 calls it "the
 * admin's TOP block" and the admin's top is the dashboard, where the owner lands. It is a
 * component rather than a copy: two hand-maintained versions of an urgent list is how one of
 * them ends up a week behind the other.
 *
 * It re-reads itself every minute because it is only useful while it is fresh. Nothing else on
 * either screen moves fast enough to be worth a timer.
 */
import { useEffect, useState } from 'react';
import { adminApi, type UnfinishedRow } from '../../lib/adminApi';

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
};

type Hour = { measured: boolean; note?: string; rows: UnfinishedRow[] };

export default function UnfinishedHour({ className = '' }: { className?: string }) {
  const [hour, setHour] = useState<Hour | null>(null);

  useEffect(() => {
    const read = async () => {
      try { setHour(await adminApi.unfinished()); } catch { /* keep the last good read */ }
    };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className={`rounded-lg border-2 border-amber-500 bg-amber-100/40 p-6 ${className}`} data-unfinished-hour>
      <h2 className="text-lg font-semibold text-forest-900">Unfinished in the last hour</h2>
      {!hour ? <p className="mt-2 text-base text-ink-500">Loading…</p>
        : !hour.measured ? <p className="mt-2 text-base text-ink-700">{hour.note} Once it does, anyone who starts and stops shows up here within the minute.</p>
        : hour.rows.length === 0 ? <p className="mt-2 text-base text-ink-700">Nobody started and stopped in the last hour.</p>
        : (
          <ul className="mt-4 space-y-3">
            {hour.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-paper px-4 py-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-forest-900">
                    {r.name || 'Someone'} · {r.area}{r.postal_code ? ` ${r.postal_code}` : ''}
                  </p>
                  <p className="text-sm text-ink-500">
                    {r.plan ?? 'no plan chosen'}{r.price_cents_seen ? ` · saw ${money(r.price_cents_seen)}/mo` : ''} · stopped at “{r.step ?? 'the start'}” · {ago(r.last_seen_at)}
                  </p>
                </div>
                {r.sms_href
                  ? <a href={r.sms_href} className="btn-primary btn-sm shrink-0">Text {String(r.name ?? '').split(' ')[0] || 'them'}</a>
                  : <span className="text-sm text-ink-400">No number given</span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
