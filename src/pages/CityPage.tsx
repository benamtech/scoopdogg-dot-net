import { useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import {
  MapPin,
  ArrowRight,
  ChevronDown,
  Phone,
  Star,
  Shield,
  Clock,
  Award,
  CalendarCheck,
  Scissors,
} from 'lucide-react';
import { CITY_MAP } from '../lib/cities';
import { SERVICES } from '../lib/services';
import { useSEO } from '../lib/useSEO';
import { SITE_URL } from '../lib/constants';
import BookingWidget from '../components/BookingWidget';

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-sage-light last:border-0">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between py-4 text-left font-medium text-dark hover:text-forest transition-colors"
      >
        {q}
        <ChevronDown
          size={18}
          className={`flex-shrink-0 ml-4 transition-transform ${open ? 'rotate-180 text-forest' : 'text-dark/40'}`}
        />
      </button>
      {open && (
        <p className="text-dark/60 pb-4 leading-relaxed text-sm">{a}</p>
      )}
    </div>
  );
}

const WHY_ITEMS = [
  {
    icon: Award,
    title: 'Locally Owned, Not a Franchise',
    body: 'Josue lives and works in Ventura County. You\'re hiring a neighbor, not a call center.',
  },
  {
    icon: Shield,
    title: 'Flexible Service',
    body: 'Skip a week, pause for vacation, cancel anytime. We earn your business every visit.',
  },
  {
    icon: CalendarCheck,
    title: 'Background-Checked Team',
    body: 'Every team member is vetted and insured. Your property and pets are in safe hands.',
  },
  {
    icon: Scissors,
    title: "We Don't Just Scoop — We Clean",
    body: 'Turf deodorizing, sanitizing, full waste hauling. We leave your yard better than we found it.',
  },
  {
    icon: Clock,
    title: 'Consistent Scheduling',
    body: 'Same day, same time, every week. You\'ll forget we\'re even coming — until you notice how clean your yard stays.',
  },
];

