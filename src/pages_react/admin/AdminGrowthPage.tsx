/**
 * The growth board (P18 §4) and the speed-to-lead block (P16 §7).
 *
 * P19 §2 put this screen inside the definition of done rather than after it, because the number
 * R8 calls the scoreboard — booking-intent sessions — has never been measured at all, and the
 * distance to 100 customers in six months (~18 gross a month against a site that has produced 26
 * leads in its life) cannot be worked on until it has a shape.
 *
 * A NUMBER THAT WAS NEVER MEASURED IS PRINTED AS SUCH. "0 starts" and "we have never counted
 * starts" look identical in a stat tile and mean opposite things: one says fix the funnel, the
 * other says fix the counting. Every metric carries `measured`, and this screen renders a dash
 * and the reason rather than a zero. It is the same rule as the site's: degrade honestly.
 */
import { useEffect, useState } from 'react';
import { adminApi, type GrowthBoard, type Metric } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';
import UnfinishedHour from '../../components/admin/UnfinishedHour';

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function Tile({ label, metric, format = (n: number) => String(n), hint }: {
  label: string; metric: Metric; format?: (n: number) => string; hint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-paper p-5">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      {metric.measured && metric.value !== null ? (
        <p className="mt-2 font-serif text-h3 tabular-nums text-forest-900">{format(metric.value)}</p>
      ) : (
        <p className="mt-2 font-serif text-h3 text-ink-400" title={metric.note}>—</p>
      )}
      <p className="mt-1 text-sm text-ink-500">{metric.measured ? hint ?? '' : metric.note ?? 'Not measured yet.'}</p>
    </div>
  );
}

export default function AdminGrowthPage() {
  const [board, setBoard] = useState<GrowthBoard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try { setBoard(await adminApi.growth()); }
      catch (e) { setError((e as Error).message); }
    };
    load();
  }, []);

  const m = board?.metrics;

  return (
    <AdminLayout>
      <div className="max-w-5xl">
        <h1 className="font-serif text-h2 text-forest-900">Growth</h1>
        <p className="mt-2 text-base text-ink-500">This month, from your own rows. No tracking scripts, no analytics company.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}

        <UnfinishedHour className="mt-8" />

        {m && (
          <>
            <h2 className="mt-12 text-lg font-semibold text-forest-900">The funnel, this month</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Started a price" metric={m.booking_intent_starts} hint="Typed a ZIP" />
              <Tile label="Saw a price" metric={m.price_step_reached} />
              <Tile label="Booked" metric={m.booked} />
              <Tile label="Conversion" metric={m.conversion_pct} format={(n) => `${n}%`} />
            </div>

            <h2 className="mt-12 text-lg font-semibold text-forest-900">The business</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="New customers" metric={m.new_customers_this_month} hint="This month" />
              <Tile label="Customers now" metric={m.customers_now} />
              <Tile label="Monthly recurring" metric={m.mrr_cents} format={money} />
              <Tile label="AMTECH's share" metric={m.platform_fee_this_month_cents} format={money} hint="9% of what was collected" />
            </div>

            {/* P17 §9: the 1099-K reports gross, so the fee is a number his accountant needs. */}
            <h2 className="mt-12 text-lg font-semibold text-forest-900">Payments and fees</h2>
            <p className="mt-1 text-sm text-ink-500">
              Your 1099-K from Stripe reports the full amount your customers paid. These are the fees to deduct.
            </p>
            {board.fees_by_month.length === 0 ? (
              <p className="mt-4 rounded-lg border border-line bg-paper p-5 text-base text-ink-700">
                No payments have been taken through the site yet.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-cream text-ink-500">
                    <tr><th className="px-4 py-3">Period</th><th className="px-4 py-3">Payments</th>
                      <th className="px-4 py-3">Collected</th><th className="px-4 py-3">AMTECH's 9%</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...board.fees_by_year.map((r) => ({ ...r, year: true })), ...board.fees_by_month.map((r) => ({ ...r, year: false }))].map((r) => (
                      <tr key={`${r.year ? 'y' : 'm'}-${r.period}`} className={r.year ? 'font-semibold text-forest-900' : ''}>
                        <td className="px-4 py-3">{r.period}</td>
                        <td className="px-4 py-3 tabular-nums">{r.payments}</td>
                        <td className="px-4 py-3 tabular-nums">{money(r.collected_cents)}</td>
                        <td className="px-4 py-3 tabular-nums">{money(r.fee_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
