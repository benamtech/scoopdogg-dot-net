/**
 * The rate card. Every price on the site, editable by the owner, without us.
 *
 * THE SCREEN'S REAL JOB IS NOT THE FORM. Grandfathering is already structural — the
 * `packages_version` trigger bumps the version, `stripe_prices` is keyed on it, and a
 * subscription froze its own `monthly_price_cents` at sign-up. None of that is new here.
 *
 * What is new is that the owner can see it. A price editor he is afraid of is a price editor he
 * will not use, so this screen states the rule at the top, shows him exactly who is on each
 * price BEFORE he changes it, and shows what those people are still paying AFTER. The third one
 * is the only one that is proof rather than a promise.
 *
 * AND IT SAYS WHAT A SAVE DOES NOT DO. The public pages are built from content/catalog.json, so
 * a new price reaches the checkout immediately and the website on the next publish. The server
 * returns `effective_now` / `effective_on_publish` and this prints them rather than deciding for
 * itself, because the day those pages render on demand the sentence stops being true and has to
 * stop being printed — one row, no component edit.
 */
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type RateCard, type RateCardTier, type RateCardPackage } from '../../lib/adminApi';

const money = (c: number | null) => (c === null ? '—' : `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`);
const dollars = (c: number | null) => (c === null ? '' : String(c / 100));
const toCents = (s: string) => {
  const n = Number(String(s).trim().replace(/^\$/, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export default function AdminRateCardPage() {
  const [card, setCard] = useState<RateCard | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Edit panel for one tier (label, suffix, "from", retire), and the add-a-tier form for one service.
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ label: string; suffix: string; from: boolean }>({ label: '', suffix: '', from: false });
  const [adding, setAdding] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ label: string; price: string; suffix: string; quote: boolean; from: boolean }>({ label: '', price: '', suffix: '', quote: false, from: false });

  const [pub, setPub] = useState<Awaited<ReturnType<typeof adminApi.publishStatus>> | null>(null);
  const load = async () => {
    try { setCard(await adminApi.rateCard()); }
    catch (e) { setError((e as Error).message); }
    adminApi.publishStatus().then(setPub).catch(() => setPub(null));
  };
  useEffect(() => { load(); }, []);

  const byService = useMemo(() => {
    if (!card) return [];
    return card.services.map((s) => ({
      ...s,
      tiers: card.tiers.filter((t) => t.service_slug === s.slug),
      packages: card.packages.filter((p) => p.service_slug === s.slug),
    })).filter((s) => s.tiers.length || s.packages.length);
  }, [card]);

  const publishLine = (e: { effective_now: string[]; effective_on_publish: string[] }) =>
    e.effective_on_publish.length
      ? ` Live now for ${e.effective_now[0]}; the public pages show it at the next publish.`
      : ' Live everywhere now.';

  const saveTier = async (t: RateCardTier, patch: Parameters<typeof adminApi.setTier>[1]) => {
    setBusy(t.id); setError(''); setNote('');
    try {
      const r = await adminApi.setTier(t.id, patch);
      setNote(r.changed.length
        ? `Saved ${t.label}.${publishLine(r)}`
        : `Nothing changed on ${t.label}.`);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const addTier = async (serviceSlug: string, serviceName: string) => {
    setBusy(`add:${serviceSlug}`); setError(''); setNote('');
    try {
      const r = await adminApi.addTier({
        service_slug: serviceSlug, label: fresh.label, price_cents: fresh.quote ? null : toCents(fresh.price),
        price_suffix: fresh.suffix, requires_quote: fresh.quote, price_is_from: !fresh.quote && fresh.from,
      });
      setNote(`Added "${r.tier.label}" to ${serviceName}.${publishLine(r)}`);
      setAdding(null); setFresh({ label: '', price: '', suffix: '', quote: false, from: false });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const savePackage = async (p: RateCardPackage, cents: number) => {
    setBusy(p.id); setError(''); setNote('');
    try {
      const r = await adminApi.setPackagePrice(p.id, cents);
      if (!r.changed.length) { setNote(`Nothing changed on ${p.name}.`); }
      else {
        const stripe = Object.entries(r.published)
          .filter(([, v]) => v.attempted)
          .map(([m, v]) => `${v.created} new ${m} price${v.created === 1 ? '' : 's'} on Stripe`);
        const kept = p.live_customers > 0
          ? ` ${p.live_customers} existing customer${p.live_customers === 1 ? '' : 's'} still pay${p.live_customers === 1 ? 's' : ''} ${p.frozen_prices.map(money).join(' and ')}.`
          : '';
        setNote(`${p.name} is now ${money(cents)} a month.${kept}${publishLine(r)}${stripe.length ? ` ${stripe.join(', ')}.` : ''}`);
      }
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <h1 className="font-serif text-h2 text-forest-900">Rate card</h1>
        <p className="mt-2 text-base text-ink-500">
          Every price the site quotes. Change one here and the next customer is quoted the new
          number.
        </p>

        {/* The rule, out loud, every time. P7: the screen's job is to make him believe a thing
            that is already true. */}
        <div className="mt-6 rounded-lg border border-forest-400 bg-cream p-5">
          <p className="text-base text-forest-900">
            <strong className="font-semibold">Raising a price here does not touch a single existing customer.</strong>{' '}
            Everyone already signed up keeps the price they were sold, for as long as they stay.
            You can see what each of them is paying beside their plan below.
          </p>
          {card && card.effective_on_publish.length > 0 && (
            <p className="mt-3 text-sm text-ink-600">
              A new price applies to {card.effective_now.join(', ')} straight away. Your public
              website still shows the old number until the site is published again.
            </p>
          )}
          {pub && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" data-publish>
              {pub.configured ? (
                <button type="button" className="btn-forest btn-sm" disabled={!!busy}
                  onClick={async () => { setBusy('publish'); setError(''); try { await adminApi.publish('rate card'); setNote('Publishing. The website usually shows new prices within two minutes.'); setPub(await adminApi.publishStatus()); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }}>
                  {busy === 'publish' ? 'Publishing…' : 'Publish the website now'}
                </button>
              ) : <span className="text-ink-500">Publishing from here is switched on when the new site goes live.</span>}
              {pub.publishes[0] && (
                <span className="text-ink-500">Last publish {new Date(pub.publishes[0].created_at).toLocaleString()}: {pub.publishes[0].state === 'live' ? 'live on the site' : pub.publishes[0].state === 'building' ? 'building' : pub.publishes[0].state === 'failed' ? 'did not go through' : 'queued'}.</span>
              )}
            </div>
          )}
        </div>

        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {!card ? (
          <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" />
        ) : (
          <>
            {byService.map((s) => (
              <section key={s.slug} className="mt-10">
                <h2 className="font-serif text-h3 text-forest-900">{s.name}</h2>

                {s.packages.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-cream text-ink-500">
                        <tr>
                          <th className="px-5 py-3 font-medium">Monthly plan</th>
                          <th className="px-5 py-3 font-medium">Price</th>
                          <th className="px-5 py-3 font-medium">On it now</th>
                          <th className="px-5 py-3 font-medium">Stripe</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {s.packages.map((p) => {
                          const key = `pkg:${p.id}`;
                          const value = draft[key] ?? dollars(p.monthly_price_cents);
                          const cents = toCents(value);
                          const dirty = cents !== null && cents !== p.monthly_price_cents;
                          return (
                            <tr key={p.id} data-package={p.slug}>
                              <td className="px-5 py-4 text-forest-900">
                                {p.name}
                                <span className="ml-2 text-micro text-ink-500">v{p.version}</span>
                              </td>
                              <td className="px-5 py-4">
                                <label className="flex items-center gap-1">
                                  <span className="text-ink-500">$</span>
                                  <input
                                    className="field w-24 tabular-nums" inputMode="decimal"
                                    aria-label={`Monthly price for ${p.name}`}
                                    value={value}
                                    onChange={(ev) => setDraft({ ...draft, [key]: ev.target.value })} />
                                  <span className="text-ink-500">/mo</span>
                                </label>
                              </td>
                              <td className="px-5 py-4 tabular-nums text-forest-900">
                                {p.live_customers === 0 ? <span className="text-ink-500">nobody yet</span> : (
                                  <>
                                    {p.live_customers}
                                    <span className="ml-2 text-micro text-ink-500">
                                      paying {p.frozen_prices.map(money).join(', ')}
                                    </span>
                                  </>
                                )}
                              </td>
                              <td className="px-5 py-4 text-micro text-ink-500">
                                {p.published_test ? 'test ✓' : 'test —'}{' · '}
                                {p.published_live ? 'live ✓' : 'live —'}
                              </td>
                              <td className="px-5 py-4 text-right">
                                <button type="button" className="btn-primary btn-sm"
                                  disabled={!!busy || !dirty}
                                  onClick={() => savePackage(p, cents as number)}>
                                  {busy === p.id ? 'Saving…' : 'Save'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {s.tiers.length > 0 && (
                  <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper">
                    {s.tiers.map((t) => {
                      const key = `tier:${t.id}`;
                      const value = draft[key] ?? dollars(t.price_cents);
                      const cents = toCents(value);
                      const dirty = !t.requires_quote && cents !== null && cents !== t.price_cents;
                      return (
                        <li key={t.id} data-tier={t.id}
                          className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${t.status === 'retired' ? 'opacity-60' : ''}`}>
                          <div className="min-w-[14rem]">
                            <p className="text-base text-forest-900">
                              {t.label}
                              {t.status === 'retired' && <span className="ml-2 text-micro text-ink-500">retired</span>}
                            </p>
                            <p className="text-micro text-ink-500">
                              {t.requires_quote ? 'quote only — no number on the site'
                                : t.price_is_from ? `shown as "from ${money(t.price_cents)}"`
                                : `shown as ${money(t.price_cents)}${t.price_suffix ?? ''}`}
                              {t.live_customers > 0 && ` · ${t.live_customers} sold through this`}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {!t.requires_quote && (
                              <label className="flex items-center gap-1">
                                <span className="text-ink-500">$</span>
                                <input
                                  className="field w-24 tabular-nums" inputMode="decimal"
                                  aria-label={`Price for ${t.label}`}
                                  value={value}
                                  onChange={(ev) => setDraft({ ...draft, [key]: ev.target.value })} />
                              </label>
                            )}
                            <label className="flex items-center gap-2 text-sm text-ink-700">
                              <input type="checkbox" checked={t.requires_quote} disabled={!!busy}
                                onChange={(ev) => saveTier(t, { requires_quote: ev.target.checked })} />
                              Quote only
                            </label>
                            <button type="button" className="btn-primary btn-sm"
                              disabled={!!busy || !dirty}
                              onClick={() => saveTier(t, { price_cents: cents })}>
                              {busy === t.id ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" className="text-sm text-ink-500 hover:text-forest-900" data-edit-tier={t.id}
                              onClick={() => { setEditing(editing === t.id ? null : t.id); setEdit({ label: t.label, suffix: t.price_suffix ?? '', from: t.price_is_from }); }}>
                              {editing === t.id ? 'Close' : 'Edit'}
                            </button>
                          </div>
                          {editing === t.id && (
                            <div className="w-full rounded-md border border-line bg-cream p-4" data-tier-editor>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <label className="text-sm text-ink-700 sm:col-span-2">Name the customer reads
                                  <input className="field mt-1" value={edit.label} onChange={(ev) => setEdit({ ...edit, label: ev.target.value })} /></label>
                                <label className="text-sm text-ink-700">After the price (e.g. " / visit")
                                  <input className="field mt-1" value={edit.suffix} onChange={(ev) => setEdit({ ...edit, suffix: ev.target.value })} /></label>
                              </div>
                              {!t.requires_quote && (
                                <label className="mt-3 flex items-center gap-2 text-sm text-ink-700">
                                  <input type="checkbox" checked={edit.from} onChange={(ev) => setEdit({ ...edit, from: ev.target.checked })} />
                                  Show it as a starting price ("from {money(t.price_cents)}"), when the real price depends on the job
                                </label>
                              )}
                              <div className="mt-4 flex flex-wrap items-center gap-3">
                                <button type="button" className="btn-primary btn-sm" disabled={!!busy}
                                  onClick={() => saveTier(t, { label: edit.label, price_suffix: edit.suffix, ...(t.requires_quote ? {} : { price_is_from: edit.from }) })}>Save changes</button>
                                {t.status === 'active'
                                  ? <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => saveTier(t, { status: 'retired' })}>Stop offering this tier</button>
                                  : <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => saveTier(t, { status: 'active' })}>Offer it again</button>}
                                <span className="text-micro text-ink-500">Stopping a tier takes it off the site. Anyone already on it keeps it.</span>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {adding === s.slug ? (
                  <div className="mt-3 rounded-lg border border-line bg-paper p-4" data-add-tier={s.slug}>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <label className="text-sm text-ink-700 sm:col-span-2">Name the customer reads
                        <input className="field mt-1" value={fresh.label} placeholder="Large yard (500+ sq ft)" onChange={(ev) => setFresh({ ...fresh, label: ev.target.value })} /></label>
                      {!fresh.quote && (
                        <label className="text-sm text-ink-700">Price
                          <input className="field mt-1 tabular-nums" inputMode="decimal" value={fresh.price} placeholder="0" onChange={(ev) => setFresh({ ...fresh, price: ev.target.value })} /></label>
                      )}
                      {!fresh.quote && (
                        <label className="text-sm text-ink-700">After the price
                          <input className="field mt-1" value={fresh.suffix} placeholder=" / visit" onChange={(ev) => setFresh({ ...fresh, suffix: ev.target.value })} /></label>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-700">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fresh.quote} onChange={(ev) => setFresh({ ...fresh, quote: ev.target.checked })} /> Quote only (no number on the site)</label>
                      {!fresh.quote && <label className="flex items-center gap-2"><input type="checkbox" checked={fresh.from} onChange={(ev) => setFresh({ ...fresh, from: ev.target.checked })} /> Show as a starting price</label>}
                    </div>
                    <div className="mt-4 flex gap-3">
                      <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => addTier(s.slug, s.name)}>{busy === `add:${s.slug}` ? 'Adding…' : 'Add tier'}</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="mt-3 text-sm font-medium text-forest-700 hover:text-forest-900" onClick={() => { setAdding(s.slug); setFresh({ label: '', price: '', suffix: '', quote: false, from: false }); }}>+ Add a tier to {s.name}</button>
                )}
              </section>
            ))}

            {/* What was changed, and what it was before. The catalog rows only ever hold the
                current value, so without this there is no answer to "what was this?" */}
            <section className="mt-12">
              <h2 className="font-serif text-h3 text-forest-900">Recent changes</h2>
              {card.changes.length === 0 ? (
                <div className="mt-4 rounded-lg border border-line bg-paper px-5 py-6">
                  <p className="text-base text-ink-500">
                    No price has been changed from this screen yet. When one is, it is listed here
                    with what it was before.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper">
                  {card.changes.map((c, i) => (
                    <li key={`${c.entity_id}-${c.changed_at}-${i}`} className="px-5 py-3 text-sm text-ink-700">
                      <span className="text-forest-900">{c.entity_label}</span>{' — '}
                      {c.field.replace(/_/g, ' ')}{' '}
                      {c.old_value !== null && <>was <span className="tabular-nums">{c.old_value}</span>, </>}
                      now <span className="tabular-nums text-forest-900">{c.new_value ?? '—'}</span>
                      <span className="ml-2 text-micro text-ink-500">
                        {new Date(c.changed_at).toLocaleDateString()} · {c.changed_by}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
