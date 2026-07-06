import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, Sparkles, Leaf, Waves, Cat, Wind, Scissors, Brush } from 'lucide-react';

/* ═══════════════════════════════════════════
   Section 1 — Pet Waste & Yard Cleaning
   ═══════════════════════════════════════════ */
const yardServices = [
  {
    icon: RefreshCw,
    label: 'Keep It Clean',
    badge: 'Most Popular',
    sub: 'Weekly poop scooping — billed monthly',
    desc: "We show up same day every week, walk the entire property, scoop every pile, bag it, and haul it off. First month is half off. Cancel anytime.",
    details: ['1 dog · $15/week', '2 dogs · $20/week', '3 dogs · $23/week', '4+ dogs · $25/week'],
    detailsLabel: 'Pricing:',
    price: 'From $15/week',
    priceNote: 'First month 50% off',
    cta: 'Get Weekly Service',
    href: '/book?service=weekly',
    accent: true,
    mascot: '/2dog-with-shovel.png',
    mascotAlt: 'Dog holding scooping tools',
    cropMascot: false,
  },
];

/* ═══════════════════════════════════════════
   Section 2 — Turf Maintenance
   ═══════════════════════════════════════════ */
const turfServices = [
  {
    icon: Sparkles,
    label: 'Turf Deep Clean',
    badge: null,
    sub: 'One-time deep clean & restoration',
    desc: "A full turf reset: deep brush, infill vacuum, pressure wash, heavy deodorizer and sanitizer. Recommended for new homeowners and 2–3 times per year to keep turf in peak condition.",
    details: ['Deep brush & infill vacuum', 'Pressure wash entire surface', 'Heavy deodorizer & sanitizer', 'Final rinse & inspection'],
    detailsLabel: 'Includes:',
    price: 'Starting at $99',
    priceNote: null,
    cta: 'Book a Deep Clean',
    href: '/book?service=one-time',
    accent: false,
    mascot: '/dog-with-lawn-mower.png',
    mascotAlt: 'Dog with lawn mower',
    cropMascot: true,
  },
  {
    icon: Brush,
    label: 'Weekly Turf Maintenance',
    badge: 'New',
    sub: 'Ongoing turf sweeping & deodorizing',
    desc: "After a deep clean, we come back weekly with the SwipeSmith artificial turf sweeper. It picks up leaves, twigs, pet hair, and debris that collect between visits. Paired with enzyme deodorizing to keep odor at zero.",
    details: ['SwipeSmith turf sweeper pass', 'Debris & leaf removal', 'Enzyme deodorizer application', 'Infill redistribution as needed'],
    detailsLabel: 'Includes:',
    price: 'Starting at $35/visit',
    priceNote: null,
    cta: 'Book Turf Maintenance',
    href: '/book?service=turf',
    accent: false,
    mascot: '/2dog-spraying-turf-deodorizer.png',
    mascotAlt: 'Dog spraying turf deodorizer',
  },
];

/* ═══════════════════════════════════════════
   Section 3 — Landscaping & Yard Maintenance
   ═══════════════════════════════════════════ */
const landscapingServices = [
  {
    icon: Leaf,
    label: 'Yard Deep Clean & Overgrowth Reset',
    badge: null,
    sub: 'One-time full yard restoration',
    desc: "Overgrown weeds, debris piles, dead brush, and general neglect — we handle it all in one visit. Ideal for yards that need a fresh start before ongoing maintenance, or seasonal resets that go beyond regular mowing.",
    details: ['Overgrowth & weed removal', 'Debris & waste hauled off', 'Edging & trimming', 'Full property walkthrough'],
    detailsLabel: 'Includes:',
    price: 'Starting at $99',
    priceNote: null,
    cta: 'Book Yard Restoration',
    href: '/book?service=yard-deep-clean',
    accent: false,
    mascot: '/dog-with-weedwacker.png',
    mascotAlt: 'Dog with weed wacker',
  },
  {
    icon: Scissors,
    label: 'Weekly Yard Maintenance',
    badge: 'New',
    sub: 'Mowing, trimming & general upkeep',
    desc: "Ongoing yard maintenance tailored to what your property needs — mowing, edging, trimming, leaf cleanup, or a combination. We keep things looking sharp between the deep cleans so your outdoor space is always guest-ready.",
    details: ['Mowing & edging', 'Hedge & shrub trimming', 'Leaf & debris cleanup', 'Customizable to your property'],
    detailsLabel: 'Can include:',
    price: 'Custom quote',
    priceNote: 'Based on property size',
    cta: 'Get a Maintenance Quote',
    href: '/book?service=yard-maintenance',
    accent: false,
    mascot: 'https://i.ibb.co/prvTXTXd/transp-dog-character-mowing-grass.png',
    mascotAlt: 'Dog character with leaf blower',
    cropMascot: true,
  },
];

