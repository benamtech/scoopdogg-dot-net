/**
 * The onboarding checklist (P18 §2): the six things only Josue can answer, each one saying what
 * it changes on his site rather than what the software wants.
 *
 * TWO RULES ARE VISIBLE IN THIS FILE.
 *
 * It never blocks anything. Every item is optional, the admin works with all six untouched, and
 * the site degrades honestly against each empty one — the day picker offers every service day
 * when a city has no route days, and a claim with no row simply does not appear.
 *
 * An item whose answer cannot be READ says so instead of showing a cross. `done === null` is not
 * "no": photo storage is not connected and the postal map does not exist yet, and reporting
 * either as an unticked box would tell the owner he has homework that is actually ours.
 */
import { useEffect, useState } from 'react';
import { adminApi, type ChecklistItem, type ChecklistArea } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Data = Awaited<ReturnType<typeof adminApi.checklist>>;

export default function AdminChecklistPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const load = async () => { try { setData(await adminApi.checklist()); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);

  const toggleDay = async (area: ChecklistArea, day: number) => {
    const next = area.service_weekdays.includes(day)
      ? area.service_weekdays.filter((d) => d !== day)
      : [...area.service_weekdays, day].sort();
    setBusy(`${area.slug}-${day}`);
    // Optimistic, then reload: the grid is 112 taps and a round trip per tap would make it feel
    // broken. The reload is what makes the checklist above it agree.
    setData((d) => d && ({ ...d, areas: d.areas.map((a) => (a.slug === area.slug ? { ...a, service_weekdays: next } : a)) }));
    try { await adminApi.setRouteDays(area.slug, next); await load(); }
    catch (e) { setError((e as Error).message); await load(); }
    finally { setBusy(''); }
  };

  const saveFact = async (key: string, value: unknown) => {
    setBusy(key); setNote('');
    try { await adminApi.setBusinessFact(key, value); setNote('Saved.'); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const confirmPrices = async () => {
    setBusy('prices');
    try { const r = await adminApi.confirmPrices(); setNote(`${r.confirmed} plan(s) confirmed.`); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const Mark = ({ item }: { item: ChecklistItem }) => (
    <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
      item.done === true ? 'bg-success-100 text-success' : item.done === null ? 'bg-line text-ink-500' : 'bg-amber-100 text-amber-700'}`}>
      {item.done === true ? '✓' : item.done === null ? '–' : '!'}
    </span>
  );

  const facts = (data?.facts ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof facts[k] === 'string' ? (facts[k] as string) : '');
  const num = (k: string) => (typeof facts[k] === 'number' ? String(facts[k]) : '');

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <h1 className="font-serif text-h2 text-forest-900">Your setup</h1>
        <p className="mt-2 text-base text-ink-500">
          Six things only you can answer. Nothing here is required — the site works without them and
          simply says less. {data && <strong className="font-semibold text-forest-900">{data.done} of {data.measurable} done.</strong>}
        </p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {!data ? <div className="mt-8 h-64 animate-pulse rounded-lg bg-line/50" /> : (
          <div className="mt-8 space-y-4">
            {data.items.map((item) => (
              <section key={item.key} className="rounded-lg border border-line bg-paper p-6">
                <div className="flex gap-4">
                  <Mark item={item} />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-forest-900">{item.title}</h2>
                    <p className="mt-1 text-base text-ink-700">{item.what_it_changes}</p>
                    <p className="mt-2 text-sm text-ink-500">{item.detail}</p>
                    {item.blocked_reason && (
                      <p className="mt-2 text-sm text-amber-700">Not on you: {item.blocked_reason}</p>
                    )}

                    {item.key === 'stripe' && (
                      <a href="/admin/payments" className="btn-secondary btn-sm mt-4 inline-block">Open payments</a>
                    )}

                    {item.key === 'route_days' && (
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="text-ink-500">
                            <tr><th className="py-2 pr-4 font-medium">City</th>
                              {DAYS.map((d) => <th key={d} className="px-2 py-2 text-center font-medium">{d}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {data.areas.map((a) => (
                              <tr key={a.slug}>
                                <td className="py-2 pr-4 font-medium text-forest-900">{a.name}</td>
                                {DAYS.map((_, day) => {
                                  const on = a.service_weekdays.includes(day);
                                  return (
                                    <td key={day} className="px-1 py-1 text-center">
                                      <button type="button" aria-pressed={on} disabled={busy === `${a.slug}-${day}`}
                                        aria-label={`${a.name} ${DAYS[day]}`}
                                        onClick={() => toggleDay(a, day)}
                                        className={`h-8 w-8 rounded-md border text-sm transition duration-fast ${
                                          on ? 'border-forest-600 bg-forest-600 text-white' : 'border-line-strong bg-paper text-ink-400 hover:border-forest-400'}`}>
                                        {on ? '✓' : ''}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {item.key === 'business_facts' && (
                      <div className="mt-4 grid gap-4">
                        {([
                          ['trust.insured_confirmed', 'Are you insured?'],
                          ['trust.background_checked_confirmed', 'Is everyone who works for you background-checked?'],
                        ] as const).map(([key, label]) => (
                          <div key={key} className="flex flex-wrap items-center gap-3">
                            <span className="text-base text-forest-900">{label}</span>
                            {([['Yes', true], ['No', false]] as const).map(([txt, val]) => (
                              <button key={txt} type="button" disabled={busy === key} onClick={() => saveFact(key, val)}
                                aria-pressed={facts[key] === val}
                                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                                  facts[key] === val ? 'border-forest-600 bg-forest-600 text-white' : 'border-line-strong bg-paper text-forest-800'}`}>{txt}</button>
                            ))}
                          </div>
                        ))}
                        <label className="block">
                          <span className="field-label">Your guarantee, in your words</span>
                          <textarea className="field min-h-[72px]" defaultValue={str('trust.guarantee_text')}
                            onBlur={(e) => e.target.value !== str('trust.guarantee_text') && saveFact('trust.guarantee_text', e.target.value)} />
                        </label>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="block">
                            <span className="field-label">How many Google reviews do you have?</span>
                            <input className="field" inputMode="numeric" defaultValue={num('reviews.google_count')}
                              onBlur={(e) => e.target.value && Number(e.target.value) !== facts['reviews.google_count'] && saveFact('reviews.google_count', Number(e.target.value))} />
                          </label>
                          <label className="block">
                            <span className="field-label">Years in business</span>
                            <input className="field" inputMode="numeric" defaultValue={num('business.years_in_business')}
                              onBlur={(e) => e.target.value && Number(e.target.value) !== facts['business.years_in_business'] && saveFact('business.years_in_business', Number(e.target.value))} />
                          </label>
                        </div>
                        <p className="text-sm text-ink-500">
                          The site says nothing it cannot read here. Leave one blank and the page leaves it out.
                        </p>
                      </div>
                    )}

                    {item.key === 'prices' && (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <a href="/admin/payments" className="btn-ghost btn-sm">See the plans</a>
                        <button type="button" className="btn-primary btn-sm" disabled={busy === 'prices'} onClick={confirmPrices}>
                          {busy === 'prices' ? 'Saving…' : 'These are my prices'}
                        </button>
                      </div>
                    )}

                    {item.key === 'where_you_work' && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {data.areas.map((a) => (
                          <button key={a.slug} type="button" aria-pressed={a.bookable} disabled={busy === `area-${a.slug}`}
                            onClick={async () => {
                              setBusy(`area-${a.slug}`);
                              try { await adminApi.setAreaBookable(a.slug, !a.bookable); await load(); }
                              catch (e) { setError((e as Error).message); }
                              finally { setBusy(''); }
                            }}
                            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                              a.bookable ? 'border-forest-600 bg-forest-50 text-forest-900' : 'border-line-strong bg-paper text-ink-400 line-through'}`}>
                            {a.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
