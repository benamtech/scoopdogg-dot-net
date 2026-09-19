/**
 * The booking journey (P16). ZIP in, every service, two ways to pay.
 *
 * WHAT CHANGED AND WHY, because the shape of this file is an argument:
 *
 *  - THE FIRST QUESTION IS FIVE DIGITS (P16 §2). It was a street address, a city dropdown and an
 *    optional ZIP resolved by a 30-entry constant at line 49 of this file - client-side only, no
 *    provenance, no server reader. That constant is gone. The map now comes from rows with a
 *    source on them (migration 020) and the server answers the same question the browser does.
 *
 *  - A ZIP WE KNOW AND DO NOT SERVE IS NOT A SHRUG. It gets the honest sentence and a waitlist
 *    row, which is how the next route day gets chosen with evidence (P19 §4).
 *
 *  - ALL ELEVEN SERVICES BOOK (P16 §3), in three shapes: a recurring plan, a one-time job, or a
 *    quote. It booked four. The two biggest tickets in the catalog were a link to /contact.
 *
 *  - TWO LANES AT THE PRICE STEP (P16 §5). Prepay is the default; pay-after-the-first-visit is
 *    what keeps faith with the "No credit card required" the live site has promised for years.
 *    Lane B prints the ACTUAL DATE of the first charge, never "later".
 *
 *  - IT WRITES DOWN WHAT HAPPENS. Every step reports itself to /api/booking/track, which is the
 *    whole of the analytics on this site and the reason the growth board can see anything at all.
 *    A failed track never blocks a booking.
 *
 * The island still restores from sessionStorage and adopts anything typed before hydration (the
 * Summit lesson: a client:load controlled input erases pre-hydration typing).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { quoteBooking, quoteOneTime, bookableServices, formatCents, tierPrice, catchUpFor, LAST_CLEANED, type Catalog, type Tier } from '../../shared/pricing';
import { renewalTerms } from '../../shared/consent';

type Area = { slug: string; name: string; market: string; bookable: boolean };
type ServiceInfo = { slug: string; name: string; what_includes: string[] };
type Props = {
  catalog: Catalog;
  areas: Area[];
  marketLabels: Record<string, string>;
  services: ServiceInfo[];
  /** Generated from rows at build time (scripts/pull-catalog.mjs). One writer, one reader. */
  zipMap: Record<string, string>;
  phone: string;
  phoneHref: string;
  demo: boolean;
  guarantee: string | null;
  lanesEnabled: string;
  /** `business.email` — the cancellation route that needs no login, §17602(c)(1). A row. */
  businessEmail: string;
  /** `business.name`. A row. */
  businessName: string;
  /**
   * `booking.initial_cleanup_policy`. `required_beyond_two_weeks` is Josue's rule: a yard more
   * than a couple of weeks behind costs more, because the weekly price assumes a weekly yard.
   * `offer_optional` is what the funnel did before 2026-09-19 and is still a valid value.
   */
  cleanupPolicy: string;
  /**
   * `booking.payafter_charge_offset_days`. The browser used to add exactly one day here while
   * the server read this setting — harmless while it was 1, and the day somebody changed it the
   * review step would have printed one date and Stripe charged on another. Since step 6 the
   * consent sentence carries that date, so the two disagreeing now refuses the booking outright
   * rather than printing a wrong date: a louder failure for the same latent bug.
   */
  payafterOffsetDays: number;
};

type Step = 'zip' | 'service' | 'size' | 'price' | 'day' | 'details' | 'review' | 'waitlist' | 'waitlisted' | 'request';
type DateOption = { date: string; weekday: number; label: string; full: boolean };
type Lane = 'prepay' | 'payafter';

const STORE = 'sd-booking-v2';
const VISITS_PER_MONTH = 52 / 12;

const SIZE_QUESTION: Record<string, string> = {
  'weekly-pooper-scooper-service': 'How many dogs do you have?',
  'weekly-turf-maintenance': 'How big is the turf area?',
  'weekly-yard-maintenance': 'Which best describes your yard?',
  'kitty-litter-exchange': 'How many litter boxes?',
  'one-time-dog-poop-cleanup': 'How much has built up?',
  'yard-deep-clean': 'How big is the area?',
  'artificial-turf-deodorizing': 'How big is the area?',
  'dog-run-cleanups': 'How big is the run?',
  'cat-tree-cleaning': 'How many cat trees?',
  'pressure-washing': 'How big is the area?',
  'kitty-litter-robot-cleaning': 'How many Litter-Robots?',
};
const DEEP_CLEAN = 'one-time-dog-poop-cleanup';

/** Five digits out of whatever was typed or pasted. An address still works. */
const zipIn = (text: string) => (/\b(\d{5})\b/.exec(String(text ?? '')) ?? [])[1] ?? '';

