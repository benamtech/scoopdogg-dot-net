import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { CITIES } from '../../lib/cities';

export default function Areas() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-amber py-24 md:py-32 relative overflow-hidden" ref={ref}>
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none select-none opacity-[0.07]"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <pattern id="areas-grid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <circle cx="30" cy="30" r="1" fill="#fff" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#areas-grid)" />
      </svg>

      <div className="relative max-w-site mx-auto px-4 sm:px-6">
        <div className="flex justify-center mb-6">
          <img src="/32logo.png" alt="Scoop Dogg" loading="lazy" decoding="async" width={300} height={300} className="h-[300px] w-auto" />
        </div>

        <div className="text-center mb-14">
          <span className="inline-block text-xs font-bold tracking-[0.12em] text-white/80 uppercase mb-5 bg-white/15 border border-white/25 px-5 py-2 rounded-full">
            Service Area
          </span>
          <h2 className="font-serif text-4xl sm:text-[2.6rem] text-white mb-4">
            Serving All of Ventura County and More
          </h2>
          <p className="text-white/70 text-lg max-w-md mx-auto leading-relaxed">
            We cover 15 cities and growing. Find your neighborhood below.
          </p>
        </div>

        <div
          className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-10 transition-all duration-700 ${
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          {CITIES.map((city) => (
            <Link
              key={city.slug}
              to={`/areas/${city.slug}`}
              className="group flex items-center justify-center px-5 py-3.5 bg-white rounded-xl border border-white text-dark font-medium text-sm hover:bg-forest hover:text-white hover:border-forest hover:scale-[1.03] transition-all duration-200 min-h-[48px] shadow-sm"
            >
              {city.name}
            </Link>
          ))}
        </div>

        <div className="text-center">
          <p className="text-white/60 text-sm">
            Expanding soon.{' '}
            <a
              href="tel:8058698070"
              className="text-white font-semibold hover:text-white/80 transition-colors inline-flex items-center gap-1.5"
            >
              <Phone size={13} />
              Call us — we might already be in your neighborhood.
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
