import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown, Phone } from 'lucide-react';
import { CITIES } from '../lib/cities';

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [areasOpen, setAreasOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 20);
      if (y < 80) {
        setHidden(false);
      } else if (y > lastScrollY.current + 8) {
        setHidden(true);
      } else if (y < lastScrollY.current - 4) {
        setHidden(false);
      }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setAreasOpen(false);
  }, [location]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAreasOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled || mobileOpen
            ? 'bg-white/95 backdrop-blur-md shadow-nav'
            : 'bg-white'
        } ${hidden && !mobileOpen ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}
      >
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-[5px]">
            <Link
              to="/"
              className="hover:opacity-80 transition-opacity"
            >
              <img
                src="/horizontallogo.png"
                alt="Scoop Dogg — Pooper Scoopers and Turf Maintenance"
                className="h-[84px] w-auto object-contain"
              />
            </Link>

            <nav className="hidden nav:flex items-center gap-6">
              <Link
                to="/"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                Home
              </Link>

              <Link
                to="/services"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                Services
              </Link>

              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setAreasOpen((p) => !p)}
                  className="flex items-center gap-1 text-dark hover:text-forest font-medium transition-colors text-sm"
                >
                  Areas We Serve
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${areasOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {areasOpen && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white rounded-card shadow-card-hover border border-sage-light p-4 z-50">
                    <Link
                      to="/areas"
                      className="block px-3 py-2 rounded-lg text-sm font-semibold text-forest hover:bg-sage-light transition-colors mb-1"
                    >
                      All Areas
                    </Link>
                    <div className="grid grid-cols-2 gap-1">
                      {CITIES.map((city) => (
                        <Link
                          key={city.slug}
                          to={`/areas/${city.slug}`}
                          className="px-3 py-1.5 rounded-lg text-sm text-dark hover:bg-sage-light hover:text-forest transition-colors"
                        >
                          {city.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Link
                to="/about"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                About
              </Link>

              <Link
                to="/resources"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                Resources
              </Link>

              <Link
                to="/gallery"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                Gallery
              </Link>

              <Link
                to="/reviews"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                Reviews
              </Link>

              <Link
                to="/contact"
                className="text-dark hover:text-forest font-medium transition-colors text-sm"
              >
                Contact
              </Link>
            </nav>

            <div className="hidden nav:flex items-center gap-3">
              <a
                href="tel:8058698070"
                className="flex items-center gap-1.5 text-dark hover:text-forest text-sm font-medium transition-colors"
              >
                <Phone size={14} />
                (805) 869-8070
              </a>
              <Link
                to="/book"
                className="bg-amber hover:bg-amber-hover text-white font-semibold px-5 py-2.5 rounded-full text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md"
              >
                Book Now
              </Link>
            </div>

            <button
              onClick={() => setMobileOpen((p) => !p)}
              className="nav:hidden p-2 text-dark hover:text-forest transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-white pt-[160px]">
          <div className="p-6 flex flex-col gap-2">
            <Link
              to="/"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              Home
            </Link>

            <Link
              to="/services"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              Services
            </Link>

            <div className="border-b border-sage-light">
              <button
                onClick={() => setAreasOpen((p) => !p)}
                className="w-full py-3 text-lg font-medium text-dark flex items-center justify-between"
              >
                Areas We Serve
                <ChevronDown
                  size={18}
                  className={`transition-transform ${areasOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {areasOpen && (
                <div className="pb-3">
                  <Link
                    to="/areas"
                    className="block py-2 px-3 rounded-lg font-semibold text-forest hover:bg-sage-light transition-colors mb-1"
                  >
                    All Areas
                  </Link>
                  <div className="grid grid-cols-2 gap-1">
                    {CITIES.map((city) => (
                      <Link
                        key={city.slug}
                        to={`/areas/${city.slug}`}
                        className="py-2 px-3 rounded-lg text-dark hover:bg-sage-light hover:text-forest transition-colors"
                      >
                        {city.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link
              to="/about"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              About
            </Link>

            <Link
              to="/resources"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              Resources
            </Link>

            <Link
              to="/gallery"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              Gallery
            </Link>

            <Link
              to="/reviews"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              Reviews
            </Link>

            <Link
              to="/contact"
              className="py-3 text-lg font-medium text-dark border-b border-sage-light"
            >
              Contact
            </Link>

            <div className="mt-4 flex flex-col gap-3">
              <a
                href="tel:8058698070"
                className="flex items-center justify-center gap-2 py-3 border border-forest text-forest font-semibold rounded-full"
              >
                <Phone size={16} />
                (805) 869-8070
              </a>
              <Link
                to="/book"
                className="flex items-center justify-center bg-amber hover:bg-amber-hover text-white font-semibold py-3.5 rounded-full transition-colors"
              >
                Book Now
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