/* ═══════════════════════════════════════════
   Section 4 — Pressure Washing (standalone)
   ═══════════════════════════════════════════ */
const pressureWashService = {
  icon: Waves,
  label: 'Pressure Washing',
  sub: 'Patios, driveways, hardscape & dog runs',
  desc: "Dried residue, staining, and ground-in grime on concrete and pavers does not come out with a garden hose. We remove solid waste first, hit the surface with high-pressure water, and direct everything responsibly — nothing toward gutters or storm drains.",
  details: ['Solid waste removed first', 'High-pressure wash of all hard surfaces', 'Responsible water direction', 'Optional enzyme deodorizer after'],
  detailsLabel: 'Includes:',
  price: 'Starting at $59',
  cta: 'Book Pressure Washing',
  href: '/book?service=pressure-washing',
};

/* ═══════════════════════════════════════════
   Section 5 — Extra Pet Services
   ═══════════════════════════════════════════ */
const petAddonServices = [
  {
    icon: Cat,
    label: 'Kitty Litter Exchange',
    sub: 'Weekly litter box cleaning',
    desc: 'Used litter removed, box wiped, fresh litter added. Flexible schedule — weekly or as-needed.',
    price: 'From $15/visit',
    cta: 'Book Litter Exchange',
    href: '/book?service=kitty-litter',
    learnHref: '/services/kitty-litter-exchange',
    mascot: 'https://i.ibb.co/B5YqDzzq/transp-cat-character-cleaning-litter-box.png',
    mascotAlt: 'Cat character cleaning a litter box',
  },
  {
    icon: Wind,
    label: 'Cat Tree Cleaning',
    sub: 'Pet furniture deep clean',
    desc: 'Hair, litter dust, and odor removed from cat trees and scratching posts. Pet-safe products only.',
    price: 'From $25',
    cta: 'Book Cat Tree Cleaning',
    href: '/book?service=cat-tree',
    learnHref: '/services/cat-tree-cleaning',
    mascot: 'https://i.ibb.co/C5W7dZ5x/transp-cat-character-cleaning-cat-tree.png',
    mascotAlt: 'Cat character cleaning a cat tree',
  },
  {
    icon: Sparkles,
    label: 'Kitty Litter Robot Cleaning',
    sub: 'Automatic litter box care',
    desc: 'Full teardown and deep clean of your Litter-Robot or automatic self-cleaning litter box. Globe, drawer, sensors — all restored.',
    price: 'From $45',
    cta: 'Book Litter Robot Cleaning',
    href: '/book?service=litter-robot',
    learnHref: '/services/kitty-litter-robot-cleaning',
    mascot: 'https://i.ibb.co/h3QqsW8/5878.png',
    mascotAlt: 'Litter-Robot automatic litter box',
  },
];

/* ═══════════════════════════════════════════
   Service Card Components
   ═══════════════════════════════════════════ */