export default function CityPage() {
  const { city: slug } = useParams<{ city: string }>();
  const city = slug ? CITY_MAP[slug] : null;

  const faqSchema = city ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: city.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  } : undefined;

  const breadcrumbSchema = city ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Areas', item: `${SITE_URL}/areas` },
      { '@type': 'ListItem', position: 3, name: city.name, item: `${SITE_URL}/areas/${slug}` },
    ],
  } : undefined;

  const localBusinessSchema = city ? {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${SITE_URL}/#business`,
    name: 'Scoop Dogg',
    url: `${SITE_URL}/areas/${slug}`,
    telephone: '+18058698070',
    areaServed: { '@type': 'City', name: city.name, containedInPlace: { '@type': 'State', name: 'California' } },
    description: `Professional dog waste removal in ${city.name}, CA. Weekly scooping, one-time cleanups, artificial turf deodorizing, and yard deep cleans.`,
    review: {
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: city.testimonial.name },
      reviewBody: city.testimonial.quote,
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `Pet Care Services in ${city.name}`,
      itemListElement: SERVICES.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name, url: `${SITE_URL}/areas/${slug}/${s.slug}` },
      })),
    },
  } : undefined;

  useSEO({
    title: city ? `Dog Poop Cleaning in ${city.name}, CA | Scoop Dogg` : 'Scoop Dogg',
    description: city ? `Professional dog poop cleaning in ${city.name}, CA. Weekly yard scooping from $15/visit, turf deodorizing, and one-time cleanups. Locally owned.` : '',
    canonicalPath: `/areas/${slug || ''}`,
    jsonLd: faqSchema && breadcrumbSchema && localBusinessSchema
      ? [localBusinessSchema, faqSchema, breadcrumbSchema]
      : undefined,
  });

  if (!city) return <Navigate to="/" replace />;

  return (
    <div className="bg-cream">

      {/* ── 1. HERO ─────────────────────────────────────────────── */}
      <section className="bg-forest pt-28 pb-16 md:pt-36 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 text-sage text-sm mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link to="/#areas" className="hover:text-white transition-colors">Areas</Link>
            <span>/</span>
            <span className="text-white">{city.name}</span>
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-4 max-w-2xl">
            Dog Poop Cleaning in {city.name}, CA
          </h1>
          <p className="text-sage text-lg max-w-2xl leading-relaxed mb-8">
            {city.intro}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-8">
            <Link
              to={`/book?city=${encodeURIComponent(city.name)}`}
              className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-7 py-3.5 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg text-base"
            >
              Book in 60 Seconds <ArrowRight size={16} />
            </Link>
            <a
              href="tel:8058698070"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/40 hover:border-white text-white hover:bg-white/10 font-semibold px-7 py-3.5 rounded-full transition-all text-base"
            >
              <Phone size={16} />
              Call (805) 869-8070
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-sage">
            {['5-Star Rated', 'Fully Insured', 'Locally Owned', 'Cancel Anytime'].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber flex-shrink-0" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. SOCIAL PROOF BAR ──────────────────────────────────── */}
      <section className="bg-white py-14 border-b border-sage-light">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center">
            <div className="flex items-center justify-center gap-1 mb-5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={20} className="fill-amber text-amber" />
              ))}
            </div>
            <blockquote className="font-serif text-2xl sm:text-3xl text-dark leading-snug mb-5">
              "{city.testimonial.quote}"
            </blockquote>
            <p className="text-dark/50 font-medium">
              — {city.testimonial.name}, {city.testimonial.city}
            </p>
            <a
              href="https://share.google/vnH0pVWnpbT5ppAQ7"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-4 text-sm text-dark/40 hover:text-forest transition-colors"
            >
              <Star size={13} className="fill-amber text-amber" />
              Read more reviews on Google
            </a>
          </div>
        </div>
      </section>

      {/* ── 3. SERVICES ──────────────────────────────────────────── */}
      <section className="py-20 bg-cream">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-2">Our Services in {city.name}</h2>
            <p className="text-dark/50 max-w-xl mx-auto">Professional, reliable service — cancel or pause anytime.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 mb-10">
            {SERVICES.map((service) => (
              <Link
                key={service.slug}
                to={`/areas/${slug}/${service.slug}`}
                className="bg-white rounded-2xl border border-sage-light hover:shadow-card hover:-translate-y-1 transition-all flex flex-col p-6 group"
              >
                <h3 className="font-semibold text-dark text-base leading-tight mb-1 group-hover:text-forest transition-colors">
                  {service.shortName}
                </h3>
                <p className="text-dark/40 text-xs mb-3">{service.pricing[0].label}</p>
                <p className="text-dark/60 text-sm leading-relaxed flex-1 mb-4">
                  {service.whoItsFor}
                </p>
                <p className="font-bold text-forest text-sm mb-3">From {service.pricing[0].price}</p>
                <span className="flex items-center gap-1.5 text-forest text-sm font-semibold">
                  Learn more <ArrowRight size={13} />
                </span>
              </Link>
            ))}
          </div>

          {/* CTA bar below cards */}
          <div className="bg-forest rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-5">
            <div>
              <p className="text-sage text-xs font-semibold uppercase tracking-widest mb-1">Serving {city.name}</p>
              <h3 className="font-serif text-2xl text-white">Ready to Get Started?</h3>
              <p className="text-sage text-sm mt-1">Book in 60 seconds. No commitment. We confirm same day.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
              <Link
                to={`/book?city=${encodeURIComponent(city.name)}`}
                className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold py-3 px-7 rounded-full transition-all hover:scale-[1.02] hover:shadow-md whitespace-nowrap"
              >
                Book in 60 Seconds →
              </Link>
              <a
                href="tel:8058698070"
                className="inline-flex items-center justify-center gap-2 border border-white/30 text-white hover:bg-white/10 py-3 px-6 rounded-full transition-all text-sm whitespace-nowrap"
              >
                <Phone size={14} />
                (805) 869-8070
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. HOW IT WORKS ──────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl text-dark mb-2 text-center">How It Works</h2>
          <p className="text-dark/50 text-center mb-12">Simple from day one — no guesswork, no hassle.</p>

          <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-3xl mx-auto">
            <div className="hidden sm:block absolute top-8 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-0.5 bg-sage-light" />

            {[
              {
                n: '1',
                title: 'Pick Your Service',
                body: 'Weekly scooping, turf deodorizing, or a one-time deep clean. Try us risk-free.',
              },
              {
                n: '2',
                title: 'We Show Up',
                body: "Our background-checked team arrives on your scheduled day. You don't need to be home — we handle everything and secure the gate behind us.",
              },
              {
                n: '3',
                title: 'Enjoy Your Yard',
                body: 'Bare feet welcome. Let the dogs out, host a barbecue, let the kids play. Your yard is yours again.',
              },
            ].map((step) => (
              <div key={step.n} className="flex flex-col items-center text-center relative">
                <div className="w-14 h-14 rounded-full bg-sage-light flex items-center justify-center mb-4 font-bold text-forest text-lg z-10 relative">
                  {step.n}
                </div>
                <h3 className="font-semibold text-dark mb-2">{step.title}</h3>
                <p className="text-dark/60 text-sm leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. NEIGHBORHOODS ─────────────────────────────────────── */}
      {city.neighborhoods.length > 0 && (
        <section className="py-16 bg-cream">
          <div className="max-w-site mx-auto px-4 sm:px-6 max-w-3xl">
            <h2 className="font-serif text-3xl text-dark mb-2">Neighborhoods We Serve</h2>
            <p className="text-dark/50 mb-6">We service homes across {city.name}, including:</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {city.neighborhoods.map((n) => (
                <span key={n} className="bg-white text-forest text-sm px-4 py-1.5 rounded-full font-medium border border-sage-light">
                  {n}
                </span>
              ))}
            </div>
            <p className="text-dark/50 text-sm">
              Not sure if we cover your street? Give us a call — if we're in {city.name}, we can probably get to you.
            </p>
          </div>
        </section>
      )}

      {/* ── 6. WHY SCOOP DOGG ────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-8">
                Why {city.name} Dog Owners Choose Scoop Dogg
              </h2>
              <div className="space-y-6">
                {WHY_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-sage-light flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Icon size={18} className="text-forest" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-dark mb-1">{item.title}</h3>
                        <p className="text-dark/60 text-sm leading-relaxed">{item.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="relative">
              <div className="aspect-[3/4] rounded-3xl overflow-hidden">
                <img
                  src="/Artificial-Grass-for-Dogs-Runs-Pet-Areas.jpeg"
                  alt="Dog walking on a clean, green yard"
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-4 -left-4 bg-amber text-white rounded-2xl p-4 shadow-lg">
                <p className="font-serif text-2xl leading-none">5.0</p>
                <div className="flex gap-0.5 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={10} className="fill-white text-white" />
                  ))}
                </div>
                <p className="text-white/80 text-xs mt-1">Google Rating</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. LOCAL CONTEXT ─────────────────────────────────────── */}
      <section className="py-20 bg-cream">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center max-w-4xl">
            <div>
              <p className="text-amber font-semibold text-sm uppercase tracking-widest mb-3">Local Knowledge</p>
              <h2 className="font-serif text-3xl text-dark mb-5">
                Keeping {city.name} Yards Clean
              </h2>
              <p className="text-dark/70 leading-relaxed text-base">
                {city.localContext}
              </p>
              <Link
                to={`/book?city=${encodeURIComponent(city.name)}`}
                className="inline-flex items-center gap-2 mt-6 bg-forest hover:bg-forest/90 text-white font-semibold px-6 py-3 rounded-full transition-all text-sm"
              >
                Check Availability in {city.name} <ArrowRight size={14} />
              </Link>
            </div>

            <div className="aspect-video rounded-2xl overflow-hidden">
              <img
                src="/period-property-wandsworth-the-garden-builders-img~3611b9650440e3da_14-3105-1-fc97e21.jpg"
                alt={`Dog lounging in a clean ${city.name} yard`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 8. FAQ ───────────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6 max-w-3xl">
          <h2 className="font-serif text-3xl text-dark mb-2">
            Frequently Asked Questions
          </h2>
          <p className="text-dark/50 mb-8">{city.name}, CA</p>
          <div className="bg-cream rounded-2xl p-6 border border-sage-light">
            {city.faqs.map((faq) => (
              <FAQItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
          <p className="mt-6 text-dark/40 text-sm text-center">
            More questions?{' '}
            <a href="tel:8058698070" className="text-forest hover:underline">Call us at (805) 869-8070</a>
            {' '}or{' '}
            <a href="mailto:josue@scoopdogg.net" className="text-forest hover:underline">send us an email</a>.
          </p>
        </div>
      </section>

      {/* ── 9. NEARBY AREAS ──────────────────────────────────────── */}
      {city.nearbySlug.length > 0 && (
        <section className="py-16 bg-cream">
          <div className="max-w-site mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-2xl text-dark mb-6">Nearby Areas We Serve</h2>
            <div className="flex flex-wrap gap-3">
              {city.nearbySlug.map((s) => {
                const nearby = CITY_MAP[s];
                if (!nearby) return null;
                return (
                  <Link
                    key={s}
                    to={`/areas/${s}`}
                    className="flex items-center gap-2 px-5 py-3 bg-white text-forest font-medium rounded-xl hover:bg-forest hover:text-white transition-all text-sm border border-sage-light"
                  >
                    <MapPin size={14} />
                    {nearby.name}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── 10. BOOKING SECTION ──────────────────────────────────── */}
      <section className="bg-forest py-20 md:py-24">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl sm:text-4xl text-white mb-4">
              Book Service in {city.name}
            </h2>
            <p className="text-sage max-w-md mx-auto">
              Takes less than 60 seconds. We'll reach out same day.
            </p>
          </div>
          <BookingWidget preselectedCity={city.name} sourcePage={`/areas/${slug}`} />
        </div>
      </section>
    </div>
  );
}
