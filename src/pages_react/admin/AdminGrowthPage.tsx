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
 *
 * OUR OWN TEST VISITS ARE LEFT OUT, AND THE SCREEN SAYS HOW MANY (migration 033). On 2026-09-23
 * every one of the 25 sessions behind "Started a price" was AMTECH's own automated checking.
 * The server now filters those out; this screen prints the count it removed, because a filter
 * nobody can see is how a number stops being trusted in the other direction.
 *
 * AND IT SAYS WHERE VISITORS CAME FROM, which nothing here could say before. R16 found the top of
 * the funnel is this business's constraint — nearly everyone who asks for a price books — so the
 * channel a visitor arrived on is the most useful number on the page, and it had no column.
 */
import { useEffect, useState } from 'react';
import { adminApi, type GrowthBoard, type Metric } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';
import UnfinishedHour from '../../components/admin/UnfinishedHour';

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * A referrer host, in words an owner uses. Anything not listed shows as its own host — a
 * nextdoor.com or a local blog is exactly the kind of source worth seeing by name.
 */
const SOURCE_NAMES: Record<string, string> = {
  direct: 'Typed in, a text message or a saved link',
  'google.com': 'Google search',
  'maps.google.com': 'Google Maps',
  'bing.com': 'Bing',
  'duckduckgo.com': 'DuckDuckGo',
  'facebook.com': 'Facebook', 'm.facebook.com': 'Facebook', 'l.facebook.com': 'Facebook',
  'instagram.com': 'Instagram', 'l.instagram.com': 'Instagram',
  'nextdoor.com': 'Nextdoor',
  'yelp.com': 'Yelp',
  'chatgpt.com': 'ChatGPT', 'perplexity.ai': 'Perplexity',
};
const sourceName = (s: string) => SOURCE_NAMES[s] ?? s;

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
            {board.attributed === false ? (
              <p className="mt-3 rounded-md bg-amber-100 px-4 py-2.5 text-sm text-amber-700">
                These counts still include the website's own automated test visits — this database cannot yet tell
                them apart from customers.
              </p>
            ) : !!board.verifier_sessions_excluded && (
              <p className="mt-3 text-sm text-ink-500">
                {board.verifier_sessions_excluded} test {board.verifier_sessions_excluded === 1 ? 'visit' : 'visits'} by
                the website's own checks {board.verifier_sessions_excluded === 1 ? 'is' : 'are'} left out of these numbers.
              </p>
            )}

            {board.attributed && (
              <>
                <h2 className="mt-12 text-lg font-semibold text-forest-900">Where visitors came from</h2>
                <p className="mt-1 text-sm text-ink-500">This month, for everyone who started a price.</p>
                {(board.by_source ?? []).length === 0 ? (
                  <p className="mt-4 rounded-lg border border-line bg-paper p-5 text-base text-ink-700">
                    Nobody has started a price this month yet, so there is nothing to show here.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-cream text-ink-500">
                        <tr><th className="px-4 py-3">Came from</th><th className="px-4 py-3">Started a price</th><th className="px-4 py-3">Saw a price</th></tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {board.by_source!.map((r) => (
                          <tr key={r.source}>
                            <td className="px-4 py-3 font-medium text-forest-900">{sourceName(r.source)}</td>
                            <td className="px-4 py-3 tabular-nums">{r.sessions}</td>
                            <td className="px-4 py-3 tabular-nums">{r.priced}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            <h2 className="mt-12 text-lg font-semibold text-forest-900">The business</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="New customers" metric={m.new_customers_this_month} hint="This month" />
              <Tile label="Customers now" metric={m.customers_now} />
              <Tile label="Monthly recurring" metric={m.mrr_cents} format={money} />
              <Tile label="AMTECH's share" metric={m.platform_fee_this_month_cents} format={money} hint="9% of what was collected" />
            </div>

            {/*
              * WHERE THE NEXT CUSTOMER SHOULD COME FROM (server/lib/density.ts, migration 031).
              *
              * Every tile above counts what happened. This is the only block on the screen that
              * says what to DO, and the order changes as customers arrive: the driving a stop
              * costs falls as a city fills, so a city with twelve customers can be a better place
              * to find the thirteenth than an empty city half the distance away.
              *
              * IT IS IN MINUTES, NOT DOLLARS, on purpose. Nobody has asked Josue what an hour of
              * his time costs, so a margin here would be a number about his business that nobody
              * asked him for. Driving minutes against the 15 minutes a one-dog scoop takes is
              * enough to rank, and it is made only of facts.
              */}
            {board.where_next?.measured && board.where_next.areas.length > 0 && (
              <>
                <h2 className="mt-12 text-lg font-semibold text-forest-900">Where the next customer should come from</h2>
                <p className="mt-1 text-sm text-ink-500">
                  How much driving one more customer in each town adds, against the{' '}
                  {board.where_next.parameters?.referenceServiceMinutes ?? 15} minutes a weekly one-dog scoop takes.
                  Cheapest first. This re-orders itself as you sign people up.
                </p>
                {/*
                  WHERE THE MINUTES COME FROM. Until stops are timed on the Today screen, the visit
                  length is an estimate, and every row below inherits it. Saying so is the difference
                  between a ranking and a guess dressed as one.
                */}
                {board.where_next.parameters?.referenceBasis?.startsWith('service_tiers.est_minutes') && (
                  <p className="mt-1 text-sm text-ink-500">
                    The visit length is an estimate for now. It switches to your real times once enough stops have been
                    timed with <strong>On my way</strong> and <strong>I'm here</strong> on the Today screen.
                  </p>
                )}
                {board.where_next.geo_basis === 'polygon' && (
                  <p className="mt-2 rounded-md bg-amber-100 px-4 py-2.5 text-sm text-amber-700">
                    Distances are measured from the middle of each ZIP code's map area rather than from where people live,
                    which puts Ventura's own ZIP out at sea. Treat the order as rough.
                  </p>
                )}
                {/*
                  THE BASIS, NOT JUST THE ANSWER. One customer is enough to move their town to the
                  top — correct arithmetic, thin evidence. Printing the order without the count is
                  how a single test booking becomes a market judgement.
                */}
                {board.where_next.note && (
                  <p className="mt-2 rounded-md bg-amber-100 px-4 py-2.5 text-sm text-amber-700">{board.where_next.note}</p>
                )}
                <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-line bg-cream text-ink-500">
                      <tr>
                        <th className="px-4 py-3">Town</th>
                        <th className="px-4 py-3">Customers</th>
                        <th className="px-4 py-3">Miles out</th>
                        <th className="px-4 py-3">Driving for one more</th>
                        <th className="px-4 py-3">Worth a route day at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {board.where_next.areas.map((a) => (
                        <tr key={a.slug} className={a.marginal_ratio <= 1 ? 'text-forest-900' : 'text-ink-700'}>
                          <td className="px-4 py-3 font-medium">{a.name}</td>
                          <td className="px-4 py-3 tabular-nums">{a.customers_now || '—'}</td>
                          <td className="px-4 py-3 tabular-nums">{a.depot_miles}</td>
                          <td className="px-4 py-3 tabular-nums">
                            {a.marginal_drive_minutes} min
                            <span className="ml-2 text-ink-400">{a.marginal_ratio <= 1 ? 'pays for itself' : `${a.marginal_ratio}× the visit`}</span>
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {a.customers_for_parity === null
                              ? <span className="text-ink-400" title="More than a day holds, so this town only works alongside another one.">not on its own</span>
                              : `${a.customers_for_parity} customers`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {board.waitlist?.measured && board.waitlist.zips.length > 0 && (
                  <p className="mt-3 text-sm text-ink-500">
                    Nearest ZIP codes you do not cover yet:{' '}
                    {board.waitlist.zips.slice(0, 5).map((z) =>
                      // A ZIP whose land is far further out than its people is mostly island or
                      // wilderness — 93042 is San Nicolas Island with its residents at Point Mugu.
                      `${z.postal_code} (${z.city_name}, ${z.depot_miles}mi${z.polygon_miles !== undefined && z.polygon_miles - z.depot_miles > 20 ? ', mostly offshore' : ''})`,
                    ).join(' · ')}
                  </p>
                )}
              </>
            )}
            {board.where_next && !board.where_next.measured && (
              <p className="mt-12 rounded-lg border border-line bg-paper p-5 text-base text-ink-700">
                <strong>Where the next customer should come from</strong> is not measured yet.{' '}
                {board.where_next.note}
              </p>
            )}

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
