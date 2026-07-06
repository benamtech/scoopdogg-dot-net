import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, Phone, Mail, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CITIES } from '../lib/cities';

interface Props {
  preselectedCity?: string;
  preselectedService?: string;
  sourcePage?: string;
}

const SERVICES = [
  {
    id: 'weekly',
    label: 'Keep It Clean',
    sub: 'Weekly service',
    desc: 'Consistent scheduled visits',
    badge: 'Most Popular',
  },
  {
    id: 'turf',
    label: 'Weekly Turf Maintenance',
    sub: 'Sweeping & deodorizing',
    desc: 'Ongoing turf care weekly',
    badge: null,
  },
  {
    id: 'one-time',
    label: 'Turf Deep Clean',
    sub: 'One-time turf restoration',
    desc: 'Full turf reset & sanitize',
    badge: null,
  },
  {
    id: 'yard-deep-clean',
    label: 'Yard Deep Clean',
    sub: 'One-time yard restoration',
    desc: 'Overgrowth, debris & more',
    badge: null,
  },
  {
    id: 'yard-maintenance',
    label: 'Weekly Yard Maintenance',
    sub: 'Mowing, trimming & upkeep',
    desc: 'Keep it looking sharp',
    badge: null,
  },
  {
    id: 'kitty-litter',
    label: 'Kitty Litter Exchange',
    sub: 'Fresh litter box service',
    desc: 'We handle the dirty work',
    badge: null,
  },
  {
    id: 'dog-run',
    label: 'Dog Run Cleanup',
    sub: 'Side yards & gravel runs',
    desc: 'Waste + odor, handled',
    badge: null,
  },
  {
    id: 'cat-tree',
    label: 'Cat Tree Cleaning',
    sub: 'Pet furniture cleaning',
    desc: 'Hair, odor & litter dust',
    badge: null,
  },
  {
    id: 'litter-robot',
    label: 'Kitty Litter Robot Cleaning',
    sub: 'Automatic litter box care',
    desc: 'Deep clean & odor elimination',
    badge: null,
  },
  {
    id: 'pressure-washing',
    label: 'Pressure Washing',
    sub: 'Hard surface cleaning',
    desc: 'Patios, runs & hardscape',
    badge: null,
  },
];

const DOG_PRICES: Record<string, number> = {
  '1': 15,
  '2': 20,
  '3': 23,
  '4': 25,
  '5+': 25,
};

type Direction = 'forward' | 'back';

interface InlineSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}