function ServiceCard({ s, i, visible, accent }: { s: typeof yardServices[0]; i: number; visible: boolean; accent?: boolean }) {
  const Icon = s.icon;
  const isAccent = accent ?? s.accent;
  const cropStyle = s.cropMascot ? { clipPath: 'inset(3px 6px 0 0)' } : undefined;

  return (
    <div>
      {s.mascot && (
        <div className="flex justify-center min-[640px]:hidden mb-3">
          <img
            src={s.mascot}
            alt={s.mascotAlt}
            loading="lazy"
            decoding="async"
            width={144}
            height={144}
            style={cropStyle}
            className="h-36 w-auto object-contain drop-shadow-md pointer-events-none select-none"
          />
        </div>
      )}

      <div
        className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        style={{ transitionDelay: `${i * 120}ms` }}
      >
        <div
          className={`relative bg-white rounded-card p-8 flex flex-col h-full ${
            isAccent
              ? 'border-2 border-amber shadow-[0_2px_0_rgba(244,160,36,0.12),0_8px_30px_rgba(0,0,0,0.09)] hover:shadow-[0_4px_0_rgba(244,160,36,0.18),0_16px_40px_rgba(0,0,0,0.13)]'
              : 'border border-dark/8 shadow-[0_2px_8px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.07),0_16px_40px_rgba(0,0,0,0.1)]'
          } hover:-translate-y-1 transition-all duration-200`}
        >
          {s.badge && (
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className={`text-white text-xs font-bold px-5 py-1.5 rounded-full tracking-[0.06em] shadow-sm ${s.badge === 'New' ? 'bg-forest' : 'bg-amber'}`}>
                {s.badge}
              </span>
            </div>
          )}

          {s.mascot && (
            <img
              src={s.mascot}
              alt={s.mascotAlt}
              loading="lazy"
              decoding="async"
              width={208}
              height={208}
              style={cropStyle}
              className="hidden min-[640px]:block absolute -top-28 -right-10 w-52 h-52 object-contain drop-shadow-md pointer-events-none select-none"
            />
          )}

          <div className="w-11 h-11 rounded-xl bg-sage-light flex items-center justify-center mb-6">
            <Icon size={20} className="text-forest" />
          </div>

          <h3 className="font-serif text-2xl text-dark mb-1">{s.label}</h3>
          <p className="text-[0.72rem] font-bold text-forest uppercase tracking-[0.1em] mb-4">{s.sub}</p>
          <p className="text-dark/60 text-[0.95rem] leading-[1.75] mb-5">{s.desc}</p>

          <div className="bg-sage-light/70 rounded-xl px-4 py-3 mb-6">
            <p className="text-[0.7rem] font-bold text-forest uppercase tracking-[0.1em] mb-2">{s.detailsLabel}</p>
            <ul className="flex flex-col gap-1.5">
              {s.details.map((d) => (
                <li key={d} className="text-xs text-dark/60 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-sage flex-shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto">
            <div className="mb-4">
              <p className="font-bold text-dark text-lg">{s.price}</p>
              {s.priceNote && <p className="text-forest text-xs font-semibold">{s.priceNote}</p>}
            </div>
            <Link
              to={s.href}
              className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-full font-semibold text-sm transition-all duration-200 hover:scale-[1.02] ${
                isAccent
                  ? 'bg-amber hover:bg-amber-hover text-white hover:shadow-[0_4px_14px_rgba(244,160,36,0.35)]'
                  : 'bg-forest hover:bg-forest-dark text-white hover:shadow-[0_4px_14px_rgba(27,67,50,0.25)]'
              }`}
            >
              {s.cta}
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <div className="mb-10 md:mb-14">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-forest/60 mb-2">{label}</p>
      <h3 className="font-serif text-3xl sm:text-[2.2rem] text-dark mb-3 leading-snug">{title}</h3>
      <p className="text-dark/55 max-w-xl leading-relaxed">{description}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════ */

export default function Services() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.02 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="pt-10 pb-0 overflow-visible" ref={ref}>
      {/* Intro */}
      <div className="bg-amber pt-10 pb-16 md:pt-14 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-4xl sm:text-[2.6rem] text-white mb-5">Our Services</h2>
          <p className="text-white/80 text-lg max-w-2xl mx-auto leading-relaxed">
            We are the only dedicated turf maintenance and pet waste service in Ventura County.
            From a messy first visit to a clean-every-week routine — here is how we get your yard, turf, and patio looking right and keep it that way.
          </p>

          {/* Video + caption */}
          <div className="mt-10 max-w-3xl mx-auto flex flex-col md:flex-row items-center md:items-stretch gap-6 md:gap-8">
            <div className="w-full md:w-auto md:flex-shrink-0">
              <video
                autoPlay
                muted
                loop
                playsInline
                className="rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.25)] w-full md:w-72 lg:w-80 object-cover"
              >
                <source src="https://i.imgur.com/kAUWMAw.mp4" type="video/mp4" />
              </video>
            </div>
            <div className="flex flex-col justify-center text-left">
              <p className="text-white font-serif text-2xl sm:text-3xl leading-snug mb-3">
                The results speak for themselves.
              </p>
              <p className="text-white/75 leading-relaxed">
                Animation created using real before and after photos.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── SECTION 1: Yard Cleaning ─── */}
      <div className="bg-sage-light pt-20 pb-24 md:pt-24 md:pb-28 overflow-visible">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <SectionHeading
            label="Yard Cleaning"
            title="Weekly Pet Waste Removal"
            description="The foundation of everything we do. Consistent weekly visits to keep your yard clean, so you never have to think about dog poop again. Billed monthly — first month is half off."
          />

          <div className="flex flex-col gap-10 min-[640px]:grid min-[640px]:grid-cols-1 min-[640px]:max-w-lg overflow-visible min-[640px]:mt-36">
            {yardServices.map((s, i) => (
              <ServiceCard key={s.label} s={s} i={i} visible={visible} />
            ))}
          </div>
        </div>
      </div>

      {/* ─── SECTION 2: Turf Maintenance ─── */}
      <div className="bg-white pt-20 pb-24 md:pt-24 md:pb-28 border-t border-sage-light overflow-visible">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <SectionHeading
            label="Turf Maintenance"
            title="The Only Reputable Turf Service in the Area"
            description="Most people install artificial turf thinking it is zero maintenance. It is not — especially with dogs. We have the SwipeSmith turf sweeper, pressure washing equipment, and professional-grade enzyme treatments to keep your turf looking and smelling like the day it was installed. Whether you have pets or not."
          />

          <div className="flex flex-col gap-10 min-[640px]:grid min-[640px]:grid-cols-2 min-[640px]:gap-y-28 min-[640px]:gap-x-6 min-[640px]:mt-36 overflow-visible">
            {turfServices.map((s, i) => (
              <ServiceCard key={s.label} s={s} i={i} visible={visible} />
            ))}
          </div>

          {/* Callout about equipment */}
          <div className="mt-12 bg-sage-light/80 rounded-2xl p-6 md:p-8 max-w-2xl">
            <p className="text-dark/70 text-sm leading-relaxed">
              <span className="font-semibold text-dark/80">Our equipment:</span> We use the SwipeSmith artificial turf sweeper — a specialized grooming mower that picks up leaves, pet hair, twigs, and debris that collect between deep cleans. Combined with our pressure washer and enzyme treatments, we offer a level of turf care no one else in Ventura County provides.
            </p>
          </div>
        </div>
      </div>

      {/* ─── SECTION 3: Landscaping & Yard Maintenance ─── */}
      <div className="bg-sage-light pt-20 pb-24 md:pt-24 md:pb-28 border-t border-sage/30 overflow-visible">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <SectionHeading
            label="Landscaping"
            title="Yard Restoration & Ongoing Maintenance"
            description="Some yards need a serious reset before weekly upkeep makes sense. We handle the heavy lifting — overgrowth, debris, dead brush — then transition into regular maintenance that keeps things looking clean. Mowing, trimming, edging, or all of the above."
          />

          <div className="flex flex-col gap-10 min-[640px]:grid min-[640px]:grid-cols-2 min-[640px]:gap-y-28 min-[640px]:gap-x-6 min-[640px]:mt-36 overflow-visible">
            {landscapingServices.map((s, i) => (
              <ServiceCard key={s.label} s={s} i={i} visible={visible} />
            ))}
          </div>
        </div>
      </div>

      {/* ─── SECTION 4: Pressure Washing (featured standalone) ─── */}
      <div className="bg-forest py-20 md:py-28 relative overflow-hidden">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none select-none opacity-[0.04]"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <pattern id="pw-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1" fill="#fff" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#pw-grid)" />
        </svg>

        <div className="relative max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex justify-center lg:hidden mb-6">
                <div className="relative w-full max-w-sm">
                  <img
                    src="https://i.ibb.co/DffTVcmD/IMG-20260523-162331.png"
                    alt="Pressure washing a patio"
                    loading="lazy"
                    className="w-full h-64 object-contain rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.35)] pointer-events-none select-none"
                  />
                  <div className="absolute -top-2 -right-2 bg-amber text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                    Most requested add-on
                  </div>
                </div>
              </div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-sage/60 mb-3">Featured Service</p>
              <h3 className="font-serif text-3xl sm:text-4xl text-white mb-5 leading-snug">
                Pressure Washing
              </h3>
              <p className="text-white/70 leading-[1.8] mb-6">
                {pressureWashService.desc}
              </p>
              <ul className="space-y-2.5 mb-8">
                {pressureWashService.details.map((d) => (
                  <li key={d} className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-amber mt-2 flex-shrink-0" />
                    <span className="text-white/60 text-sm leading-relaxed">{d}</span>
                  </li>
                ))}
              </ul>
              <p className="text-white font-bold text-xl mb-1">{pressureWashService.price}</p>
              <p className="text-white/40 text-xs mb-6">Driveways, patios, dog runs, and more</p>
              <Link
                to={pressureWashService.href}
                className="inline-flex items-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-[0_6px_24px_rgba(244,160,36,0.45)]"
              >
                {pressureWashService.cta}
                <ArrowRight size={16} />
              </Link>
            </div>

            <div className="hidden lg:flex items-center justify-center">
              <div className="relative w-full">
                <img
                  src="https://i.ibb.co/DffTVcmD/IMG-20260523-162331.png"
                  alt="Pressure washing a patio"
                  loading="lazy"
                  className="w-full h-[480px] object-contain rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.35)] pointer-events-none select-none"
                />
                <div className="absolute -top-4 -right-4 bg-amber text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg">
                  Most requested add-on
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── SECTION 5: Extra Pet Services ─── */}
      <div className="bg-white pt-20 pb-24 md:pt-24 md:pb-28 border-t border-sage-light overflow-visible">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <SectionHeading
            label="Extra Pet Services"
            title="Indoor Pet Cleanup"
            description="Not just yards. We also handle the indoor stuff that nobody wants to deal with — litter boxes and cat tree cleaning. Same diligent team, same reliable schedule."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-44 gap-x-6 max-w-2xl mt-40">
            {petAddonServices.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.label}>
                <div
                  className={`relative bg-cream rounded-2xl border border-sage-light p-6 flex flex-col hover:shadow-card hover:-translate-y-1 transition-all duration-200 overflow-visible ${
                    visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                  }`}
                  style={{ transitionDelay: `${(i + 6) * 120}ms` }}
                >
                  {s.mascot && (
                    <img
                      src={s.mascot}
                      alt={s.mascotAlt}
                      loading="lazy"
                      className="absolute -top-36 -right-6 w-64 h-64 object-contain drop-shadow-md pointer-events-none select-none"
                    />
                  )}
                  <div className="w-10 h-10 rounded-xl bg-white border border-sage-light flex items-center justify-center mb-4">
                    <Icon size={18} className="text-forest" />
                  </div>
                  <h4 className="font-serif text-lg text-dark mb-1">{s.label}</h4>
                  <p className="text-[0.68rem] font-bold text-forest uppercase tracking-[0.1em] mb-3">{s.sub}</p>
                  <p className="text-dark/60 text-sm leading-relaxed mb-[60px]">{s.desc}</p>

                  <div className="mt-auto">
                    <p className="font-bold text-dark text-sm mb-3">{s.price}</p>
                    <Link
                      to={s.href}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-full font-semibold text-xs bg-forest hover:bg-forest-dark text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(27,67,50,0.25)] mb-2"
                    >
                      {s.cta}
                      <ArrowRight size={13} />
                    </Link>
                    <Link
                      to={s.learnHref}
                      className="flex items-center justify-center gap-1 w-full py-2 text-xs text-dark/40 hover:text-forest transition-colors font-medium"
                    >
                      Learn more
                    </Link>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom summary */}
      <div className="bg-sage-light border-t border-sage/30 py-12">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <p className="text-dark/60 leading-relaxed max-w-2xl mx-auto">
            Poop scooping. Turf sweeping. Landscaping. Pressure washing. Litter boxes.
            We are the one reliable service that keeps your entire property — inside and out — clean every single week.
          </p>
          <Link
            to="/services"
            className="inline-flex items-center gap-2 text-forest font-semibold text-sm mt-4 hover:gap-3 transition-all"
          >
            View all service details <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
