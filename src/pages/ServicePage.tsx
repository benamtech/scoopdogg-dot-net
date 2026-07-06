import { useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Phone, CheckCircle } from 'lucide-react';
import { SERVICE_MAP } from '../lib/services';
import { CITIES } from '../lib/cities';
import { useSEO } from '../lib/useSEO';
import { SITE_URL } from '../lib/constants';

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
      {open && <p className="text-dark/60 pb-4 leading-relaxed text-sm">{a}</p>}
    </div>
  );
}

export default function ServicePage() {
  const { service: slug } = useParams<{ service: string }>();
  const service = slug ? SERVICE_MAP[slug] : null;

  const faqSchema = service ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: service.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  } : undefined;

  const breadcrumbSchema = service ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Services', item: `${SITE_URL}/services` },
      { '@type': 'ListItem', position: 3, name: service.name, item: `${SITE_URL}/services/${slug}` },
    ],
  } : undefined;

  const serviceSchema = service ? {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.intro,
    provider: { '@type': 'LocalBusiness', '@id': `${SITE_URL}/#business` },
    areaServed: [
      'Ventura', 'Oxnard', 'Camarillo', 'Thousand Oaks', 'Simi Valley',
      'Ojai', 'Newbury Park', 'Moorpark', 'Westlake Village', 'Santa Paula',
      'Oak View', 'Fillmore', 'Santa Barbara', 'Carpinteria', 'Malibu',
    ].map((name) => ({ '@type': 'City', name })),
    url: `${SITE_URL}/services/${slug}`,
    offers: service.pricing.map((p) => ({
      '@type': 'Offer',
      name: p.label,
      price: p.price,
      priceCurrency: 'USD',
    })),
  } : undefined;

  useSEO({
    title: service?.metaTitle || 'Scoop Dogg',
    description: service?.metaDescription || '',
    canonicalPath: `/services/${slug || ''}`,
    jsonLd: faqSchema && breadcrumbSchema && serviceSchema
      ? [serviceSchema, faqSchema, breadcrumbSchema]
      : undefined,
  });

  if (!service) return <Navigate to="/services" replace />;

  const relatedServices = service.relatedSlugs
    .map((s) => SERVICE_MAP[s])
    .filter(Boolean);

  const tier1Cities = CITIES.filter((c) =>
    ['ventura', 'oxnard', 'camarillo', 'thousand-oaks', 'simi-valley', 'santa-barbara', 'carpinteria'].includes(c.slug)
  );

  return (
    <div className="bg-cream">
      <section className="bg-forest pt-28 pb-16 md:pt-36 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 text-sage text-sm mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link to="/services" className="hover:text-white transition-colors">Services</Link>
            <span>/</span>
            <span className="text-white">{service.shortName}</span>
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-5 max-w-3xl">
            {service.h1}
          </h1>
          <p className="text-sage text-lg max-w-2xl leading-relaxed mb-8">
            {service.intro}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to={`/book?service=${service.bookingId}`}
              className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-7 py-3.5 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg text-base"
            >
              Book This Service <ArrowRight size={16} />
            </Link>
            <a
              href="tel:8058698070"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/40 hover:border-white text-white hover:bg-white/10 font-semibold px-7 py-3.5 rounded-full transition-all text-base"
            >
              <Phone size={16} />
              (805) 869-8070
            </a>
          </div>
        </div>
      </section>

      <section className="relative -mt-1">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="rounded-2xl overflow-hidden shadow-card h-48 md:h-64">
            <img
              src="/period-property-wandsworth-the-garden-builders-img~3611b9650440e3da_14-3105-1-fc97e21.jpg"
              alt="Dog enjoying a clean, green yard"
              loading="lazy"
              className="w-full h-full object-cover object-center"
            />
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h2 className="font-serif text-3xl text-dark mb-6">What's Included</h2>
              <ul className="space-y-4">
                {service.whatIncludes.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle size={18} className="text-forest mt-0.5 flex-shrink-0" />
                    <span className="text-dark/70 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="font-serif text-3xl text-dark mb-6">Who It's For</h2>
              <p className="text-dark/70 leading-relaxed mb-8">{service.whoItsFor}</p>

              <h3 className="font-semibold text-dark mb-4">Pricing</h3>
              <div className="bg-sage-light rounded-2xl p-6">
                {service.pricing.map((p) => (
                  <div key={p.label} className="flex items-center justify-between py-2 border-b border-white/60 last:border-0">
                    <span className="text-dark/70 text-sm">{p.label}</span>
                    <span className="font-semibold text-forest">{p.price}</span>
                  </div>
                ))}
                <p className="text-dark/50 text-xs mt-4">{service.pricingNote}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-cream">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl text-dark mb-6">Available In</h2>
          <div className="flex flex-wrap gap-3">
            {tier1Cities.map((city) => (
              <Link
                key={city.slug}
                to={`/areas/${city.slug}/${service.slug}`}
                className="px-5 py-2.5 bg-white text-forest font-medium rounded-xl hover:bg-forest hover:text-white transition-all text-sm border border-sage-light"
              >
                {city.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6 max-w-3xl">
          <h2 className="font-serif text-3xl text-dark mb-8">Frequently Asked Questions</h2>
          <div className="bg-cream rounded-2xl p-6 border border-sage-light">
            {service.faqs.map((faq) => (
              <FAQItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {relatedServices.length > 0 && (
        <section className="py-16 bg-cream">
          <div className="max-w-site mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-2xl text-dark mb-6">Related Services</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {relatedServices.map((rs) => (
                <Link
                  key={rs.slug}
                  to={`/services/${rs.slug}`}
                  className="bg-white rounded-xl border border-sage-light p-6 hover:shadow-card hover:-translate-y-0.5 transition-all"
                >
                  <h3 className="font-semibold text-dark mb-1">{rs.name}</h3>
                  <p className="text-dark/50 text-sm">From {rs.pricing[0].price}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-16 bg-forest">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl text-white mb-4">Ready to book?</h2>
          <p className="text-sage mb-8 max-w-md mx-auto">
            Takes 60 seconds. No commitment. We confirm same day.
          </p>
          <Link
            to={`/book?service=${service.bookingId}`}
            className="inline-flex items-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            Book {service.shortName} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}
