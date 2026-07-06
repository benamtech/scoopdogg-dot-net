import { useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Phone, CheckCircle, MapPin } from 'lucide-react';
import { CITY_MAP } from '../lib/cities';
import { SERVICE_MAP, SERVICES } from '../lib/services';
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
      {open && <p className="text-dark/60 pb-4 leading-relaxed text-sm">{a}</p>}
    </div>
  );
}

function generateIntro(cityName: string, _serviceName: string, serviceSlug: string): string {
  const intros: Record<string, (c: string) => string> = {
    'weekly-pooper-scooper-service': (city) =>
      `Looking for reliable weekly pooper scooper service in ${city}? Scoop Dogg shows up on the same day every week, walks your entire yard, scoops every pile, bags it, and hauls it off your property. Cancel or pause anytime — just a consistently clean yard. Most ${city} homeowners start at $15/week for one dog and never think about dog waste again.`,
    'one-time-dog-poop-cleanup': (city) =>
      `Need a one-time dog poop cleanup in ${city}? Whether you just moved in, fell behind on yard maintenance, or are hosting an event, our crew will handle the full backlog in a single visit. We walk every inch of your ${city} property, scoop everything regardless of age or accumulation, double-bag it, and haul it away. One visit, clean slate.`,
    'artificial-turf-deodorizing': (city) =>
      `Artificial turf in ${city} looks great — until pet urine creates persistent odor that water alone cannot fix. Our enzyme-based deodorizing treatment in ${city} breaks down bacteria at a molecular level, eliminating smell from turf, gravel, concrete, and patios. The treatment is 100% natural and pet-safe — dogs can use the yard immediately after application.`,
    'yard-deep-clean': (city) =>
      `Our yard and turf deep clean service in ${city} is a full reset for your outdoor surfaces. We deep-brush the turf to loosen embedded debris, vacuum the infill, pressure wash the surface, and apply heavy-duty deodorizer and sanitizer. Ideal for ${city} homeowners inheriting turf from a previous owner or doing a seasonal yard reset.`,
    'weekly-turf-maintenance': (city) =>
      `Keep your artificial turf in ${city} looking pristine year-round with weekly turf maintenance from Scoop Dogg. Using the SwipeSmith artificial turf sweeper, we remove leaves, pet hair, twigs, and embedded debris from your turf on a consistent weekly schedule, then apply enzyme deodorizer to eliminate odor before it builds up. ${city} homeowners with dogs find this service keeps their turf looking and smelling like the day it was installed.`,
    'weekly-yard-maintenance': (city) =>
      `Regular yard maintenance in ${city} means your outdoor space stays guest-ready all year without you lifting a finger. Scoop Dogg provides scheduled mowing, edging, trimming, and cleanup on the same day every week. Whether you have a small backyard in a ${city} neighborhood or a larger lot with mature landscaping, we tailor the service to what your property actually needs.`,
    'kitty-litter-exchange': (city) =>
      `Kitty litter exchange service in ${city} means no more putting off the task that every cat owner dreads. Scoop Dogg removes used litter, refreshes your cat's box, and tidies the surrounding area on a schedule that works for you. ${city} cat owners love not having to think about it — we show up, handle it, and leave everything clean.`,
    'dog-run-cleanups': (city) =>
      `Dog runs and side yards in ${city} are the most neglected spots on any property — out of sight, out of mind, until the smell becomes impossible to ignore. Scoop Dogg specializes in cleaning enclosed dog runs, gravel potty areas, turf strips, and high-use pet zones throughout ${city}. We scoop everything out, treat for odor, and leave the space clean and usable again.`,
    'cat-tree-cleaning': (city) =>
      `Cat trees in ${city} homes accumulate hair, litter dust, dander, and odor faster than most owners expect — and most never get around to a proper deep clean. Scoop Dogg handles the job without you having to drag the structure outside yourself. We clean all levels, wipe down surfaces, treat for odor, and remove embedded debris using pet-safe products that are safe for your cats immediately after.`,
    'pressure-washing': (city) =>
      `Pet-area pressure washing in ${city} tackles the staining and ground-in odor on concrete, pavers, and hardscape that a garden hose simply cannot remove. After solid waste is cleared, we use high-pressure washing to restore your outdoor surfaces and eliminate what regular cleaning leaves behind. Responsible water direction is always part of our process — nothing directed toward gutters or storm drains.`,
    'kitty-litter-robot-cleaning': (city) =>
      `The Litter-Robot is an incredible invention — but like any litter box, it needs deep cleaning to stay fresh and function properly. Our Litter-Robot cleaning service in ${city} includes full teardown, globe scrub, waste drawer sanitizing, sensor cleaning, and carbon filter refresh. ${city} cat owners with automatic litter boxes love that we handle the messy job they keep putting off.`,
  };
  return intros[serviceSlug]?.(cityName) || '';
}

