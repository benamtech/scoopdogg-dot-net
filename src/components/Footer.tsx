import { Link } from 'react-router-dom';
import { Phone, Mail } from 'lucide-react';
import { CITIES } from '../lib/cities';

export default function Footer() {
  return (
    <footer className="bg-forest text-white">
      <div className="max-w-site mx-auto px-4 sm:px-6 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
          <div>
            <p className="font-serif text-2xl mb-3">Scoop Dogg</p>
            <p className="text-sage text-sm mb-4 leading-relaxed">
              Ventura County's trusted pet waste removal service. Clean yards, happy dogs, zero effort.
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="tel:8058698070"
                className="flex items-center gap-2 text-white hover:text-amber transition-colors text-sm"
              >
                <Phone size={14} />
                (805) 869-8070
              </a>
              <a
                href="mailto:josue@scoopdogg.net"
                className="flex items-center gap-2 text-white hover:text-amber transition-colors text-sm"
              >
                <Mail size={14} />
                josue@scoopdogg.net
              </a>
            </div>
          </div>

          <div>
            <p className="font-semibold text-white mb-4">Services</p>
            <ul className="flex flex-col gap-2">
              <li>
                <Link to="/services/weekly-pooper-scooper-service" className="text-sage hover:text-white transition-colors text-sm">
                  Weekly Scooping
                </Link>
              </li>
              <li>
                <Link to="/services/one-time-dog-poop-cleanup" className="text-sage hover:text-white transition-colors text-sm">
                  One-Time Cleanup
                </Link>
              </li>
              <li>
                <Link to="/services/yard-deep-clean" className="text-sage hover:text-white transition-colors text-sm">
                  Yard Deep Clean
                </Link>
              </li>
              <li>
                <Link to="/services/artificial-turf-deodorizing" className="text-sage hover:text-white transition-colors text-sm">
                  Turf Deodorizing
                </Link>
              </li>
              <li>
                <Link to="/reviews" className="text-sage hover:text-white transition-colors text-sm">
                  Reviews
                </Link>
              </li>
              <li>
                <Link to="/resources" className="text-sage hover:text-white transition-colors text-sm">
                  Resources
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-sage hover:text-white transition-colors text-sm">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/book" className="text-sage hover:text-white transition-colors text-sm">
                  Book Service
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-white mb-4">Areas We Serve</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {CITIES.map((city) => (
                <li key={city.slug}>
                  <Link
                    to={`/areas/${city.slug}`}
                    className="text-sage hover:text-white transition-colors text-sm"
                  >
                    {city.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-white/10 text-center mb-6">
          <p className="text-sage/60 text-sm leading-relaxed">
            Serving Ventura County and more with pride. Locally owned, fully insured, and always just a phone call away.
          </p>
        </div>

        <div className="pt-5 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3 text-sage/50 text-xs">
          <p>© 2025 Scoop Dogg. All rights reserved.</p>
          <p>Ventura County, CA</p>
        </div>
      </div>
    </footer>
  );
}
