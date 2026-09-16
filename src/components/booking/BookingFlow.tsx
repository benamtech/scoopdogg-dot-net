/**
 * The booking journey (P13 §3). One screen, one question, the price before contact details.
 *
 * Every price shown here comes from the shared resolver over the build-time catalog, and the
 * server re-prices the same choices before it charges (S19). The island restores progress from
 * sessionStorage and adopts anything typed into the address box before hydration (the Summit
 * lesson: client:load controlled inputs erase pre-hydration typing).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { quoteBooking, formatCents, tierPrice, type Catalog, type Package, type Tier } from '../../shared/pricing';

type Area = { slug: string; name: string; market: string; bookable: boolean };
type ServiceInfo = { slug: string; name: string; what_includes: string[] };
type Props = {
  catalog: Catalog;
  areas: Area[];
  marketLabels: Record<string, string>;
  services: ServiceInfo[];
  phone: string;
  phoneHref: string;
  demo: boolean;
  guarantee: string | null;
};

type Step = 'address' | 'service' | 'size' | 'price' | 'day' | 'details' | 'review' | 'waitlist' | 'request' | 'waitlisted';
type DateOption = { date: string; weekday: number; label: string; full: boolean };

const RECURRING = [
  { slug: 'weekly-pooper-scooper-service', title: 'Weekly poop scooping', blurb: 'Every pile, every week. Bagged and hauled away.', badge: 'Most popular' },
  { slug: 'weekly-turf-maintenance', title: 'Weekly turf maintenance', blurb: 'Sweeping, debris and enzyme deodorizing for artificial turf.' },
  { slug: 'weekly-yard-maintenance', title: 'Weekly yard maintenance', blurb: 'Mowing, edging and trimming on your day.' },
  { slug: 'kitty-litter-exchange', title: 'Weekly litter box service', blurb: 'Fresh litter and clean boxes, every week.' },
];
const DEEP_CLEAN = 'one-time-dog-poop-cleanup';
const SIZE_QUESTION: Record<string, string> = {
  'weekly-pooper-scooper-service': 'How many dogs do you have?',
  'weekly-turf-maintenance': 'How big is the turf area?',
  'weekly-yard-maintenance': 'Which best describes your yard?',
  'kitty-litter-exchange': 'How many litter boxes?',
};
const LAST_CLEANED = [
  { v: 'this_week', label: 'This week' },
  { v: 'two_weeks', label: '1–2 weeks ago' },
  { v: 'month', label: '3–6 weeks ago' },
  { v: 'longer', label: 'Longer than that' },
];

// Zip codes on the routes, so a pasted address finds its city without a lookup service.
const ZIP_CITY: Record<string, string> = {
  '93001': 'ventura', '93003': 'ventura', '93004': 'ventura', '93030': 'oxnard', '93033': 'oxnard', '93035': 'oxnard', '93036': 'oxnard',
  '93010': 'camarillo', '93012': 'camarillo', '93023': 'ojai', '93022': 'oak-view', '93060': 'santa-paula', '93015': 'fillmore',
  '93021': 'moorpark', '93063': 'simi-valley', '93065': 'simi-valley', '91360': 'thousand-oaks', '91362': 'thousand-oaks',
  '91320': 'newbury-park', '91361': 'westlake-village', '91301': 'agoura-hills', '90265': 'malibu', '90263': 'malibu',
  '93101': 'santa-barbara', '93103': 'santa-barbara', '93105': 'santa-barbara', '93108': 'santa-barbara', '93109': 'santa-barbara',
  '93110': 'santa-barbara', '93111': 'santa-barbara', '93013': 'carpinteria',
};

const STORE = 'sd-booking-v1';
const track = (step: string, extra: Record<string, unknown> = {}) => {
  try { (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', 'booking_step', { step, ...extra }); } catch { /* analytics never breaks booking */ }
};

