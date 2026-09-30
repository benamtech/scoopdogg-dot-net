/**
 * Services: the words on every service page, edited by the owner himself.
 *
 * He changes a service's name, heading, introduction, what every visit includes, who it is for,
 * the questions, the search title and description, what it is paired with and where it sits in
 * the list. He can add a service (it starts as a draft, off the site) and put it on the site once
 * it has a price on the rate card; he can retire one, and its old address sends people to the
 * services list instead of a dead page. Nothing is deleted.
 *
 * The server holds the rules (server/lib/services.ts, src/shared/service-rules.ts) — the same ones
 * the build gates hold, so an edit that would break the site is refused with the reason. When it
 * refuses, every problem is listed at once rather than one per attempt.
 *
 * A save is on the public page within seconds; nothing to publish.
 */
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminApi, type AdminService, type ServiceInput } from '../../lib/adminApi';

type Draft = {
  name: string; short_name: string; h1: string; intro: string; included: string; who_its_for: string;
  faqs: { q: string; a: string }[]; pricing_note: string; meta_title: string; meta_description: string;
  related: string[]; sort_order: string;
};
const toDraft = (s: AdminService): Draft => ({
  name: s.name, short_name: s.short_name, h1: s.h1 ?? '', intro: s.intro ?? '', included: (s.what_includes ?? []).join('\n'),
  who_its_for: s.who_its_for ?? '', faqs: s.faqs ?? [], pricing_note: s.pricing_note ?? '', meta_title: s.meta_title ?? '',
  meta_description: s.meta_description ?? '', related: s.related_slugs ?? [], sort_order: String(s.sort_order),
});
const toInput = (d: Draft): ServiceInput => ({
  name: d.name, short_name: d.short_name, h1: d.h1, intro: d.intro,
  what_includes: d.included.split('\n').map((x) => x.trim()).filter(Boolean),
  who_its_for: d.who_its_for, faqs: d.faqs.filter((f) => f.q.trim() || f.a.trim()), pricing_note: d.pricing_note,
  meta_title: d.meta_title, meta_description: d.meta_description, related_slugs: d.related, sort_order: Number(d.sort_order),
});
const STATUS: Record<AdminService['status'], string> = { active: 'On the website', draft: 'Draft — not on the website', retired: 'Retired — its old address goes to your services list' };