function InlineSelect({ value, options, onChange }: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1 text-forest font-semibold border-b-2 border-forest hover:border-amber hover:text-amber transition-colors pb-0.5"
      >
        {selected?.label}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-sage-light rounded-xl shadow-card-hover z-20 min-w-[120px] py-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-sage-light transition-colors ${
                opt.value === value ? 'text-forest font-semibold bg-sage-light' : 'text-dark'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookingWidget({ preselectedCity, preselectedService, sourcePage }: Props) {
  const [searchParams] = useSearchParams();
  const paramService = searchParams.get('service') || preselectedService || '';

  const initialStep = preselectedCity ? 2 : 1;

  const [step, setStep] = useState(initialStep);
  const [direction, setDirection] = useState<Direction>('forward');
  const [animKey, setAnimKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [city, setCity] = useState(preselectedCity || '');
  const [service, setService] = useState(paramService);
  const [numDogs, setNumDogs] = useState('1');
  const [yardSize, setYardSize] = useState('medium');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');

  // addon service detail fields
  const [litterBoxes, setLitterBoxes] = useState('1');
  const [runSurface, setRunSurface] = useState('gravel');
  const [runOdor, setRunOdor] = useState('yes');
  const [catTrees, setCatTrees] = useState('1');
  const [catTreeSize, setCatTreeSize] = useState('small');
  const [washSurface, setWashSurface] = useState('concrete');
  const [litterRobots, setLitterRobots] = useState('1');

  const goTo = (next: number, dir: Direction = 'forward') => {
    setDirection(dir);
    setAnimKey((k) => k + 1);
    setStep(next);
  };

  const handleCitySelect = (c: string) => {
    setCity(c);
    if (service) {
      goTo(3);
    } else {
      goTo(2);
    }
  };

  const handleServiceSelect = (s: string) => {
    setService(s);
    if (s === 'one-time' || s === 'yard-deep-clean' || s === 'yard-maintenance' || s === 'kitty-litter' || s === 'cat-tree' || s === 'pressure-washing' || s === 'litter-robot') {
      setNumDogs('0');
    } else {
      setNumDogs('1');
    }
    setTimeout(() => goTo(3), 400);
  };

  const validateContact = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!phone.trim()) e.phone = 'Phone is required';
    if (!email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildNotes = () => {
    const base = notes.trim();
    let detail = '';
    if (service === 'kitty-litter') detail = `Litter boxes: ${litterBoxes}`;
    else if (service === 'dog-run') detail = `Run surface: ${runSurface}. Odor issue: ${runOdor}.`;
    else if (service === 'cat-tree') detail = `Cat trees: ${catTrees}, size: ${catTreeSize}.`;
    else if (service === 'pressure-washing') detail = `Wash surface: ${washSurface}. Solid waste removed first.`;
    else if (service === 'yard-maintenance') detail = 'Weekly yard maintenance — custom quote requested.';
    else if (service === 'litter-robot') detail = `Litter-Robots: ${litterRobots}`;
    return [detail, base].filter(Boolean).join(' | ');
  };

  const handleSubmit = async () => {
    if (!validateContact()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const leadData = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        city,
        service_type: service,
        yard_size: yardSize,
        num_dogs: numDogs === '5+' ? 5 : parseInt(numDogs),
        frequency: '',
        notes: buildNotes(),
        source_page: sourcePage || window.location.pathname,
        status: 'new',
      };
      const { data: inserted, error: insertError } = await supabase.from('leads').insert(leadData).select().maybeSingle();
      if (insertError) throw new Error(insertError.message);
      const payload = inserted ?? { ...leadData, created_at: new Date().toISOString() };
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-new-lead`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify(payload),
        }
      );
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'generate_lead', {
          service_type: service,
          city,
        });
      }
      setSubmitting(false);
      goTo(5);
    } catch (_) {
      setSubmitError('Something went wrong submitting your request. Please try again or call us at (805) 869-8070.');
      setSubmitting(false);
    }
  };

  const isIndoorOrWash = service === 'kitty-litter' || service === 'cat-tree' || service === 'pressure-washing' || service === 'litter-robot';
  const isAddonService = service === 'kitty-litter' || service === 'dog-run' || service === 'cat-tree' || service === 'pressure-washing' || service === 'yard-maintenance' || service === 'litter-robot';
  const showZeroDogs = service === 'one-time' || service === 'yard-deep-clean' || isAddonService;
  const dogOptions = (showZeroDogs ? ['0', '1', '2', '3', '4', '5+'] : ['1', '2', '3', '4', '5+']).map((v) => ({ value: v, label: v }));
  const yardOptions = [
    { value: 'small', label: 'small' },
    { value: 'medium', label: 'medium' },
    { value: 'large', label: 'large' },
  ];

  const weeklyPrice = DOG_PRICES[numDogs] ?? 25;

  const totalSteps = 4;
  const currentDot = Math.min(step, totalSteps);

  const animClass = direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left';

  return (
    <div className="w-full max-w-2xl mx-auto">
      {step < 5 && (
        <div className="flex items-center justify-center mb-8 gap-0">
          {[1, 2, 3, 4].map((dot, i) => {
            const done = dot < currentDot;
            const current = dot === currentDot;
            return (
              <div key={dot} className="flex items-center">
                <div
                  className={`rounded-full transition-all duration-300 flex items-center justify-center ${
                    done
                      ? 'w-8 h-8 bg-forest text-white'
                      : current
                      ? 'w-10 h-10 bg-amber text-white shadow-md'
                      : 'w-8 h-8 bg-white/20 text-white/50'
                  }`}
                >
                  {done ? (
                    <Check size={14} />
                  ) : (
                    <span className="text-xs font-bold">{dot}</span>
                  )}
                </div>
                {i < 3 && (
                  <div
                    className={`h-0.5 w-10 sm:w-16 transition-colors duration-300 ${
                      done ? 'bg-forest' : 'bg-white/20'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div key={animKey} className={`${step < 5 ? animClass : 'animate-scale-in'}`}>
        {step === 1 && (
          <div>
            <h3 className="font-serif text-2xl text-white text-center mb-2">
              {isIndoorOrWash ? "Where's your home?" : "Where's your yard?"}
            </h3>
            <p className="text-white/70 text-center text-sm mb-6">Select your city to get started</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CITIES.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => handleCitySelect(c.name)}
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 font-medium text-sm transition-all min-h-[44px] ${
                    city === c.name
                      ? 'border-amber bg-amber text-white'
                      : 'border-white/30 bg-white/10 text-white hover:border-white hover:bg-white/20'
                  }`}
                >
                  {city === c.name && <Check size={14} />}
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="font-serif text-2xl text-white text-center mb-2">
              What do you need?
            </h3>
            <p className="text-white/70 text-center text-sm mb-6">Select a service</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {SERVICES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleServiceSelect(s.id)}
                  className={`relative flex flex-col items-start p-5 rounded-xl border-2 text-left transition-all duration-200 min-h-[44px] ${
                    service === s.id
                      ? 'border-amber bg-amber/10'
                      : 'border-white/30 bg-white/10 hover:border-white hover:bg-white/20'
                  }`}
                >
                  {s.badge && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber text-white text-xs font-bold px-3 py-0.5 rounded-full">
                      {s.badge}
                    </span>
                  )}
                  <p className="font-semibold text-white mb-1">{s.label}</p>
                  <p className="text-white/70 text-xs mb-1">{s.sub}</p>
                  <p className="text-white/50 text-xs">{s.desc}</p>
                  {service === s.id && (
                    <div className="absolute top-3 right-3">
                      <Check size={14} className="text-amber" />
                    </div>
                  )}
                </button>
              ))}
            </div>
            {!preselectedCity && (
              <button
                type="button"
                onClick={() => goTo(1, 'back')}
                className="flex items-center gap-2 mt-4 text-white/60 hover:text-white text-sm transition-colors mx-auto"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="font-serif text-2xl text-white text-center mb-2">
              {isAddonService ? 'A few quick details' : 'Tell us about your yard'}
            </h3>
            <p className="text-white/70 text-center text-sm mb-8">
              Help us give you the best service
            </p>

            {!isAddonService && (
              <div className="bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <span>I have </span>
                <InlineSelect
                  value={numDogs}
                  options={dogOptions}
                  onChange={setNumDogs}
                />
                <span> dog{numDogs !== '1' ? 's' : ''} and a </span>
                <InlineSelect
                  value={yardSize}
                  options={yardOptions}
                  onChange={setYardSize}
                />
                <span> yard.</span>
              </div>
            )}

            {service === 'weekly' && (
              <div className="mt-4 bg-amber/20 border border-amber/40 rounded-2xl px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-0.5">Weekly Rate</p>
                  <p className="text-white font-bold text-2xl">${weeklyPrice}<span className="text-white/60 text-sm font-normal">/week</span></p>
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-xs">1 dog · $15</p>
                  <p className="text-white/50 text-xs">2 dogs · $20</p>
                  <p className="text-white/50 text-xs">3 dogs · $23</p>
                  <p className="text-white/50 text-xs">4+ dogs · $25</p>
                </div>
              </div>
            )}

            {service === 'one-time' && (
              <div className="mt-4 bg-amber/20 border border-amber/40 rounded-2xl px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-0.5">Turf Deep Clean</p>
                  <p className="text-white font-bold text-2xl"><span className="text-white/60 text-sm font-normal">Starting at </span>$99</p>
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-xs">One-time service</p>
                  <p className="text-white/50 text-xs">No hidden fees</p>
                </div>
              </div>
            )}

            {service === 'yard-deep-clean' && (
              <div className="mt-4 bg-amber/20 border border-amber/40 rounded-2xl px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-0.5">Yard Deep Clean</p>
                  <p className="text-white font-bold text-2xl"><span className="text-white/60 text-sm font-normal">Starting at </span>$99</p>
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-xs">One-time service</p>
                  <p className="text-white/50 text-xs">Pricing based on yard</p>
                </div>
              </div>
            )}

            {service === 'kitty-litter' && (
              <div className="mt-6 bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-4">Litter box details</p>
                <span>I have </span>
                <InlineSelect
                  value={litterBoxes}
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3', label: '3' },
                    { value: '4+', label: '4+' },
                  ]}
                  onChange={setLitterBoxes}
                />
                <span> litter box{litterBoxes !== '1' ? 'es' : ''}.</span>
                <p className="text-white/50 text-xs mt-3">Starting at $15/box per visit. We can use your litter or supply it.</p>
              </div>
            )}

            {service === 'dog-run' && (
              <div className="mt-6 bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-4">Run details</p>
                <span>Surface type: </span>
                <InlineSelect
                  value={runSurface}
                  options={[
                    { value: 'gravel', label: 'gravel' },
                    { value: 'turf', label: 'artificial turf' },
                    { value: 'concrete', label: 'concrete' },
                    { value: 'mixed', label: 'mixed' },
                  ]}
                  onChange={setRunSurface}
                />
                <span>. Odor is a primary concern: </span>
                <InlineSelect
                  value={runOdor}
                  options={[
                    { value: 'yes', label: 'yes' },
                    { value: 'no', label: 'not really' },
                  ]}
                  onChange={setRunOdor}
                />
                <span>.</span>
                <p className="text-white/50 text-xs mt-3">Starting at $49. Enzyme deodorizing available as an add-on.</p>
              </div>
            )}

            {service === 'cat-tree' && (
              <div className="mt-6 bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-4">Cat tree details</p>
                <span>I have </span>
                <InlineSelect
                  value={catTrees}
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3+', label: '3+' },
                  ]}
                  onChange={setCatTrees}
                />
                <span> cat tree{catTrees !== '1' ? 's' : ''}, mostly </span>
                <InlineSelect
                  value={catTreeSize}
                  options={[
                    { value: 'small', label: 'small (1–2 levels)' },
                    { value: 'large', label: 'large (3+ levels)' },
                  ]}
                  onChange={setCatTreeSize}
                />
                <span>.</span>
                <p className="text-white/50 text-xs mt-3">Starting at $25 per tree. Pet-safe cleaning products only.</p>
              </div>
            )}

            {service === 'pressure-washing' && (
              <div className="mt-6 bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-4">Surface details</p>
                <span>Surface type: </span>
                <InlineSelect
                  value={washSurface}
                  options={[
                    { value: 'concrete', label: 'concrete' },
                    { value: 'pavers', label: 'pavers' },
                    { value: 'brick', label: 'brick' },
                    { value: 'tile', label: 'tile' },
                    { value: 'mixed', label: 'mixed' },
                  ]}
                  onChange={setWashSurface}
                />
                <span>.</span>
                <p className="text-white/50 text-xs mt-3">Starting at $59. Solid pet waste is removed before washing begins. We wash responsibly — nothing directed toward gutters or storm drains.</p>
              </div>
            )}

            {service === 'yard-maintenance' && (
              <div className="mt-6 bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-4">Maintenance details</p>
                <p className="text-white/80 text-sm leading-relaxed">Tell us about your property in the notes on the next step — yard size, what needs regular attention (mowing, trimming, edging, leaf cleanup, etc.), and how often you would like us there. We will follow up with a custom quote.</p>
                <p className="text-white/50 text-xs mt-3">Custom pricing based on property size and services needed.</p>
              </div>
            )}

            {service === 'litter-robot' && (
              <div className="mt-6 bg-white/10 rounded-2xl p-6 text-white text-base leading-loose">
                <p className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-4">Litter-Robot details</p>
                <span>I have </span>
                <InlineSelect
                  value={litterRobots}
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3+', label: '3+' },
                  ]}
                  onChange={setLitterRobots}
                />
                <span> Litter-Robot{litterRobots !== '1' ? 's' : ''}.</span>
                <p className="text-white/50 text-xs mt-3">Starting at $45 per unit. Full teardown, deep clean, and reassembly. Works with Litter-Robot 3, 4, and similar automatic units.</p>
              </div>
            )}

            <div className="flex items-center justify-between mt-6">
              <button
                type="button"
                onClick={() => goTo(2, 'back')}
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <button
                type="button"
                onClick={() => goTo(4)}
                className="bg-amber hover:bg-amber-hover text-white font-semibold px-6 py-3 rounded-full transition-all hover:scale-[1.02] hover:shadow-md text-sm"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h3 className="font-serif text-2xl text-white text-center mb-2">
              How do we reach you?
            </h3>
            <p className="text-white/70 text-center text-sm mb-6">
              We'll follow up within a few hours
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <input
                  type="text"
                  placeholder="Full Name *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`w-full bg-white/10 border rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-amber transition-colors min-h-[44px] ${
                    errors.name ? 'border-red-400' : 'border-white/30'
                  }`}
                />
                {errors.name && <p className="text-red-300 text-xs mt-1">{errors.name}</p>}
              </div>
              <div>
                <input
                  type="tel"
                  placeholder="Phone *"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={`w-full bg-white/10 border rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-amber transition-colors min-h-[44px] ${
                    errors.phone ? 'border-red-400' : 'border-white/30'
                  }`}
                />
                {errors.phone && <p className="text-red-300 text-xs mt-1">{errors.phone}</p>}
              </div>
              <div className="sm:col-span-2">
                <input
                  type="email"
                  placeholder="Email Address *"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full bg-white/10 border rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-amber transition-colors min-h-[44px] ${
                    errors.email ? 'border-red-400' : 'border-white/30'
                  }`}
                />
                {errors.email && <p className="text-red-300 text-xs mt-1">{errors.email}</p>}
              </div>
              <div className="sm:col-span-2">
                <input
                  type="text"
                  placeholder="Street Address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-amber transition-colors min-h-[44px]"
                />
              </div>
              <div className="sm:col-span-2">
                <textarea
                  placeholder="Anything we should know? Gate codes, dog names, special instructions..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-amber transition-colors resize-none"
                />
              </div>
            </div>

            {submitError && (
              <p className="text-red-300 text-sm bg-red-500/10 border border-red-400/30 rounded-xl px-4 py-3 mb-4">
                {submitError}
              </p>
            )}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => goTo(3, 'back')}
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-3.5 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg text-base disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending...' : 'Submit Request →'}
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="text-center py-8">
            <div className="flex items-center justify-center mb-4">
              <img
                src="/2dogjumping.png"
                alt="Celebrating dog"
                className="w-52 h-52 object-contain drop-shadow-lg"
              />
            </div>
            <h3 className="font-serif text-3xl text-white mb-3">You're all set!</h3>
            <p className="text-white/80 mb-6 max-w-sm mx-auto leading-relaxed">
              Thanks {name}! We'll reach out within a few hours to confirm your service.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="tel:8058698070"
                className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-full text-sm font-medium transition-colors border border-white/30"
              >
                <Phone size={14} />
                (805) 869-8070
              </a>
              <a
                href="mailto:josue@scoopdogg.net"
                className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-full text-sm font-medium transition-colors border border-white/30"
              >
                <Mail size={14} />
                josue@scoopdogg.net
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