export default function BookingFlow(props: Props) {
  const { catalog, areas, zipMap } = props;
  const [step, setStep] = useState<Step>('zip');
  const [history, setHistory] = useState<Step[]>([]);
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');            // area slug, resolved from the ZIP
  const [cityName, setCityName] = useState('');
  const [address, setAddress] = useState('');
  const [service, setService] = useState('');
  const [packageId, setPackageId] = useState('');
  const [tierId, setTierId] = useState('');        // a one-time job
  const [lastCleaned, setLastCleaned] = useState('');
  const [deepClean, setDeepClean] = useState('');
  const [lane, setLane] = useState<Lane>('prepay');
  const [dates, setDates] = useState<DateOption[] | null>(null);
  const [startDate, setStartDate] = useState('');
  const [firstChargeOn, setFirstChargeOn] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gate, setGate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unserved, setUnserved] = useState('');
  const [requestInfo, setRequestInfo] = useState<{ start: string } | null>(null);
  /**
   * §17602(a)(4). Express affirmative consent to the renewal terms, separate from the rest of
   * the transaction — so it is its own piece of state, it starts false, and it is deliberately
   * NOT restored from sessionStorage with everything else: a consent recovered from a previous
   * tab is a record of a click nobody can point to.
   */
  const [agreed, setAgreed] = useState(false);
  const idem = useRef<string>('');
  const zipRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restored = useRef(false);

  const payAfterOffered = props.lanesEnabled.includes('payafter');

  // ---- the funnel's own measurement. Never blocks anything, never throws. ----
  const track = (stepName: string, extra: Record<string, unknown> = {}) => {
    if (!idem.current) return;
    try {
      fetch('/api/booking/track', {
        method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ session_id: idem.current, step: stepName, postal_code: zip || null, area_slug: city || null, city_name: cityName || null, ...extra }),
      }).catch(() => {});
    } catch { /* measurement is never load-bearing */ }
  };

  // ---- restore: URL first (the hero form posts here), then this tab's saved progress ----
  useEffect(() => {
    const url = new URL(window.location.href);
    let saved: Record<string, string> = {};
    try { saved = JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch { /* fresh */ }
    idem.current = saved.idem || crypto.randomUUID();
    const typed = zipRef.current?.value ?? '';
    const fromUrl = url.searchParams.get('zip') || url.searchParams.get('address') || '';
    const z = zipIn(fromUrl) || zipIn(typed) || saved.zip || '';
    setZip(z);
    setAddress(saved.address || (zipIn(fromUrl) ? '' : fromUrl));
    for (const [k, set] of [['name', setName], ['email', setEmail], ['phone', setPhone], ['gate', setGate], ['notes', setNotes], ['lastCleaned', setLastCleaned], ['deepClean', setDeepClean], ['service', setService], ['packageId', setPackageId], ['tierId', setTierId]] as const) {
      if (saved[k]) (set as (v: string) => void)(saved[k]);
    }
    if (saved.lane === 'payafter') setLane('payafter');
    restored.current = true;

    const pkgSlug = url.searchParams.get('package');
    const pkg = pkgSlug ? catalog.packages.find((p) => p.slug === pkgSlug) : undefined;
    if (pkg) { setService(pkg.service_slug); setPackageId(pkg.id); }

    // A ZIP that arrived with the visitor is answered immediately from the generated map, and
    // the server re-answers it at the price step anyway.
    if (z && zipMap[z]) {
      const slug = zipMap[z];
      setCity(slug);
      setCityName(areas.find((a) => a.slug === slug)?.name ?? '');
      setHistory(['zip']);
      setStep(pkg ? 'price' : 'service');
      trackOnce('zip', { postal_code: z, area_slug: slug });
    } else if (saved.city) {
      setCity(saved.city); setCityName(saved.cityName || '');
    }
  }, []);

  // `track` closes over state that is not set yet during the first effect, so the first call
  // passes its own values.
  const trackOnce = (stepName: string, extra: Record<string, unknown>) => {
    try {
      fetch('/api/booking/track', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: idem.current, step: stepName, ...extra }),
      }).catch(() => {});
    } catch { /* never load-bearing */ }
  };

  useEffect(() => {
    if (!restored.current) return;
    sessionStorage.setItem(STORE, JSON.stringify({ zip, city, cityName, address, service, packageId, tierId, lastCleaned, deepClean, lane, name, email, phone, gate, notes, idem: idem.current }));
  }, [zip, city, cityName, address, service, packageId, tierId, lastCleaned, deepClean, lane, name, email, phone, gate, notes]);

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);

  const go = (next: Step) => { setError(''); setHistory((h) => [...h, step]); setStep(next); };
  const back = () => { setError(''); setHistory((h) => { const copy = [...h]; const prev = copy.pop(); if (prev) setStep(prev); return copy; }); };

  const area = areas.find((a) => a.slug === city);
  const shapes = useMemo(() => bookableServices(catalog), [catalog]);
  const shapeOf = (slug: string) => shapes.find((s) => s.service.slug === slug)?.shape ?? 'quote';
  const pkgs = useMemo(() => catalog.packages.filter((p) => p.service_slug === service).sort((a, b) => a.sort_order - b.sort_order), [service]);
  const serviceTiers = useMemo(() => catalog.tiers.filter((t) => t.service_slug === service).sort((a, b) => a.sort_order - b.sort_order), [service]);
  const pkg = catalog.packages.find((p) => p.id === packageId);
  const oneTime = tierId ? quoteOneTime(catalog, tierId) : null;
  const deepTiers = useMemo(() => catalog.tiers.filter((t) => t.service_slug === DEEP_CLEAN && !t.requires_quote && t.price_cents), []);
  const quote = pkg ? quoteBooking(catalog, { packageId: pkg.id, extraTierIds: deepClean ? [deepClean] : [] }) : null;
  const serviceInfo = props.services.find((s) => s.slug === service);
  const isOneTime = Boolean(tierId && !packageId);
  const firstCharge = isOneTime ? (oneTime?.ok ? oneTime.cents : null) : (quote && quote.ok ? quote.firstChargeCents : null);
  /**
   * THE PRICE THE FUNNEL RECORDS IS THE PRICE OF THE THING, not the first charge.
   *
   * Both are on screen - $120 a month, $60 for the first month half off - and only one of them
   * means anything a month later. The admin's hour block prints this number followed by "/mo",
   * and the growth board compares it across sessions; recording the promotional figure would
   * make every plan look like a different product. The discount is a discount ON this.
   */
  const priceSeen = isOneTime ? (oneTime?.ok ? oneTime.cents : null) : (pkg ? pkg.monthly_price_cents : null);

  /**
   * THE RENEWAL TERMS, from the same function the server writes into `consents.text_shown`.
   *
   * Null for a one-time job on purpose: §17601 defines the article around things that renew or
   * continue, and a single cleanup does neither, so there is nothing to consent to and a
   * renewal sentence over it would be a false statement (R9 §0). The review step reads the null
   * and shows no checkbox.
   */
  const terms = useMemo(() => {
    if (isOneTime || !quote || !quote.ok) return null;
    if (lane === 'payafter' && !firstChargeOn) return null;   // the date is not optional
    return renewalTerms({
      lane,
      monthlyCents: quote.monthlyCents,
      firstChargeCents: quote.firstChargeCents,
      firstChargeOn: lane === 'payafter' ? firstChargeOn : null,
      packageName: quote.package.name,
      priceMayChange: quote.flags.containsFromPrice,
      cancelEmail: props.businessEmail,
      businessName: props.businessName,
    });
  }, [isOneTime, quote?.ok && quote.package.id, quote?.ok && quote.firstChargeCents, lane, firstChargeOn]);

  /**
   * THE CATCH-UP, derived from the answer rather than chosen from a menu.
   *
   * Under `required_beyond_two_weeks` the customer no longer picks which catch-up tier applies
   * and no longer has a "No thanks, just weekly" button: the answer to "when was the yard last
   * cleaned" selects Josue's own tier for that band, and it is added to the first charge.
   */
  const catchUp = useMemo(
    () => catchUpFor(catalog, service, lastCleaned),
    [service, lastCleaned],
  );
  const catchUpRequired = props.cleanupPolicy === 'required_beyond_two_weeks';

  // Keep the extra the server will price in step with what the screen shows. Under the required
  // policy the tier is not the customer's to choose, so it is set here rather than by a click.
  useEffect(() => {
    if (!catchUpRequired) return;
    setDeepClean(catchUp.kind === 'charge' ? catchUp.tier.id : '');
  }, [catchUpRequired, catchUp.kind, catchUp.kind === 'charge' ? catchUp.tier.id : '']);

  // A change to what is being agreed to un-agrees it. Switching lane after ticking the box would
  // otherwise carry a tick for the prepay sentence onto the pay-after one.
  useEffect(() => { setAgreed(false); }, [terms?.sentence]);

  const niceDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  async function resolveZip(value: string) {
    const z = zipIn(value);
    if (!z) { setError('Please enter your 5-digit ZIP code.'); return; }
    setBusy(true); setError(''); setUnserved('');
    try {
      const r = await fetch('/api/booking/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postal_code: z }) });
      const j = await r.json();
      setZip(z);
      if (j.served) {
        setCity(j.area_slug); setCityName(j.area_name);
        trackOnce('zip', { postal_code: z, area_slug: j.area_slug, city_name: j.area_name });
        go(packageId ? 'price' : 'service');
        return;
      }
      // Known and not served, or never heard of. Both end somewhere, neither pretends.
      setCity(''); setCityName(j.city_name ?? '');
      trackOnce('zip', { postal_code: z, city_name: j.city_name ?? null });
      setUnserved(j.known
        ? `We're not on a route in ${z} yet${j.city_name ? ` (${j.city_name})` : ''}.`
        : `We don't have ${z} on the map yet.`);
      go('waitlist');
    } catch {
      setError('We could not check that just now. Please try again.');
    } finally { setBusy(false); }
  }

  async function loadDates() {
    if ((!pkg && !tierId) || !city) return;
    setDates(null);
    try {
      const r = await fetch('/api/booking/price', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city, postal_code: zip, package_id: pkg?.id ?? '', tier_id: tierId, extra_tier_ids: deepClean ? [deepClean] : [] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load days');
      setDates(j.dates);
      if (firstCharge != null && j.first_charge_cents !== firstCharge) {
        // The server re-prices from its own rows; the page must never win that argument.
        console.warn('price mismatch between page and server', j.first_charge_cents, firstCharge);
      }
    } catch (e) {
      setError((e as Error).message);
      setDates([]);
    }
  }
  useEffect(() => { if (step === 'day') loadDates(); }, [step]);

  // A step is reached when it is on the screen. Firing this from the Continue button would count
  // only the people who carried on, and then "saw a price -> booked" could never be less than
  // 100% - a funnel that cannot show a drop-off is not measuring one.
  useEffect(() => {
    if (step !== 'price' || priceSeen == null) return;
    track('price', { price_cents_seen: priceSeen, package_id: pkg?.id ?? null, service_slug: service, lane: isOneTime ? 'onetime' : null });
  }, [step, priceSeen]);

  // Lane B's first charge is the day after the first visit, and the customer is shown the DATE.
  // The offset is the setting the server uses, never a literal.
  useEffect(() => {
    if (!startDate) return setFirstChargeOn('');
    const offset = Math.max(1, Math.round(props.payafterOffsetDays));
    setFirstChargeOn(new Date(Date.parse(`${startDate}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10));
  }, [startDate, props.payafterOffsetDays]);

  async function checkout() {
    if (!pkg && !tierId) return;
    // Belt as well as braces: the button is disabled without the tick, and the server refuses
    // the request without the sentence. Neither alone is the record §17602(a)(6) asks for.
    if (terms && !agreed) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/booking/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: address || `ZIP ${zip}`, city, postal_code: zip,
          package_id: pkg?.id ?? '', tier_id: tierId,
          extra_tier_ids: deepClean ? [deepClean] : [], last_cleaned: lastCleaned,
          lane: isOneTime ? 'prepay' : lane, session_id: idem.current,
          start_date: startDate, name, email, phone, gate_code: gate, access_notes: notes,
          source: document.referrer ? new URL(document.referrer).pathname : '/book',
          idempotency_key: idem.current,
          // The sentence the customer actually read. The server re-renders it from its own rows
          // and refuses the booking if the two differ, so this is a witness and not an input —
          // a browser cannot talk itself into a cheaper set of terms by sending nicer words.
          consent_text: terms ? terms.sentence : null,
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
      const r = await fetch('/api/booking/waitlist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: address || `ZIP ${zip}`, city: cityName || `ZIP ${zip}`, email, phone, name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Please try again.');
      go('waitlisted');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const stepIndex = ['zip', 'service', 'size', 'price', 'day', 'details', 'review'].indexOf(step);

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
  /** Every pay button carries it, within a line, always (P16 §5). */
  const CancelAnytime = () => <p className="text-sm text-ink-500">Cancel anytime · No contract · Skip or pause any week</p>;

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
      <div className="lg:col-span-7">
        {stepIndex >= 0 && (
          <div className="mb-8 flex items-center gap-4">
            {history.length > 0 && step !== 'zip' && (
              <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-medium text-forest-700 hover:bg-forest-50">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>Back
              </button>
            )}
            <div className="flex flex-1 gap-1.5" aria-label={`Step ${stepIndex + 1} of 7`} role="progressbar" aria-valuemin={1} aria-valuemax={7} aria-valuenow={stepIndex + 1}>
              {Array.from({ length: 7 }).map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-base ${i <= stepIndex ? 'bg-forest-600' : 'bg-line'}`} />)}
            </div>
          </div>
        )}

        {error && <div role="alert" className="mb-6 rounded-md border border-danger/30 bg-danger-100 px-4 py-3 text-base text-danger">{error}</div>}

        <div key={step} className="animate-fade-up">
          {step === 'zip' && (
            <form onSubmit={(e) => { e.preventDefault(); resolveZip(zip); }}>
              <Heading sub="We'll show your price in about a minute.">Where's your yard?</Heading>
              <label htmlFor="bk-zip" className="field-label">ZIP code</label>
              <input id="bk-zip" ref={zipRef} className="field max-w-[220px] text-lg" inputMode="numeric" autoComplete="postal-code"
                placeholder="93030" value={zip} onChange={(e) => setZip(e.target.value)} required />
              <p className="mt-2 text-sm text-ink-500">Pasted your whole address? That works too.</p>
              <div className="mt-8"><Primary type="submit">See my price</Primary></div>
            </form>
          )}

          {step === 'service' && (
            <div>
              <Heading sub={area ? <>Great news — we serve <strong className="font-semibold text-forest-900">{area.name}</strong>.</> : undefined}>What do you need?</Heading>
              <div className="grid gap-3">
                {shapes.map(({ service: s, shape, fromCents }) => {
                  const info = props.services.find((x) => x.slug === s.slug);
                  return (
                    <Choice key={s.slug} selected={service === s.slug} badge={s.slug === 'weekly-pooper-scooper-service' ? 'Most popular' : undefined}
                      onClick={() => {
                        setService(s.slug); setPackageId(''); setTierId('');
                        if (shape === 'quote') { window.location.href = `/contact?service=${s.slug}`; return; }
                        go('size');
                      }}>
                      <span className="flex items-start justify-between gap-4">
                        <span>
                          <span className="block text-lg font-semibold text-forest-900">{info?.name ?? s.name}</span>
                          <span className="mt-1 block text-base text-ink-500">
                            {shape === 'recurring' ? 'Every week, same day' : shape === 'one_time' ? 'A one-time visit' : 'We’ll quote it'}
                          </span>
                        </span>
                        {fromCents != null && (
                          <span className="shrink-0 text-right text-sm text-ink-500">from
                            <span className="block text-lg font-semibold text-forest-900">{formatCents(fromCents)}{shape === 'recurring' ? '/mo' : ''}</span>
                          </span>
                        )}
                      </span>
                    </Choice>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'size' && (
            <div>
              <Heading>{SIZE_QUESTION[service] ?? 'Which fits best?'}</Heading>
              <div className="grid grid-cols-2 gap-3">
                {shapeOf(service) === 'recurring' && pkgs.map((p) => (
                  <Choice key={p.id} selected={packageId === p.id} badge={p.featured ? 'Most booked' : undefined}
                    onClick={() => { setPackageId(p.id); setTierId(''); go('price'); }}>
                    <span className="block text-lg font-semibold text-forest-900">{p.short_label}</span>
                    <span className="mt-1 block text-base text-ink-500">{formatCents(p.monthly_price_cents)}/month</span>
                  </Choice>
                ))}
                {shapeOf(service) === 'one_time' && serviceTiers.map((t) => {
                  const p = tierPrice(t);
                  const quoteOnly = p.kind !== 'price';
                  return (
                    <Choice key={t.id} selected={tierId === t.id}
                      onClick={() => {
                        if (quoteOnly) { window.location.href = `/contact?service=${service}&tier=${encodeURIComponent(t.label)}`; return; }
                        setTierId(t.id); setPackageId(''); go('price');
                      }}>
                      <span className="block text-lg font-semibold text-forest-900">{t.label}</span>
                      <span className="mt-1 block text-base text-ink-500">{quoteOnly ? 'Get a quote' : formatCents(p.cents)}</span>
                    </Choice>
                  );
                })}
                {shapeOf(service) === 'recurring' && catalog.tiers.filter((t) => t.service_slug === service && t.requires_quote).map((t) => (
                  <Choice key={t.id} onClick={() => { window.location.href = `/contact?service=${service}&tier=${encodeURIComponent(t.label)}`; }}>
                    <span className="block text-lg font-semibold text-forest-900">{t.label}</span>
                    <span className="mt-1 block text-base text-ink-500">Get a custom quote</span>
                  </Choice>
                ))}
              </div>
            </div>
          )}

          {step === 'price' && (pkg || (oneTime && oneTime.ok)) && (
            <div>
              <Heading>Here's your price</Heading>

              {pkg && quote && quote.ok && (
                <div className="rounded-xl border border-line bg-paper p-6 shadow-md sm:p-8">
                  <p className="text-base font-semibold text-forest-800">{pkg.name}</p>
                  <p className="mt-2 flex items-baseline gap-2"><span className="font-serif text-h1 text-forest-900">{formatCents(pkg.monthly_price_cents)}</span><span className="text-lg text-ink-500">/month</span></p>
                  {/* The weekly equivalent under every monthly price, always (P16 §5). */}
                  <p className="mt-1 text-base text-ink-500">
                    about {formatCents(Math.round(pkg.monthly_price_cents / VISITS_PER_MONTH / 100) * 100)} a visit · every week · cancel anytime
                  </p>
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
              )}

              {isOneTime && oneTime && oneTime.ok && (
                <div className="rounded-xl border border-line bg-paper p-6 shadow-md sm:p-8">
                  <p className="text-base font-semibold text-forest-800">{oneTime.service.name}</p>
                  <p className="mt-2 font-serif text-h1 text-forest-900">{formatCents(oneTime.cents)}</p>
                  <p className="mt-1 text-base text-ink-500">{oneTime.tier.label} · one visit, paid when you book</p>
                </div>
              )}

              {/* Add-on attach happens HERE, not after (P14 §A2 lever 3). */}
              {service === 'weekly-pooper-scooper-service' && deepTiers.length > 0 && (
                <fieldset className="mt-8">
                  <legend className="text-lg font-semibold text-forest-900">When was the yard last cleaned?</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {LAST_CLEANED.map((o) => (
                      <button key={o.key} type="button" aria-pressed={lastCleaned === o.key} onClick={() => { setLastCleaned(o.key); if (o.key === 'this_week' || o.key === 'two_weeks') setDeepClean(''); }}
                        className={`rounded-md border px-4 py-2.5 text-base font-medium transition duration-fast ${lastCleaned === o.key ? 'border-forest-600 bg-forest-600 text-white' : 'border-line-strong bg-paper text-forest-800 hover:border-forest-400'}`}>{o.label}</button>
                    ))}
                  </div>
                  {/*
                    WHY THE PRICE MOVED, in Josue's own terms. A customer who is told the number
                    changed and not told why reads it as a bait and switch; the sentence is the
                    difference between a surcharge and an explanation.
                  */}
                  {catchUpRequired && catchUp.kind === 'charge' && (
                    <div className="mt-4 rounded-lg border border-forest-300 bg-forest-50 p-5" data-catch-up="charge">
                      <p className="text-base text-forest-900">
                        <strong className="font-semibold">Your first visit is {formatCents(catchUp.cents)} more.</strong>{' '}
                        The weekly price is for a yard that gets done every week. Yours has {catchUp.band} on it,
                        so the first visit is a full reset — then the weekly price keeps it that way.
                      </p>
                      <p className="mt-2 text-sm text-ink-600">{catchUp.tier.label} · one time, on your first visit only</p>
                    </div>
                  )}
                  {catchUpRequired && catchUp.kind === 'quote' && (
                    <div className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-5" data-catch-up="quote">
                      <p className="text-base text-forest-900">
                        <strong className="font-semibold">Josue will price your first visit himself.</strong>{' '}
                        A yard this far behind is a bigger job than a weekly visit, and he would rather look at it than
                        guess. Book below and he will confirm the first-visit price before anything is charged — your
                        weekly price is unaffected.
                      </p>
                    </div>
                  )}

                  {/* The pre-2026-09-19 behaviour, still reachable by setting the policy back
                      to `offer_optional`: the customer picks a tier, or declines. */}
                  {!catchUpRequired && (lastCleaned === 'month' || lastCleaned === 'longer') && (

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

              {/* THE TWO LANES (P16 §5). Prepay is the default; pay-after is what keeps faith with
                  the "No credit card required" this site has promised for years. */}
              {!isOneTime && payAfterOffered && quote && quote.ok && (
                <fieldset className="mt-8">
                  <legend className="text-lg font-semibold text-forest-900">How would you like to start?</legend>
                  <div className="mt-3 grid gap-3">
                    <Choice selected={lane === 'prepay'} onClick={() => { setLane('prepay'); track('lane', { lane: 'prepay', price_cents_seen: priceSeen }); }}>
                      <span className="flex items-center justify-between gap-4">
                        <span>
                          <span className="block text-lg font-semibold text-forest-900">Start now</span>
                          <span className="mt-1 block text-base text-ink-500">First month {formatCents(quote.firstChargeCents, { forceDecimals: quote.firstChargeCents % 100 !== 0 })}{quote.discountCents > 0 ? ' — half off' : ''}</span>
                        </span>
                      </span>
                    </Choice>
                    <Choice selected={lane === 'payafter'} onClick={() => { setLane('payafter'); track('lane', { lane: 'payafter', price_cents_seen: priceSeen }); }}>
                      <span className="block text-lg font-semibold text-forest-900">Pay after my first visit</span>
                      <span className="mt-1 block text-base text-ink-500">
                        Card saved, nothing charged{startDate ? ` until ${niceDate(firstChargeOn)}` : ' until the day after your first visit'}
                      </span>
                    </Choice>
                  </div>
                </fieldset>
              )}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Primary onClick={() => go('day')}>
                  {isOneTime ? 'Choose my day' : 'Choose my start day'}
                </Primary>
                <p className="text-sm text-ink-500">Nothing is charged yet.</p>
              </div>
            </div>
          )}

          {step === 'day' && (
            <div>
              <Heading sub={area ? <>Pick a day we're in {area.name}.{isOneTime ? '' : ' It becomes your day every week.'}</> : undefined}>
                {isOneTime ? 'When should we come?' : 'When should we start?'}
              </Heading>
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
                    <Choice key={d.date} selected={startDate === d.date} onClick={() => {
                      if (d.full) return;
                      setStartDate(d.date);
                      if (isOneTime) track('onetime', { price_cents_seen: priceSeen, service_slug: service, lane: 'onetime' });
                      go('details');
                    }}>
                      <span className={`block text-lg font-semibold ${d.full ? 'text-ink-400' : 'text-forest-900'}`}>{d.label}</span>
                      <span className="mt-1 block text-sm text-ink-500">{d.full ? 'Full' : isOneTime ? 'One visit' : `Then every ${d.label.split(' ')[0]}`}</span>
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
                <div><label htmlFor="bk-address" className="field-label">Street address</label>
                  <input id="bk-address" className="field" autoComplete="street-address" required placeholder="123 Main St" value={address} onChange={(e) => setAddress(e.target.value)} />
                  <span className="mt-1 block text-sm text-ink-500">{cityName || area?.name}{zip ? ` ${zip}` : ''}</span></div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div><label htmlFor="bk-email" className="field-label">Email</label><input id="bk-email" type="email" className="field" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div><label htmlFor="bk-phone" className="field-label">Mobile phone</label><input id="bk-phone" type="tel" className="field" autoComplete="tel" required minLength={10} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                </div>
                <div><label htmlFor="bk-gate" className="field-label">Gate code <span className="font-normal text-ink-400">(optional)</span></label><input id="bk-gate" className="field" autoComplete="off" value={gate} onChange={(e) => setGate(e.target.value)} /></div>
                <div><label htmlFor="bk-notes" className="field-label">Anything we should know? <span className="font-normal text-ink-400">(optional)</span></label><textarea id="bk-notes" className="field min-h-[96px]" placeholder="Dogs' names, which gate to use, tricky spots…" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              </div>
              <div className="mt-8"><Primary type="submit">Review and book</Primary></div>
            </form>
          )}

          {step === 'review' && firstCharge != null && (
            <div>
              <Heading>Review your booking</Heading>
              <dl className="divide-y divide-line rounded-lg border border-line bg-paper">
                {[
                  [isOneTime ? 'Job' : 'Plan', isOneTime ? (oneTime && oneTime.ok ? oneTime.label : '') : pkg?.name ?? ''],
                  ['Address', `${address}${cityName ? `, ${cityName}` : ''} ${zip}`.trim()],
                  [isOneTime ? 'Visit' : 'First visit', dates?.find((d) => d.date === startDate)?.label ?? startDate],
                  ['Contact', `${name} · ${email} · ${phone}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:justify-between"><dt className="text-base text-ink-500">{k}</dt><dd className="text-base font-medium text-forest-900 sm:text-right">{v}</dd></div>
                ))}
              </dl>

              <div className="mt-6 rounded-lg bg-forest-50 p-5">
                {!isOneTime && quote && quote.ok && quote.lines.map((l) => (
                  <p key={l.ref + l.kind} className="flex justify-between py-1 text-base text-ink-700"><span>{l.kind === 'package' ? `${l.label} (first month)` : l.label}</span><span>{l.cents < 0 ? '−' : ''}{formatCents(Math.abs(l.cents), { forceDecimals: Math.abs(l.cents) % 100 !== 0 })}</span></p>
                ))}
                {isOneTime && oneTime && oneTime.ok && (
                  <p className="flex justify-between py-1 text-base text-ink-700"><span>{oneTime.label}</span><span>{formatCents(oneTime.cents)}</span></p>
                )}
                {/* LANE B SAYS THE DATE. Never "later", never "after your first visit" alone. */}
                {!isOneTime && lane === 'payafter' ? (
                  <>
                    <p className="mt-2 flex justify-between border-t border-forest-200 pt-3 text-lg font-semibold text-forest-900"><span>Due today</span><span>Nothing</span></p>
                    <p className="mt-1 text-base text-forest-800">
                      Your card is saved. Your first payment is <strong className="font-semibold">{firstChargeOn ? niceDate(firstChargeOn) : 'the day after your first visit'}</strong>
                      {quote && quote.ok ? ` — ${formatCents(quote.firstChargeCents, { forceDecimals: quote.firstChargeCents % 100 !== 0 })}` : ''}.
                    </p>
                    <p className="mt-1 text-sm text-ink-500">Then {pkg ? formatCents(pkg.monthly_price_cents) : ''} a month. Skip, pause or cancel anytime from your account.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 flex justify-between border-t border-forest-200 pt-3 text-lg font-semibold text-forest-900"><span>Due today</span><span>{formatCents(firstCharge, { forceDecimals: firstCharge % 100 !== 0 })}</span></p>
                    {!isOneTime && pkg && <p className="mt-1 text-sm text-ink-500">Then {formatCents(pkg.monthly_price_cents)} a month. Skip, pause or cancel anytime from your account.</p>}
                  </>
                )}
              </div>

              {/*
                §17602(a)(1) and (a)(4). The renewal terms, clear and conspicuous, in visual
                proximity to the request for consent — then the consent, on its own line, before
                the button. The order is the requirement: terms, then agreement, then pay.

                "Clear and conspicuous" is defined in §17601 as larger or contrasting type set
                off from the surrounding text. So this is text-base inside a bordered card, not
                the text-sm grey line that used to carry "Then $120 a month" underneath the total.
              */}
              {terms && (
                <div className="mt-6 rounded-lg border-2 border-forest-300 bg-paper p-5" data-consent-block>
                  <p className="text-base font-semibold text-forest-900">Before you book — your plan renews</p>
                  <ul className="mt-3 space-y-2">
                    {terms.disclosures.map((d) => (
                      <li key={d.cite} data-consent-cite={d.cite} className="flex gap-2.5 text-base text-ink-700">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-forest-500" />
                        <span>{d.text}</span>
                      </li>
                    ))}
                  </ul>
                  <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-line pt-4">
                    <input
                      type="checkbox"
                      required
                      checked={agreed}
                      onChange={(e) => {
                        setAgreed(e.target.checked);
                        if (e.target.checked) track('consent.recorded', { lane, price_cents_seen: priceSeen });
                      }}
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-sm border-line-strong text-forest-600 focus-visible:shadow-focus"
                      aria-describedby="consent-sentence"
                    />
                    <span id="consent-sentence" data-consent-sentence className="text-base text-forest-900">
                      {terms.sentence}
                    </span>
                  </label>
                </div>
              )}

              <div className="mt-8 flex flex-col gap-3">
                <Primary disabled={Boolean(terms) && !agreed} onClick={checkout}>
                  {!isOneTime && lane === 'payafter'
                    ? 'Save my card and book'
                    : `Pay ${formatCents(firstCharge, { forceDecimals: firstCharge % 100 !== 0 })} and book`}
                </Primary>
                {terms && !agreed && (
                  <p className="text-sm text-ink-500" role="status">Tick the box above to continue.</p>
                )}
                <CancelAnytime />
                <p className="flex items-center gap-2 text-sm text-ink-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  Secure checkout by Stripe. Apple Pay and Google Pay accepted.
                </p>
              </div>
            </div>
          )}

          {step === 'waitlist' && (
            <form onSubmit={(e) => { e.preventDefault(); joinWaitlist(); }}>
              <Heading sub="We're adding routes as we grow. Leave your details and we'll tell you the week we reach you.">
                {unserved || "We're not on your street yet"}
              </Heading>
              <div className="grid gap-5">
                <div><label htmlFor="wl-address" className="field-label">Address</label><input id="wl-address" className="field" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
                <div><label htmlFor="wl-email" className="field-label">Email</label><input id="wl-email" type="email" className="field" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div><label htmlFor="wl-phone" className="field-label">Mobile phone <span className="font-normal text-ink-400">(optional)</span></label><input id="wl-phone" type="tel" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
              <div className="mt-8"><Primary type="submit">Tell me when you reach me</Primary></div>
            </form>
          )}

          {step === 'waitlisted' && (
            <div className="text-center sm:text-left">
              <Heading sub="We'll be in touch as soon as a route reaches you. Nothing was charged and there is nothing to cancel.">You're on the list</Heading>
              <a href="/" className="btn-ghost">Back to the homepage</a>
            </div>
          )}

          {step === 'request' && (
            <div>
              <Heading sub={`${props.demo ? 'This is a demo booking. ' : ''}Josue will confirm your ${isOneTime ? 'visit' : 'start day'}${requestInfo?.start ? ` (${requestInfo.start})` : ''} and how you'd like to pay. You'll hear from us within a day.`}>Booking received</Heading>
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
            <div className="flex justify-between gap-4"><dt className="text-ink-500">Where</dt><dd className="text-right text-forest-900">{cityName || area?.name || (zip ? zip : '—')}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-500">{isOneTime ? 'Job' : 'Plan'}</dt><dd className="text-right text-forest-900">{isOneTime ? (oneTime && oneTime.ok ? oneTime.tier.label : '—') : pkg ? pkg.name : '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-500">{isOneTime ? 'Visit' : 'Start'}</dt><dd className="text-right text-forest-900">{dates?.find((d) => d.date === startDate)?.label ?? '—'}</dd></div>
          </dl>
          {firstCharge !== null && (
            <div className="mt-5 border-t border-line pt-5">
              {!isOneTime && pkg && <p className="flex items-baseline justify-between"><span className="text-base text-ink-500">Monthly</span><span className="font-serif text-h3 text-forest-900">{formatCents(pkg.monthly_price_cents)}</span></p>}
              <p className="mt-1 flex justify-between text-base">
                <span className="text-ink-500">Due today</span>
                <span className="font-semibold text-forest-900">{!isOneTime && lane === 'payafter' ? 'Nothing' : formatCents(firstCharge, { forceDecimals: firstCharge % 100 !== 0 })}</span>
              </p>
              {!isOneTime && lane === 'payafter' && firstChargeOn && (
                <p className="mt-1 text-sm text-ink-500">First payment {niceDate(firstChargeOn)}</p>
              )}
            </div>
          )}
          <ul className="mt-6 space-y-2 border-t border-line pt-5 text-sm text-ink-700">
            <li className="flex gap-2"><span className="text-forest-500">✓</span>No contract — cancel anytime</li>
            {!isOneTime && <li className="flex gap-2"><span className="text-forest-500">✓</span>Same day every week</li>}
            {props.guarantee && <li className="flex gap-2"><span className="text-forest-500">✓</span>{props.guarantee.split(':')[0]}</li>}
          </ul>
          <p className="mt-5 text-sm text-ink-500">Questions? <a href={props.phoneHref} className="link">{props.phone}</a></p>
        </div>
        {firstCharge !== null && ['price', 'day', 'details'].includes(step) && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-5 py-3 backdrop-blur lg:hidden">
            <p className="flex items-center justify-between text-base">
              <span className="text-ink-700">{isOneTime ? (oneTime && oneTime.ok ? oneTime.tier.label : '') : `${pkg?.short_label} · ${pkg ? formatCents(pkg.monthly_price_cents) : ''}/mo`}</span>
              <span className="font-semibold text-forest-900">Today {!isOneTime && lane === 'payafter' ? 'nothing' : formatCents(firstCharge, { forceDecimals: firstCharge % 100 !== 0 })}</span>
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
