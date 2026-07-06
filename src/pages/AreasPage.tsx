import { Link } from 'react-router-dom';
import { MapPin, ArrowRight } from 'lucide-react';
import { CITIES } from '../lib/cities';
import { useSEO } from '../lib/useSEO';

export default function AreasPage() {
  useSEO({
    title: 'Service Areas | Dog Poop Cleaning Across Ventura County | Scoop Dogg',
    description: 'Scoop Dogg provides dog poop cleaning services across 15 cities in Ventura County and nearby areas. Find your city and book in 60 seconds.',
    canonicalPath: '/areas',
  });

  const venturaCities = CITIES.filter((c) => c.region === 'ventura-county');
  const nearbyCities = CITIES.filter((c) => c.region === 'nearby');

  return (
    <div className="bg-cream">
      <section className="bg-forest pt-28 pb-16 md:pt-36 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-4">
            Areas We Serve
          </h1>
          <p className="text-sage text-lg max-w-xl mx-auto leading-relaxed">
            Professional dog poop cleaning across Ventura County and surrounding communities. Find your city below.
          </p>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl text-dark mb-8">Ventura County</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
            {venturaCities.map((city) => (
              <Link
                key={city.slug}
                to={`/areas/${city.slug}`}
                className="group flex items-center gap-4 bg-white rounded-xl border border-sage-light p-5 hover:shadow-card hover:-translate-y-0.5 transition-all"
              >
                <div className="w-10 h-10 rounded-full bg-sage-light flex items-center justify-center flex-shrink-0 group-hover:bg-forest/10 transition-colors">
                  <MapPin size={18} className="text-forest" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-dark group-hover:text-forest transition-colors">{city.name}</h3>
                  <p className="text-dark/40 text-sm truncate">{city.metaDescription.split('.')[0]}</p>
                </div>
                <ArrowRight size={16} className="text-dark/20 group-hover:text-forest transition-colors flex-shrink-0" />
              </Link>
            ))}
          </div>

          {nearbyCities.length > 0 && (
            <>
              <h2 className="font-serif text-3xl text-dark mb-8">Nearby Service Areas</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {nearbyCities.map((city) => (
                  <Link
                    key={city.slug}
                    to={`/areas/${city.slug}`}
                    className="group flex items-center gap-4 bg-white rounded-xl border border-sage-light p-5 hover:shadow-card hover:-translate-y-0.5 transition-all"
                  >
                    <div className="w-10 h-10 rounded-full bg-sage-light flex items-center justify-center flex-shrink-0 group-hover:bg-forest/10 transition-colors">
                      <MapPin size={18} className="text-forest" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-dark group-hover:text-forest transition-colors">{city.name}</h3>
                      <p className="text-dark/40 text-sm truncate">{city.metaDescription.split('.')[0]}</p>
                    </div>
                    <ArrowRight size={16} className="text-dark/20 group-hover:text-forest transition-colors flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="py-16 bg-forest">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl text-white mb-4">Don't see your area?</h2>
          <p className="text-sage mb-8 max-w-md mx-auto">
            Give us a call — we may still be able to serve you.
          </p>
          <a
            href="tel:8058698070"
            className="inline-flex items-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            Call (805) 869-8070
          </a>
        </div>
      </section>
    </div>
  );
}