function generateFaqs(cityName: string, _serviceName: string, serviceSlug: string) {
  const base: Record<string, (city: string) => { q: string; a: string }[]> = {
    'weekly-pooper-scooper-service': (city) => [
      { q: `How much does weekly pooper scooper service cost in ${city}?`, a: `$15/week for 1 dog, $20/week for 2 dogs, $23/week for 3 dogs, and $25/week for 4+ dogs. No setup fees, cancel anytime.` },
      { q: `What day do you service ${city}?`, a: `Your specific route day is confirmed when you book. We stick to the same day every week for consistency.` },
      { q: `Do I need to be home during service in ${city}?`, a: `No. Leave gate access instructions when you book and we handle everything — then secure the gate behind us.` },
      { q: `Can I skip or cancel weekly service in ${city}?`, a: `Absolutely. Skip a week, pause for vacation, or cancel anytime with no fees or questions asked.` },
    ],
    'one-time-dog-poop-cleanup': (city) => [
      { q: `How much does a one-time poop cleanup cost in ${city}?`, a: `Standard cleanups start at $99. Heavy buildup (3-6 weeks) is typically $149. Severe cases with multiple dogs get a custom quote.` },
      { q: `How quickly can you do a one-time cleanup in ${city}?`, a: `Most new customers are confirmed within 24 hours. We can often schedule within a few days depending on route availability.` },
      { q: `Can I switch to weekly service after a one-time cleanup?`, a: `Yes — many ${city} customers start with a one-time cleanup and transition to weekly. No additional setup fee.` },
      { q: `Do you remove the waste from my property?`, a: `Yes. Everything is double-bagged and hauled away. Nothing goes in your trash cans.` },
    ],
    'artificial-turf-deodorizing': (city) => [
      { q: `Is turf deodorizing safe for my dogs in ${city}?`, a: `Yes, 100%. The enzymes are natural and non-toxic. Dogs can use the yard immediately after application.` },
      { q: `How much does turf deodorizing cost in ${city}?`, a: `Starting at $20 for small areas (under 200 sq ft), $35 for medium (200-500 sq ft), and $50+ for large areas.` },
      { q: `How long does the deodorizing treatment last?`, a: `Results are immediate and typically last 2-4 weeks. Many ${city} clients add it to their weekly service schedule.` },
      { q: `Does it work on surfaces other than artificial turf?`, a: `Yes. The enzyme treatment works on artificial turf, gravel, concrete, pavers, and natural grass.` },
    ],
    'yard-deep-clean': (city) => [
      { q: `How much does a yard deep clean cost in ${city}?`, a: `Starting at $99 for standard turf areas under 500 sq ft. Larger areas and heavily soiled properties receive a custom quote.` },
      { q: `How often should I get a deep clean in ${city}?`, a: `We recommend 2-3 times per year. Homes with multiple dogs or heavy yard use may benefit from quarterly service.` },
      { q: `What is included in the deep clean?`, a: `Deep brush, infill vacuum, pressure wash, and heavy-duty enzyme deodorizer and sanitizer application.` },
      { q: `Can I walk on the turf right after?`, a: `We recommend waiting 1-2 hours for the surface to dry after pressure washing. The deodorizer is pet-safe immediately.` },
    ],
    'weekly-turf-maintenance': (city) => [
      { q: `How much does weekly turf maintenance cost in ${city}?`, a: `Starting at $35/visit for small areas under 300 sq ft, $50/visit for medium areas, and custom quotes for large areas.` },
      { q: `What is included in each weekly turf visit in ${city}?`, a: `A SwipeSmith sweeper pass to remove leaves, pet hair, and debris, plus an enzyme deodorizer application. We also redistribute infill as needed.` },
      { q: `Do I need a deep clean before starting weekly turf maintenance?`, a: `We recommend starting with a deep clean if the turf hasn't been professionally cleaned before. After that, weekly maintenance keeps it in peak condition.` },
      { q: `Can I combine turf maintenance with weekly poop scooping?`, a: `Yes — many ${city} clients pair both services on the same visit. It's the most comprehensive way to keep turf looking and smelling great.` },
    ],
    'weekly-yard-maintenance': (city) => [
      { q: `What does weekly yard maintenance include in ${city}?`, a: `Mowing, edging, and basic trimming are standard. We can add leaf cleanup, shrub shaping, and other tasks based on your property's needs.` },
      { q: `How much does weekly yard maintenance cost in ${city}?`, a: `From $40/visit for small yards with basic mow and edge. Medium yards with trimming start at $65/visit. Larger properties get a custom quote.` },
      { q: `Can I combine yard maintenance with poop scooping in ${city}?`, a: `Absolutely. Many clients pair both on the same weekly visit — same team, same day.` },
      { q: `How do I get a quote for yard maintenance in ${city}?`, a: `Book through our form and describe your property. We follow up same day with a custom quote based on yard size and services needed.` },
    ],
    'kitty-litter-exchange': (city) => [
      { q: `How much does kitty litter exchange service cost in ${city}?`, a: `$15/visit for one litter box, $22/visit for two boxes, and custom pricing for three or more.` },
      { q: `Do I need to be home for litter exchange service in ${city}?`, a: `No. As long as we have safe indoor access, we handle the exchange without you needing to be there.` },
      { q: `Do you bring the fresh litter?`, a: `We can use litter you already have on hand, or supply it for an additional fee. Just let us know when you book.` },
      { q: `How often should I schedule litter exchange in ${city}?`, a: `Most cat owners benefit from a full exchange once a week. Multi-cat homes may need more frequent service — we can set up a custom schedule.` },
    ],
    'dog-run-cleanups': (city) => [
      { q: `How much does dog run cleanup cost in ${city}?`, a: `$49 for small runs under 100 sq ft, $79 for medium runs up to 300 sq ft, and custom quotes for larger areas.` },
      { q: `Do you handle gravel dog runs in ${city}?`, a: `Yes. Gravel and decomposed granite are some of the most common dog run surfaces we work in — waste hides easily in gravel so we are very thorough.` },
      { q: `Can I add enzyme treatment to a dog run cleanup?`, a: `Absolutely. Most dog run cleanups benefit from an enzyme deodorizer application after waste removal, especially on turf or concrete surfaces.` },
      { q: `Is dog run cleanup different from your regular yard scooping?`, a: `Yes. Dog runs are concentrated, tightly enclosed areas that need focused attention — the cleanup intensity is different from a standard yard walk.` },
    ],
    'cat-tree-cleaning': (city) => [
      { q: `How much does cat tree cleaning cost in ${city}?`, a: `$25 for small trees with 1-2 levels, $45 for large trees with 3 or more levels. Multiple trees get a custom quote.` },
      { q: `Do you disassemble the cat tree to clean it in ${city}?`, a: `We clean it in place for most standard trees. For trees that need disassembly to reach all areas, we let you know beforehand.` },
      { q: `What cleaning products do you use on cat trees?`, a: `Pet-safe, enzyme-based cleaners that neutralize odor without harsh chemicals — nothing that would harm your cats after the clean.` },
      { q: `How often should cat trees be professionally cleaned?`, a: `A few times per year is reasonable for most households. Multi-cat homes or cats recovering from illness may benefit from more frequent cleaning.` },
    ],
    'pressure-washing': (city) => [
      { q: `How much does pet area pressure washing cost in ${city}?`, a: `$59 for small patios or runs under 200 sq ft, $99 for medium areas up to 500 sq ft, and custom quotes for larger surfaces.` },
      { q: `Do you remove pet waste before washing in ${city}?`, a: `Yes, always. Solid waste is scooped and removed before any pressure washing begins. We never wash waste toward gutters, drains, or neighboring properties.` },
      { q: `What surfaces can you pressure wash?`, a: `Concrete, pavers, brick, tile, and most hardscape. We do not pressure wash artificial turf — turf gets the enzyme deep clean treatment instead.` },
      { q: `Can I add pressure washing to my regular cleanup visit?`, a: `Yes. Pressure washing is commonly added on to dog run cleanups, one-time yard cleanups, or yard deep cleans in ${city}. Just mention it when you book.` },
    ],
    'kitty-litter-robot-cleaning': (city) => [
      { q: `How much does Litter-Robot cleaning cost in ${city}?`, a: `$45 for one Litter-Robot, $75 for two, and custom pricing for three or more units. Includes carbon filter refresh.` },
      { q: `How often should I have my Litter-Robot professionally cleaned in ${city}?`, a: `We recommend a deep clean every 2-3 months for most households. Multiple cats may need more frequent service.` },
      { q: `Do you clean both Litter-Robot 3 and 4 models?`, a: `Yes, we service Litter-Robot 3, 4, and similar automatic self-cleaning litter boxes from other brands.` },
      { q: `What is included in the Litter-Robot cleaning?`, a: `Full globe interior wipe-down and scrub, waste drawer cleaned and deodorized, carbon filter replacement or refresh, exterior housing wiped, sensor areas cleaned, and reassembly with function check.` },
    ],
  };
  return base[serviceSlug]?.(cityName) || [];
}