function Text({ label, hint, value, onChange, rows, max }: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number; max?: number }) {
  return (
    <label className="grid gap-1 text-sm text-ink-700">
      <span>{label}{max ? <span className="ml-2 text-xs text-ink-400">{value.trim().length}/{max}</span> : null}</span>
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
      {rows ? <textarea className="field" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
            : <input className="field" value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function Editor({ s, all, onSaved, onCancel }: { s: AdminService; all: AdminService[]; onSaved: (msg: string) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(toDraft(s));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const set = (k: keyof Draft) => (v: string) => setD({ ...d, [k]: v });
  const save = async (status?: AdminService['status']) => {
    setBusy(true); setProblems([]);
    try {
      const res = await fetch('/api/admin/services', {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: s.slug, ...toInput(d), ...(status ? { status } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setProblems(body.problems?.length ? body.problems : [body.error ?? `Save failed (${res.status})`]); return; }
      onSaved(status === 'active' && s.status !== 'active' ? `${d.name} is on your website now.` : `Saved ${d.name}. The page shows it now.`);
    } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4" data-service-editor={s.slug}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Name" value={d.name} onChange={set('name')} max={60} />
        <Text label="Short name" hint="Used where space is tight, like the booking steps." value={d.short_name} onChange={set('short_name')} max={30} />
      </div>
      <Text label="Page heading" value={d.h1} onChange={set('h1')} max={90} />
      <Text label="Introduction" hint="The first thing on the page. No prices: those come from the rate card." rows={5} value={d.intro} onChange={set('intro')} max={1200} />
      <Text label="What every visit includes" hint="One per line." rows={5} value={d.included} onChange={set('included')} />
      <Text label="Who it is for" rows={3} value={d.who_its_for} onChange={set('who_its_for')} max={600} />
      <Text label="Pricing note" hint="Shown with the prices, e.g. what changes the price." value={d.pricing_note} onChange={set('pricing_note')} max={300} />
      <fieldset className="grid gap-2 text-sm text-ink-700">
        <legend>Questions on the page</legend>
        {d.faqs.map((f, i) => (
          <div key={i} className="grid gap-2 border border-line p-3">
            <input className="field" placeholder="Question" value={f.q} onChange={(e) => setD({ ...d, faqs: d.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
            <textarea className="field" rows={2} placeholder="Answer" value={f.a} onChange={(e) => setD({ ...d, faqs: d.faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
            <button type="button" className="btn-ghost btn-sm justify-self-start text-danger" onClick={() => setD({ ...d, faqs: d.faqs.filter((_, j) => j !== i) })}>Remove this question</button>
          </div>
        ))}
        <button type="button" className="btn-ghost btn-sm justify-self-start" onClick={() => setD({ ...d, faqs: [...d.faqs, { q: '', a: '' }] })}>Add a question</button>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Search title" hint="The blue link in Google." value={d.meta_title} onChange={set('meta_title')} max={70} />
        <Text label="Position in the list" hint="Lower comes first." value={d.sort_order} onChange={(v) => set('sort_order')(v.replace(/[^\d]/g, ''))} />
      </div>
      <Text label="Search description" hint="The two lines under the link in Google." rows={2} value={d.meta_description} onChange={set('meta_description')} max={200} />
      <fieldset className="grid gap-1 text-sm text-ink-700">
        <legend>Often paired with</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {all.filter((x) => x.status === 'active' && x.slug !== s.slug).map((x) => {
            const on = d.related.includes(x.slug);
            return (
              <label key={x.slug} className={`cursor-pointer border px-3 py-1.5 ${on ? 'border-forest bg-forest text-white' : 'border-line bg-paper'}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => setD({ ...d, related: on ? d.related.filter((r) => r !== x.slug) : [...d.related, x.slug] })} />
                {x.name}
              </label>
            );
          })}
        </div>
      </fieldset>
      {problems.length > 0 && (
        <div role="alert" className="rounded-md bg-danger-100 px-4 py-3 text-danger">
          <p className="font-semibold">Not saved yet:</p>
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
        {s.status === 'draft' && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => save('active')}>Save and put it on the website</button>}
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function AdminServicesPage() {
  const [list, setList] = useState<AdminService[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState({ name: '', kind: 'recurring', price_basis: 'dogs', basis_label: '' });

  const load = async () => { try { setList((await adminApi.services()).services); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { load(); }, []);

  const status = async (s: AdminService, next: AdminService['status']) => {
    if (next === 'retired' && !confirm(`Take ${s.name} off the website? Customers already on it keep their plan. You can bring it back later.`)) return;
    setBusy(s.slug); setError(''); setNote('');
    try {
      await adminApi.saveService(s.slug, { status: next });
      setNote(next === 'retired' ? `${s.name} is off the website. Its old address now goes to your services list.` : `${s.name} is on your website again.`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('add'); setError(''); setNote('');
    try {
      const { service } = await adminApi.addService(fresh);
      setNote(`${service.name} is saved as a draft. Write its page below, add its prices on the rate card, then put it on the website.`);
      setFresh({ name: '', kind: 'recurring', price_basis: 'dogs', basis_label: '' });
      await load(); setOpen(service.slug);
    } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Services</h1>
        <p className="mt-2 text-base text-ink-500">The words on each service page. Prices live on the <a className="underline" href="/admin/rate-card">rate card</a>. A change is on your website within seconds.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {!list ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : (
          <ul className="mt-8 grid gap-3" data-services>
            {list.map((s) => (
              <li key={s.slug} className={`rounded-lg border bg-paper p-5 ${s.status === 'active' ? 'border-line' : 'border-dashed border-line'}`}>
                {open === s.slug ? (
                  <Editor s={s} all={list} onCancel={() => setOpen(null)} onSaved={async (m) => { setNote(m); setOpen(null); await load(); }} />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-forest-900">{s.name}</p>
                      <p className="text-sm text-ink-500">{STATUS[s.status]} · {s.live_tiers} price{s.live_tiers === 1 ? '' : 's'} on the rate card · {s.customers} customer{s.customers === 1 ? '' : 's'}</p>
                      {s.status === 'active' && <a className="text-sm underline text-ink-600" href={`/services/${s.slug}`} target="_blank" rel="noreferrer">See the page</a>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setOpen(s.slug)}>Edit</button>
                      {s.status === 'active' && <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => status(s, 'retired')}>{busy === s.slug ? 'Saving…' : 'Retire'}</button>}
                      {s.status === 'retired' && <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => status(s, 'active')}>{busy === s.slug ? 'Saving…' : 'Bring back'}</button>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <h2 className="mt-12 text-lg font-semibold text-forest-900">Add a service</h2>
        <form onSubmit={add} className="mt-4 grid gap-4 rounded-lg border border-line bg-paper p-5 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-ink-700 sm:col-span-2">Name
            <input required className="field" value={fresh.name} maxLength={60} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm text-ink-700">How it is sold
            <select className="field" value={fresh.kind} onChange={(e) => setFresh({ ...fresh, kind: e.target.value })}>
              <option value="recurring">A monthly plan</option>
              <option value="one_time">A one-time job</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-ink-700">The price depends on
            <select className="field" value={fresh.price_basis} onChange={(e) => setFresh({ ...fresh, price_basis: e.target.value })}>
              <option value="dogs">How many dogs</option>
              <option value="sqft">The size of the area (sq ft)</option>
              <option value="boxes">How many litter boxes</option>
              <option value="units">How many units</option>
              <option value="levels">How many levels</option>
              <option value="choice">A choice the customer makes</option>
              <option value="flat">Nothing — one price</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-ink-700 sm:col-span-2">The question the booking form asks (optional)
            <input className="field" value={fresh.basis_label} maxLength={80} placeholder="How many dogs?" onChange={(e) => setFresh({ ...fresh, basis_label: e.target.value })} />
          </label>
          <p className="text-xs text-ink-500 sm:col-span-2">It starts as a draft. How it is priced cannot be changed later, because every price on the rate card is measured that way.</p>
          <div className="sm:col-span-2"><button type="submit" className="btn-primary btn-sm" disabled={!!busy}>{busy === 'add' ? 'Adding…' : 'Add as a draft'}</button></div>
        </form>
      </div>
    </AdminLayout>
  );
}