function detectCity(text: string, areas: Area[]): { city: string; zip: string } {
  const zip = (/\b(9\d{4})\b/.exec(text) ?? [])[1] ?? '';
  if (zip && ZIP_CITY[zip]) return { city: ZIP_CITY[zip], zip };
  const lower = text.toLowerCase();
  const byLength = [...areas].sort((a, b) => b.name.length - a.name.length);
  const hit = byLength.find((a) => lower.includes(a.name.toLowerCase()));
  return { city: hit?.slug ?? '', zip };
}

export default function BookingFlow(props: Props) {
  const { catalog, areas } = props;
  const [step, setStep] = useState<Step>('address');
  const [history, setHistory] = useState<Step[]>([]);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [service, setService] = useState('');
  const [packageId, setPackageId] = useState('');
  const [lastCleaned, setLastCleaned] = useState('');
  const [deepClean, setDeepClean] = useState('');
  const [dates, setDates] = useState<DateOption[] | null>(null);
  const [startDate, setStartDate] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gate, setGate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestInfo, setRequestInfo] = useState<{ start: string } | null>(null);
  const idem = useRef<string>('');
  const addressRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restored = useRef(false);

  // ---- restore: URL first (the hero form posts here), then this tab's saved progress ----
  useEffect(() => {
    const url = new URL(window.location.href);
    let saved: Record<string, string> = {};
    try { saved = JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch { /* fresh */ }
    const typed = addressRef.current?.value ?? '';
    const addr = url.searchParams.get('address') || typed || saved.address || '';
    setAddress(addr);
    const det = detectCity(addr, areas);
    setCity(url.searchParams.get('city') || saved.city || det.city);
    setZip(saved.zip || det.zip);
    const pkgSlug = url.searchParams.get('package');
    const pkg = pkgSlug ? catalog.packages.find((p) => p.slug === pkgSlug) : undefined;
    const svc = pkg?.service_slug || url.searchParams.get('service') || saved.service || '';
    setService(RECURRING.some((r) => r.slug === svc) ? svc : '');
    setPackageId(pkg?.id || saved.packageId || '');
    for (const [k, set] of [['name', setName], ['email', setEmail], ['phone', setPhone], ['gate', setGate], ['notes', setNotes], ['lastCleaned', setLastCleaned], ['deepClean', setDeepClean]] as const) {
      if (saved[k]) (set as (v: string) => void)(saved[k]);
    }
    idem.current = saved.idem || crypto.randomUUID();
    restored.current = true;
    if (addr && (url.searchParams.get('city') || det.city)) {
      // Arrived from the hero with an address we can place: skip straight to the next question.
      const next: Step = pkg ? 'price' : 'service';
      setHistory(['address', ...(pkg ? (['service', 'size'] as Step[]) : [])]);
      setStep(next);
      track(next, { from: 'address-prefilled' });
    } else {
      track('address');
    }
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    sessionStorage.setItem(STORE, JSON.stringify({ address, city, zip, service, packageId, lastCleaned, deepClean, name, email, phone, gate, notes, idem: idem.current }));
  }, [address, city, zip, service, packageId, lastCleaned, deepClean, name, email, phone, gate, notes]);

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);

  const go = (next: Step) => { setError(''); setHistory((h) => [...h, step]); setStep(next); track(next); };
  const back = () => { setError(''); setHistory((h) => { const copy = [...h]; const prev = copy.pop(); if (prev) setStep(prev); return copy; }); };

  const area = areas.find((a) => a.slug === city);
  const fullAddress = address ? (area && !address.toLowerCase().includes(area.name.toLowerCase()) ? `${address}, ${area.name}` : address) : '';
  const pkgs = useMemo(() => catalog.packages.filter((p) => p.service_slug === service).sort((a, b) => a.sort_order - b.sort_order), [service]);
  const quoteTiers = useMemo(() => catalog.tiers.filter((t) => t.service_slug === service && t.requires_quote), [service]);
  const pkg = catalog.packages.find((p) => p.id === packageId);
  const deepTiers = useMemo(() => catalog.tiers.filter((t) => t.service_slug === DEEP_CLEAN && !t.requires_quote && t.price_cents), []);
  const quote = pkg ? quoteBooking(catalog, { packageId: pkg.id, extraTierIds: deepClean ? [deepClean] : [] }) : null;
  const serviceInfo = props.services.find((s) => s.slug === service);

  async function loadDates() {
    if (!pkg || !city) return;
    setDates(null);
    try {
      const r = await fetch('/api/booking/price', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city, package_id: pkg.id, extra_tier_ids: deepClean ? [deepClean] : [] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load days');
      setDates(j.dates);
      if (quote && quote.ok && j.first_charge_cents !== quote.firstChargeCents) console.warn('price mismatch between page and server', j.first_charge_cents, quote.firstChargeCents);
    } catch (e) {
      setError((e as Error).message);
      setDates([]);
    }
  }
  useEffect(() => { if (step === 'day') loadDates(); }, [step]);

  async function checkout() {
    if (!pkg) return;
    setBusy(true); setError('');
    track('pay', { package: pkg.slug, value: quote && quote.ok ? quote.firstChargeCents / 100 : undefined });
    try {
      const r = await fetch('/api/booking/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address, city, postal_code: zip, package_id: pkg.id, extra_tier_ids: deepClean ? [deepClean] : [], last_cleaned: lastCleaned,
          start_date: startDate, name, email, phone, gate_code: gate, access_notes: notes, source: document.referrer ? new URL(document.referrer).pathname : '/book',
          idempotency_key: idem.current,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      if (j.mode === 'checkout' && j.url) { window.location.href = j.url; return; }
      if (j.mode === 'request') { setRequestInfo({ start: j.start_label }); sessionStorage.removeItem(STORE); go('request'); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/booking/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, city: city || 'Other', email, phone, name }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Please try again.');
      go('waitlisted');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const stepIndex = ['address', 'service', 'size', 'price', 'day', 'details', 'review'].indexOf(step);
  const byMarket = useMemo(() => {
    const m = new Map<string, Area[]>();
    for (const a of areas) m.set(a.market, [...(m.get(a.market) ?? []), a]);
    return [...m.entries()];
  }, [areas]);

  // ------------------------------------------------------------------ render helpers ----
  const Heading = ({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="mb-8">
      <h1 ref={headingRef} tabIndex={-1} className="text-h2 text-forest-900 outline-none">{children}</h1>
      {sub && <p className="mt-3 text-lg text-ink-500">{sub}</p>}
    </div>
  );
  const Choice = ({ selected, onClick, children, badge }: { selected?: boolean; onClick: () => void; children: React.ReactNode; badge?: string }) => (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`relative w-full rounded-lg border bg-paper p-5 text-left transition duration-fast ease-brand hover:border-forest-400 hover:shadow-sm focus-visible:shadow-focus ${selected ? 'border-forest-600 ring-2 ring-forest-600' : 'border-line-strong'}`}>
      {badge && <span className="absolute -top-2.5 right-4 rounded-sm bg-amber-500 px-2 py-0.5 text-micro font-semibold uppercase text-forest-900">{badge}</span>}
      {children}
    </button>
  );
  const Primary = ({ disabled, onClick, children, type = 'button' }: { disabled?: boolean; onClick?: () => void; children: React.ReactNode; type?: 'button' | 'submit' }) => (
    <button type={type} disabled={disabled || busy} onClick={onClick} className="btn-primary btn-lg w-full sm:w-auto">
      {busy ? 'One moment…' : children}
    </button>
  );
  const firstCharge = quote && quote.ok ? quote.firstChargeCents : null;

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
      <div className="lg:col-span-7">
        {stepIndex >= 0 && (
          <div className="mb-8 flex items-center gap-4">
            {history.length > 0 && step !== 'address' && (
              <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-medium text-forest-700 hover:bg-forest-50">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>Back
              </button>
            )}
            <div className="flex flex-1 gap-1.5" aria-label={`Step ${stepIndex + 1} of 7`} role="progressbar" aria-valuemin={1} aria-valuemax={7} aria-valuenow={stepIndex + 1}>
              {Array.from({ length: 7 }).map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-base ${i <= stepIndex ? 'bg-forest-600' : 'bg-line'}`} />)}
            </div>
          </div>
        )}

        {error && <div role="alert" className="mb-6 rounded-md border border-danger/30 bg-danger-100 px-4 py-3 text-base text-danger">{error}</div>}

        <div key={step} className="animate-fade-up">
          {step === 'address' && (
            <form onSubmit={(e) => { e.preventDefault(); if (!address.trim()) return setError('Please enter your street address.'); if (city === 'other') return go('waitlist'); if (!city) return setError('Please choose your city.'); go(packageId ? 'price' : 'service'); }}>
              <Heading sub="We'll show your price in about a minute.">Where is your yard?</Heading>
              <label htmlFor="bk-address" className="field-label">Street address</label>
              <input id="bk-address" ref={addressRef} className="field text-lg" autoComplete="street-address" placeholder="123 Main St" value={address}
                onChange={(e) => { setAddress(e.target.value); const d = detectCity(e.target.value, areas); if (d.city) setCity(d.city); if (d.zip) setZip(d.zip); }} required />
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="bk-city" className="field-label">City</label>
                  <select id="bk-city" className="field" value={city} onChange={(e) => setCity(e.target.value)} required>
                    <option value="">Choose your city</option>
                    {byMarket.map(([market, list]) => (
                      <optgroup key={market} label={props.marketLabels[market] ?? market}>
                        {list.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                      </optgroup>
                    ))}
                    <option value="other">Somewhere else</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="bk-zip" className="field-label">Zip <span className="font-normal text-ink-400">(optional)</span></label>
                  <input id="bk-zip" className="field" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zip} onChange={(e) => { setZip(e.target.value); if (ZIP_CITY[e.target.value]) setCity(ZIP_CITY[e.target.value]); }} />
                </div>
              </div>
              <div className="mt-8"><Primary type="submit">Continue</Primary></div>
            </form>
          )}

          {step === 'service' && (
            <div>
              <Heading sub={area ? <>Great news — we serve <strong className="font-semibold text-forest-900">{area.name}</strong>.</> : undefined}>What do you need?</Heading>
              <div className="grid gap-3">
                {RECURRING.filter((r) => catalog.packages.some((p) => p.service_slug === r.slug)).map((r) => {
                  const low = catalog.packages.filter((p) => p.service_slug === r.slug).sort((a, b) => a.monthly_price_cents - b.monthly_price_cents)[0];
                  return (
                    <Choice key={r.slug} selected={service === r.slug} badge={r.badge} onClick={() => { setService(r.slug); if (!catalog.packages.some((p) => p.id === packageId && p.service_slug === r.slug)) setPackageId(''); go('size'); }}>
                      <span className="flex items-start justify-between gap-4">
                        <span><span className="block text-lg font-semibold text-forest-900">{r.title}</span><span className="mt-1 block text-base text-ink-500">{r.blurb}</span></span>
                        {low && <span className="shrink-0 text-right text-sm text-ink-500">from<span className="block text-lg font-semibold text-forest-900">{formatCents(low.monthly_price_cents)}/mo</span></span>}
                      </span>
                    </Choice>
                  );
                })}
              </div>
              <p className="mt-6 text-base text-ink-700">Need a one-time cleanup instead? <a className="link" href={`/contact?service=${DEEP_CLEAN}`}>Request one</a> or call <a className="link" href={props.phoneHref}>{props.phone}</a>.</p>
            </div>
          )}

          {step === 'size' && (
            <div>
              <Heading>{SIZE_QUESTION[service] ?? 'Which fits best?'}</Heading>
              <div className="grid grid-cols-2 gap-3">
                {pkgs.map((p) => (
                  <Choice key={p.id} selected={packageId === p.id} badge={p.featured ? 'Most booked' : undefined} onClick={() => { setPackageId(p.id); go('price'); }}>
                    <span className="block text-lg font-semibold text-forest-900">{p.short_label}</span>
                    <span className="mt-1 block text-base text-ink-500">{formatCents(p.monthly_price_cents)}/month</span>
                  </Choice>
                ))}
                {quoteTiers.map((t) => (
                  <Choice key={t.id} onClick={() => { window.location.href = `/contact?service=${service}&tier=${encodeURIComponent(t.label)}`; }}>
                    <span className="block text-lg font-semibold text-forest-900">{t.label}</span>
                    <span className="mt-1 block text-base text-ink-500">Get a custom quote</span>
                  </Choice>
                ))}
              </div>
            </div>
          )}

          {step === 'price' && pkg && quote && quote.ok && (
            <div>
              <Heading>Here's your price</Heading>
              <div className="rounded-xl border border-line bg-paper p-6 shadow-md sm:p-8">
                <p className="text-base font-semibold text-forest-800">{pkg.name}</p>
                <p className="mt-2 flex items-baseline gap-2"><span className="font-serif text-h1 text-forest-900">{formatCents(pkg.monthly_price_cents)}</span><span className="text-lg text-ink-500">/month</span></p>
                <p className="mt-1 text-base text-ink-500">About {formatCents(Math.round(pkg.monthly_price_cents / pkg.visits_per_month / 100) * 100)} a visit · every week · cancel anytime</p>
                {quote.discountCents > 0 && (
                  <div className="mt-6 flex items-center justify-between rounded-md bg-amber-100 px-4 py-3">
                    <span className="text-base font-semibold text-amber-700">First month half off</span>
                    <span className="text-base text-amber-700"><s className="mr-2 opacity-70">{formatCents(pkg.monthly_price_cents)}</s><strong>{formatCents(pkg.monthly_price_cents - quote.discountCents, { forceDecimals: true })}</strong></span>
                  </div>
                )}
                {serviceInfo && serviceInfo.what_includes.length > 0 && (
                  <ul className="mt-6 grid gap-2 text-base text-ink-700 sm:grid-cols-2">
                    {serviceInfo.what_includes.slice(0, 6).map((w) => (
                      <li key={w} className="flex gap-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-1 shrink-0 text-forest-500" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>{w}</li>
                    ))}
                  </ul>
                )}
              </div>

              {service === 'weekly-pooper-scooper-service' && deepTiers.length > 0 && (
                <fieldset className="mt-8">
                  <legend className="text-lg font-semibold text-forest-900">When was the yard last cleaned?</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {LAST_CLEANED.map((o) => (
                      <button key={o.v} type="button" aria-pressed={lastCleaned === o.v} onClick={() => { setLastCleaned(o.v); if (o.v === 'this_week' || o.v === 'two_weeks') setDeepClean(''); }}
                        className={`rounded-md border px-4 py-2.5 text-base font-medium transition duration-fast ${lastCleaned === o.v ? 'border-forest-600 bg-forest-600 text-white' : 'border-line-strong bg-paper text-forest-800 hover:border-forest-400'}`}>{o.label}</button>
                    ))}
                  </div>
                  {(lastCleaned === 'month' || lastCleaned === 'longer') && (
                    <div className="mt-4 rounded-lg border border-line bg-forest-50 p-5">
                      <p className="text-base text-forest-900"><strong className="font-semibold">Start fresh with a one-time deep clean?</strong> We'll reset the whole yard on your first visit, then keep it that way.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {deepTiers.map((t: Tier) => {
                          const p = tierPrice(t);
                          return (
                            <button key={t.id} type="button" aria-pressed={deepClean === t.id} onClick={() => setDeepClean(deepClean === t.id ? '' : t.id)}
                              className={`rounded-md border p-3 text-left text-base transition duration-fast ${deepClean === t.id ? 'border-forest-600 bg-paper ring-2 ring-forest-600' : 'border-line-strong bg-paper hover:border-forest-400'}`}>
                              <span className="block font-semibold text-forest-900">+ {p.kind === 'quote' ? 'Quote' : formatCents(p.cents)}</span>
                              <span className="block text-sm text-ink-500">{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button type="button" className="mt-3 text-sm font-medium text-forest-700 underline underline-offset-4" onClick={() => setDeepClean('')}>No thanks, just weekly</button>
                    </div>
                  )}
                </fieldset>
              )}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Primary onClick={() => go('day')}>Choose my start day</Primary>
                <p className="text-sm text-ink-500">Nothing is charged yet.</p>
              </div>
            </div>
          )}

          {step === 'day' && (
            <div>
              <Heading sub={area ? <>Pick a day we're in {area.name}. It becomes your day every week.</> : undefined}>When should we start?</Heading>
              {!dates && <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-line/60" />)}</div>}
              {dates && dates.length === 0 && (
                <div className="rounded-lg border border-line bg-paper p-6">
                  <p className="text-lg text-forest-900">Our routes there are full for the next two weeks.</p>
                  <p className="mt-2 text-base text-ink-700">Join the waitlist and we'll let you know the moment a day opens.</p>
                  <button type="button" className="btn-secondary mt-4" onClick={() => go('waitlist')}>Join the waitlist</button>
                </div>
              )}
              {dates && dates.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {dates.map((d) => (
                    <Choice key={d.date} selected={startDate === d.date} onClick={() => { if (!d.full) { setStartDate(d.date); go('details'); } }}>
                      <span className={`block text-lg font-semibold ${d.full ? 'text-ink-400' : 'text-forest-900'}`}>{d.label}</span>
                      <span className="mt-1 block text-sm text-ink-500">{d.full ? 'Full' : `Then every ${d.label.split(' ')[0]}`}</span>
                    </Choice>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'details' && (
            <form onSubmit={(e) => { e.preventDefault(); go('review'); }}>
              <Heading sub="So we can confirm your booking and send your first-visit reminder.">Almost done</Heading>
              <div className="grid gap-5">
                <div><label htmlFor="bk-name" className="field-label">Your name</label><input id="bk-name" className="field" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div><label htmlFor="bk-email" className="field-label">Email</label><input id="bk-email" type="email" className="field" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div><label htmlFor="bk-phone" className="field-label">Mobile phone</label><input id="bk-phone" type="tel" className="field" autoComplete="tel" required minLength={10} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                </div>
                <div><label htmlFor="bk-gate" className="field-label">Gate code <span className="font-normal text-ink-400">(optional)</span></label><input id="bk-gate" className="field" autoComplete="off" value={gate} onChange={(e) => setGate(e.target.value)} /></div>
                <div><label htmlFor="bk-notes" className="field-label">Anything we should know? <span className="font-normal text-ink-400">(optional)</span></label><textarea id="bk-notes" className="field min-h-[96px]" placeholder="Dogs' names, which gate to use, tricky spots…" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              </div>
              <div className="mt-8"><Primary type="submit">Review and pay</Primary></div>
            </form>
          )}

          {step === 'review' && pkg && quote && quote.ok && (
            <div>
              <Heading>Review your booking</Heading>
              <dl className="divide-y divide-line rounded-lg border border-line bg-paper">
                {[
                  ['Plan', pkg.name],
                  ['Address', fullAddress],
                  ['First visit', dates?.find((d) => d.date === startDate)?.label ?? startDate],
                  ['Contact', `${name} · ${email} · ${phone}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:justify-between"><dt className="text-base text-ink-500">{k}</dt><dd className="text-base font-medium text-forest-900 sm:text-right">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-6 rounded-lg bg-forest-50 p-5">
                {quote.lines.map((l) => (
                  <p key={l.ref + l.kind} className="flex justify-between py-1 text-base text-ink-700"><span>{l.kind === 'package' ? `${l.label} (first month)` : l.label}</span><span>{l.cents < 0 ? '−' : ''}{formatCents(Math.abs(l.cents), { forceDecimals: Math.abs(l.cents) % 100 !== 0 })}</span></p>
                ))}
                <p className="mt-2 flex justify-between border-t border-forest-200 pt-3 text-lg font-semibold text-forest-900"><span>Due today</span><span>{formatCents(quote.firstChargeCents, { forceDecimals: quote.firstChargeCents % 100 !== 0 })}</span></p>
                <p className="mt-1 text-sm text-ink-500">Then {formatCents(pkg.monthly_price_cents)} a month. Skip, pause or cancel anytime from your account.</p>
              </div>
              <div className="mt-8 flex flex-col gap-3">
                <Primary onClick={checkout}>Pay {formatCents(quote.firstChargeCents, { forceDecimals: quote.firstChargeCents % 100 !== 0 })} and book</Primary>
                <p className="flex items-center gap-2 text-sm text-ink-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  Secure checkout by Stripe. Apple Pay and Google Pay accepted.
                </p>
              </div>
            </div>
          )}

          {step === 'waitlist' && (
            <form onSubmit={(e) => { e.preventDefault(); joinWaitlist(); }}>
              <Heading sub="We're adding routes as we grow. Leave your details and we'll let you know as soon as we reach your street.">We're not on your street yet</Heading>
              <div className="grid gap-5">
                <div><label htmlFor="wl-email" className="field-label">Email</label><input id="wl-email" type="email" className="field" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div><label htmlFor="wl-phone" className="field-label">Mobile phone <span className="font-normal text-ink-400">(optional)</span></label><input id="wl-phone" type="tel" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
              <div className="mt-8"><Primary type="submit">Join the waitlist</Primary></div>
            </form>
          )}

          {step === 'waitlisted' && (
            <div className="text-center sm:text-left">
              <Heading sub="We'll be in touch as soon as a route reaches you.">You're on the list</Heading>
              <a href="/" className="btn-ghost">Back to the homepage</a>
            </div>
          )}

          {step === 'request' && (
            <div>
              <Heading sub={`${props.demo ? 'This is a demo booking. ' : ''}Josue will confirm your start day${requestInfo?.start ? ` (${requestInfo.start})` : ''} and how you'd like to pay. You'll hear from us within a day.`}>Booking received</Heading>
              <a href="/" className="btn-ghost">Back to the homepage</a>
            </div>
          )}
        </div>
      </div>

      {/* ---- summary: sticky on desktop, a compact bar on mobile ---- */}
      <aside className="lg:col-span-5">
        <div className="sticky top-24 hidden rounded-xl border border-line bg-paper p-6 shadow-sm lg:block">
          <p className="text-micro font-semibold uppercase text-ink-400">Your booking</p>
          <dl className="mt-4 space-y-3 text-base">
            <div className="flex justify-between gap-4"><dt className="text-ink-500">Address</dt><dd className="text-right text-forest-900">{fullAddress || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-500">Plan</dt><dd className="text-right text-forest-900">{pkg ? pkg.name : '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-500">Start</dt><dd className="text-right text-forest-900">{dates?.find((d) => d.date === startDate)?.label ?? '—'}</dd></div>
          </dl>
          {pkg && firstCharge !== null && (
            <div className="mt-5 border-t border-line pt-5">
              <p className="flex items-baseline justify-between"><span className="text-base text-ink-500">Monthly</span><span className="font-serif text-h3 text-forest-900">{formatCents(pkg.monthly_price_cents)}</span></p>
              <p className="mt-1 flex justify-between text-base"><span className="text-ink-500">Due today</span><span className="font-semibold text-forest-900">{formatCents(firstCharge, { forceDecimals: firstCharge % 100 !== 0 })}</span></p>
            </div>
          )}
          <ul className="mt-6 space-y-2 border-t border-line pt-5 text-sm text-ink-700">
            <li className="flex gap-2"><span className="text-forest-500">✓</span>No contract — cancel anytime</li>
            <li className="flex gap-2"><span className="text-forest-500">✓</span>Same day every week</li>
            {props.guarantee && <li className="flex gap-2"><span className="text-forest-500">✓</span>{props.guarantee.split(':')[0]}</li>}
          </ul>
          <p className="mt-5 text-sm text-ink-500">Questions? <a href={props.phoneHref} className="link">{props.phone}</a></p>
        </div>
        {pkg && firstCharge !== null && ['price', 'day', 'details'].includes(step) && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-5 py-3 backdrop-blur lg:hidden">
            <p className="flex items-center justify-between text-base"><span className="text-ink-700">{pkg.short_label} · {formatCents(pkg.monthly_price_cents)}/mo</span><span className="font-semibold text-forest-900">Today {formatCents(firstCharge, { forceDecimals: firstCharge % 100 !== 0 })}</span></p>
          </div>
        )}
      </aside>
    </div>
  );
}
