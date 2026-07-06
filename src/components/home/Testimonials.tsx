import { useEffect, useRef, useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FEATURED_REVIEWS, GOOGLE_PROFILE_URL } from '../../lib/reviews';

const HOMEPAGE_REVIEWS = [FEATURED_REVIEWS[5], FEATURED_REVIEWS[0], FEATURED_REVIEWS[1]]; // Alex Torres, Wendy Ramirez, Amber Morua

export default function Testimonials() {
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
    <section className="bg-forest py-24 md:py-32" ref={ref}>
      <div className="max-w-site mx-auto px-4 sm:px-6">
        <div className="text-center mb-16">
          <span className="inline-block text-xs font-bold tracking-[0.12em] text-amber uppercase mb-5 bg-white/10 border border-white/15 px-5 py-2 rounded-full">
            Customer Reviews
          </span>
          <h2 className="font-serif text-4xl sm:text-[2.6rem] text-white mb-6">
            What Our Customers Say
          </h2>
          <p className="font-serif text-2xl sm:text-3xl text-amber italic mb-5 leading-tight max-w-xl mx-auto">
            "He always goes the extra mile to make sure everything looks perfect."
          </p>
          <div className="flex items-center justify-center gap-1 mb-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} size={16} className="fill-amber text-amber" />
            ))}
          </div>
          <p className="text-white/40 text-sm">5.0 average · 19 Google reviews</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {HOMEPAGE_REVIEWS.map((t, i) => (
            <div
              key={t.id}
              className={`relative bg-white/10 backdrop-blur-sm border border-white/10 rounded-card p-8 transition-all duration-500 hover:bg-white/15 hover:-translate-y-1 overflow-hidden flex flex-col ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{ transitionDelay: `${i * 120}ms` }}
            >
              <div className="absolute top-4 right-5 font-serif text-[5rem] text-white/10 leading-none select-none pointer-events-none">
                "
              </div>

              <div className="flex items-center gap-0.5 mb-5">
                {[...Array(5)].map((_, j) => (
                  <Star key={j} size={13} className="fill-amber text-amber" />
                ))}
              </div>

              <p className="text-white/75 leading-[1.8] text-[0.96rem] mb-6 relative flex-1">
                {t.quote}
              </p>

              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-white text-sm">{t.name[0]}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">{t.name}</p>
                    {t.reviewerBadge && (
                      <p className="text-white/40 text-xs">{t.reviewerBadge}</p>
                    )}
                  </div>
                </div>
                {t.googleUrl && (
                  <a
                    href={t.googleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/30 hover:text-amber transition-colors"
                    aria-label="View on Google"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-10 flex flex-col sm:flex-row items-center justify-center gap-5">
          <Link
            to="/reviews"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-6 py-2.5 rounded-full text-sm transition-all duration-200"
          >
            Read all 27 reviews
          </Link>
          <a
            href={GOOGLE_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-white/50 hover:text-amber text-sm font-medium transition-colors"
          >
            <ExternalLink size={13} />
            View on Google
          </a>
        </div>
      </div>
    </section>
  );
}
