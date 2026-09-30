/**
 * Offers: what the site promises off the first month, edited by the owner himself.
 *
 * Every offer is a first-month percentage off a monthly plan — the one shape the checkout honours
 * (a Stripe coupon applied once). He can change the name, the discount and which services it
 * applies to, pause it, bring it back, or add a new one. Nothing is deleted: the customers who
 * signed up on an offer are counted from their own bookings, and that count must keep meaning
 * something.
 *
 * The server holds the rules (server/lib/offers.ts) and this prints its sentences. The one worth
 * knowing before typing: the site shows the NAME and the checkout applies the DISCOUNT, so a name
 * that says "half off" is refused on a 40% offer.
 *
 * A save is on the public pages within seconds and at the next checkout; nothing to publish.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type AdminOffer, type OfferInput } from '../../lib/adminApi';

type Draft = { name: string; description: string; value: string; applies: string[]; requires: string[] };
const toDraft = (o?: AdminOffer): Draft => ({
  name: o?.name ?? '', description: o?.description ?? '', value: o ? String(o.value) : '50',
  applies: o?.applies_to_slugs ?? [], requires: o?.requires_slugs ?? [],
});
const toInput = (d: Draft): OfferInput => ({
  name: d.name, description: d.description, value: Number(d.value), applies_to_slugs: d.applies, requires_slugs: d.requires,
});

function ServicePicks({ label, services, picked, onChange, hint }: {
  label: string; hint: string; services: { slug: string; name: string }[]; picked: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-1 text-sm text-ink-700">
      <legend>{label}</legend>
      <p className="text-xs text-ink-500">{hint}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {services.map((s) => {
          const on = picked.includes(s.slug);
          return (
            <label key={s.slug} className={`cursor-pointer border px-3 py-1.5 text-sm ${on ? 'border-forest bg-forest text-white' : 'border-line bg-paper text-ink-700'}`}>
              <input type="checkbox" className="sr-only" checked={on}
                     onChange={() => onChange(on ? picked.filter((x) => x !== s.slug) : [...picked, s.slug])} />
              {s.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function OfferForm({ draft, setDraft, services }: { draft: Draft; setDraft: (d: Draft) => void; services: { slug: string; name: string; monthly: boolean }[] }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <label className="grid gap-1 text-sm text-ink-700">Name — what the site shows
          <input className="field" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="First month half off" />
        </label>
        <label className="grid gap-1 text-sm text-ink-700">Off the first month
          <span className="flex items-center gap-2"><input className="field w-20" inputMode="numeric" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value.replace(/[^\d]/g, '') })} />%</span>
        </label>
      </div>
      <label className="grid gap-1 text-sm text-ink-700">Note for yourself (not shown on the site)
        <input className="field" value={draft.description} maxLength={400} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <ServicePicks label="Takes money off" hint="The monthly plans this discount applies to." services={services.filter((s) => s.monthly)} picked={draft.applies} onChange={(v) => setDraft({ ...draft, applies: v })} />
      <ServicePicks label="Only when they also book" hint="Leave empty for everyone. Pick a service to make it a bundle deal." services={services.filter((s) => !draft.applies.includes(s.slug))} picked={draft.requires} onChange={(v) => setDraft({ ...draft, requires: v })} />
    </div>
  );
}

export default function AdminOffersPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.offers>> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => { try { setData(await adminApi.offers()); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);
  const nameOf = (slug: string) => data?.services.find((s) => s.slug === slug)?.name ?? slug;

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setError(''); setNote('');
    try { setNote(await fn()); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Offers</h1>
        <p className="mt-2 text-base text-ink-500">
          What your website offers off a new customer&rsquo;s first month. A change is on your website and at checkout within seconds.
        </p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {!data ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : (
          <ul className="mt-8 grid gap-4" data-offers>
            {data.offers.map((o) => (
              <li key={o.id} className={`rounded-lg border bg-paper p-5 ${o.status === 'active' ? 'border-line' : 'border-dashed border-line text-ink-500'}`}>
                {editing === o.id ? (
                  <>
                    <OfferForm draft={draft} setDraft={setDraft} services={data.services} />
                    <div className="mt-4 flex gap-3">
                      <button type="button" className="btn-primary btn-sm" disabled={!!busy}
                              onClick={() => run(o.id, async () => { await adminApi.saveOffer(o.id, toInput(draft)); setEditing(null); return `Saved "${draft.name}". It is on your website now.`; })}>
                        {busy === o.id ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-forest-900">{o.name}</p>
                      <p className="mt-1 text-sm text-ink-600">
                        {o.value}% off the first month of {o.applies_to_slugs.map(nameOf).join(', ')}
                        {o.requires_slugs.length > 0 && <> when they also book {o.requires_slugs.map(nameOf).join(', ')}</>}.
                      </p>
                      <p className="mt-1 text-sm text-ink-500">
                        {o.status === 'active' ? 'On the website' : 'Paused — not offered'} · {o.customers_on_it} customer{o.customers_on_it === 1 ? '' : 's'} on it now, {o.redeemed} ever
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => { setEditing(o.id); setDraft(toDraft(o)); }}>Edit</button>
                      <button type="button" className="btn-ghost btn-sm" disabled={!!busy}
                              onClick={() => run(o.id, async () => {
                                const next = o.status === 'active' ? 'paused' : 'active';
                                await adminApi.saveOffer(o.id, { status: next });
                                return next === 'paused' ? `"${o.name}" is paused. The website stops offering it now; customers already on it keep it.` : `"${o.name}" is back on the website.`;
                              })}>
                        {busy === o.id ? 'Saving…' : o.status === 'active' ? 'Pause' : 'Offer it again'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {data && (adding ? (
          <div className="mt-8 rounded-lg border border-forest-400 bg-paper p-5">
            <h2 className="text-lg font-semibold text-forest-900">A new offer</h2>
            <div className="mt-4"><OfferForm draft={draft} setDraft={setDraft} services={data.services} /></div>
            <div className="mt-4 flex gap-3">
              <button type="button" className="btn-primary btn-sm" disabled={!!busy}
                      onClick={() => run('add', async () => { await adminApi.addOffer({ ...toInput(draft), status: 'active' }); setAdding(false); return `"${draft.name}" is on your website now.`; })}>
                {busy === 'add' ? 'Adding…' : 'Add and offer it'}
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={!!busy}
                      onClick={() => run('add', async () => { await adminApi.addOffer({ ...toInput(draft), status: 'paused' }); setAdding(false); return `"${draft.name}" is saved and paused. Offer it when you are ready.`; })}>
                Save it paused
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-secondary btn-sm mt-8" onClick={() => { setAdding(true); setDraft(toDraft()); }}>Add an offer</button>
        ))}
      </div>
    </AdminLayout>
  );
}