function generateSituation(cityName: string, serviceSlug: string): { title: string; body: string } {
  const situations: Record<string, (city: string) => { title: string; body: string }> = {
    'weekly-pooper-scooper-service': (city) => ({
      title: `Common in ${city}`,
      body: `Many ${city} homeowners with multiple dogs find that waste accumulates faster than they can keep up — especially during busy work weeks. By the time the weekend arrives, the backyard is off-limits. Weekly service eliminates that cycle entirely. Your yard stays clean between visits, and you never have to think about it.`,
    }),
    'one-time-dog-poop-cleanup': (city) => ({
      title: `Common in ${city}`,
      body: `We frequently get calls from ${city} residents who just moved into a home with an inherited yard mess, or who are preparing for a family event and need the yard usable again fast. A single visit gets you back to zero — and from there, many clients choose to stay on weekly so it never builds up again.`,
    }),
    'artificial-turf-deodorizing': (city) => ({
      title: `Common in ${city}`,
      body: `Many newer ${city} homes installed artificial turf as part of drought-conscious landscaping. It looks great — but after months of dog use without proper enzyme treatment, the smell becomes noticeable. A single deodorizing application eliminates the odor, and regular treatments keep it from coming back.`,
    }),
    'yard-deep-clean': (city) => ({
      title: `Common in ${city}`,
      body: `${city} homeowners who inherited turf from a previous owner often discover that surface-level cleaning is not enough. Years of embedded pet waste, dirt, and bacteria need a full mechanical reset — not just a spray. Our deep clean removes what hosing and regular deodorizing cannot reach.`,
    }),
    'weekly-turf-maintenance': (city) => ({
      title: `Common in ${city}`,
      body: `${city} homeowners with artificial turf often start with a deep clean and then realize they need a consistent plan to keep it that way. Leaves, pet hair, and pollen collect fast between deep cleans. Weekly maintenance with the SwipeSmith sweeper keeps the turf groomed and odor-free without waiting for things to build up.`,
    }),
    'weekly-yard-maintenance': (city) => ({
      title: `Common in ${city}`,
      body: `Many ${city} residents find that keeping up with mowing, edging, and trimming is one chore too many on top of busy work and family schedules. A consistent weekly maintenance visit keeps the yard looking sharp without requiring any effort on your part — same team, same day, every week.`,
    }),
    'kitty-litter-exchange': (city) => ({
      title: `Common in ${city}`,
      body: `Cat owners in ${city} often find themselves putting off litter box maintenance despite knowing it needs attention. A scheduled litter exchange takes the task completely off your plate. No reminders needed, no unpleasant jobs — just a clean box waiting for your cat every week.`,
    }),
    'dog-run-cleanups': (city) => ({
      title: `Common in ${city}`,
      body: `Side yards and dog runs in ${city} get neglected because they're not visible from the main part of the property. But they're often where the most concentrated waste builds up — especially in gravel runs where waste hides under the surface. Regular cleanup of these areas prevents odor from migrating to the rest of the yard.`,
    }),
    'cat-tree-cleaning': (city) => ({
      title: `Common in ${city}`,
      body: `Most cat owners in ${city} admit their cat tree has never been professionally cleaned — it's one of those tasks that gets pushed off indefinitely. But a grimy, smelly cat tree affects the whole room. A professional clean removes months of accumulated hair, dust, and odor in a single visit.`,
    }),
    'pressure-washing': (city) => ({
      title: `Common in ${city}`,
      body: `Concrete patios and pavers in ${city} dog areas develop staining and ground-in odor over time that hosing alone cannot address. High-pressure washing restores the surface and removes residue that regular cleaning misses. Many ${city} clients combine it with a yard deep clean or dog run cleanup for a complete outdoor reset.`,
    }),
    'kitty-litter-robot-cleaning': (city) => ({
      title: `Common in ${city}`,
      body: `Cat owners in ${city} with Litter-Robots love the convenience — but the device still needs regular deep cleaning to prevent odor buildup and keep sensors working properly. Most owners never get around to taking it apart themselves. Our professional clean restores freshness and function without the hassle.`,
    }),
  };
  return situations[serviceSlug]?.(cityName) || { title: '', body: '' };
}

export default function CityServicePage() {
  const { city: citySlug, service: serviceSlug } = useParams<{ city: string; service: string }>();
  const city = citySlug ? CITY_MAP[citySlug] : null;
  const service = serviceSlug ? SERVICE_MAP[serviceSlug] : null;

  const faqs = city && service ? generateFaqs(city.name, service.name, service.slug) : [];

  const faqSchema = city && service ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  } : undefined;

  const breadcrumbSchema = city && service ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Areas', item: `${SITE_URL}/areas` },
      { '@type': 'ListItem', position: 3, name: city.name, item: `${SITE_URL}/areas/${citySlug}` },
      { '@type': 'ListItem', position: 4, name: service.shortName, item: `${SITE_URL}/areas/${citySlug}/${serviceSlug}` },
    ],
  } : undefined;

  const serviceSchema = city && service ? {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `${service.name} in ${city.name}, CA`,
    description: generateIntro(city.name, service.name, service.slug),
    provider: { '@type': 'LocalBusiness', '@id': `${SITE_URL}/#business` },
    areaServed: { '@type': 'City', name: `${city.name}, CA` },
    url: `${SITE_URL}/areas/${citySlug}/${serviceSlug}`,
  } : undefined;

  useSEO({
    title: city && service
      ? `${service.name} in ${city.name}, CA | Scoop Dogg`
      : 'Scoop Dogg',
    description: city && service
      ? `Professional ${service.name.toLowerCase()} in ${city.name}, CA. ${service.pricing[0].price}. Locally owned. Book in 60 seconds.`
      : '',
    canonicalPath: `/areas/${citySlug || ''}/${serviceSlug || ''}`,
    jsonLd: faqSchema && breadcrumbSchema && serviceSchema
      ? [serviceSchema, faqSchema, breadcrumbSchema]
      : undefined,
  });

  if (!city || !service) return <Navigate to={city ? `/areas/${citySlug}` : '/areas'} replace />;

  const intro = generateIntro(city.name, service.name, service.slug);
  const situation = generateSituation(city.name, service.slug);

  const otherServices = SERVICES.filter((s) => s.slug !== serviceSlug);
  const nearbyAreas = city.nearbySlug
    .map((s) => CITY_MAP[s])
    .filter(Boolean);

  return (
    <div className="bg-cream">
      <section className="bg-forest pt-28 pb-16 md:pt-36 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 text-sage text-sm mb-4 flex-wrap">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link to="/areas" className="hover:text-white transition-colors">Areas</Link>
            <span>/</span>
            <Link to={`/areas/${citySlug}`} className="hover:text-white transition-colors">{city.name}</Link>
            <span>/</span>
            <span className="text-white">{service.shortName}</span>
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-5 max-w-3xl">
            {service.name} in {city.name}, CA
          </h1>
          <p className="text-sage text-lg max-w-2xl leading-relaxed mb-8">
            {intro}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to={`/book?service=${service.bookingId}&city=${encodeURIComponent(city.name)}`}
              className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-7 py-3.5 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg text-base"
            >
              Book in {city.name} <ArrowRight size={16} />
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
              <h3 className="font-semibold text-dark mb-4">Pricing in {city.name}</h3>
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

      {situation.body && (
        <section className="py-16 bg-cream">
          <div className="max-w-site mx-auto px-4 sm:px-6 max-w-3xl">
            <p className="text-amber font-semibold text-sm uppercase tracking-widest mb-3">{situation.title}</p>
            <p className="text-dark/70 leading-relaxed text-base">{situation.body}</p>
          </div>
        </section>
      )}

      <section className="py-20 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6 max-w-3xl">
          <h2 className="font-serif text-3xl text-dark mb-8">Frequently Asked Questions</h2>
          <div className="bg-cream rounded-2xl p-6 border border-sage-light">
            {faqs.map((faq) => (
              <FAQItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {otherServices.length > 0 && (
        <section className="py-16 bg-cream">
          <div className="max-w-site mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-2xl text-dark mb-6">Other Services in {city.name}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {otherServices.map((os) => (
                <Link
                  key={os.slug}
                  to={`/areas/${citySlug}/${os.slug}`}
                  className="bg-white rounded-xl border border-sage-light p-6 hover:shadow-card hover:-translate-y-0.5 transition-all"
                >
                  <h3 className="font-semibold text-dark mb-1">{os.shortName}</h3>
                  <p className="text-dark/50 text-sm">From {os.pricing[0].price}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {nearbyAreas.length > 0 && (
        <section className="py-16 bg-white">
          <div className="max-w-site mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-2xl text-dark mb-6">Nearby Areas</h2>
            <div className="flex flex-wrap gap-3">
              {nearbyAreas.map((na) => (
                <Link
                  key={na.slug}
                  to={`/areas/${na.slug}`}
                  className="flex items-center gap-2 px-5 py-3 bg-sage-light text-forest font-medium rounded-xl hover:bg-forest hover:text-white transition-all text-sm"
                >
                  <MapPin size={14} />
                  {na.name}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="bg-forest py-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl sm:text-4xl text-white mb-4">
              Book {service.shortName} in {city.name}
            </h2>
            <p className="text-sage max-w-md mx-auto">
              Takes less than 60 seconds. We confirm same day.
            </p>
          </div>
          <BookingWidget preselectedCity={city.name} preselectedService={service.bookingId} sourcePage={`/areas/${citySlug}/${serviceSlug}`} />
        </div>
      </section>
    </div>
  );
}
