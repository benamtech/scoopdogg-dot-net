import { useEffect, useRef, useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FEATURED_REVIEWS, MORE_REVIEWS, GOOGLE_PROFILE_URL, type Review } from '../lib/reviews';
import { useSEO } from '../lib/useSEO';

function ReviewCard({
  review,
  index,
  visible,
  variant = 'default',
}: {
  review: Review;
  index: number;
  visible: boolean;
  variant?: 'default' | 'secondary';
}) {
  const initials = review.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (variant === 'secondary') {
    return (
      <div
        className={`bg-white rounded-card border border-sage/40 p-6 transition-all duration-500 hover:shadow-card hover:-translate-y-0.5 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        }`}
        style={{ transitionDelay: `${index * 80}ms` }}
      >
        <div className="flex items-center gap-0.5 mb-3">
          {[...Array(5)].map((_, j) => (
            <Star key={j} size={12} className="fill-amber text-amber" />
          ))}
        </div>
        <p className="text-dark/70 leading-relaxed text-sm mb-4">"{review.quote}"</p>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-sage-light flex items-center justify-center flex-shrink-0">
            <span className="font-bold text-forest text-xs">{initials}</span>
          </div>
          <div>
            <p className="font-semibold text-dark text-sm">{review.name}</p>
            {review.reviewerBadge && (
              <p className="text-dark/40 text-xs">{review.reviewerBadge}</p>
            )}
          </div>
          <span className="ml-auto text-dark/30 text-xs">{review.date}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white rounded-card border border-sage/40 p-8 shadow-card transition-all duration-500 hover:shadow-card-hover hover:-translate-y-1 flex flex-col ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-0.5">
          {[...Array(5)].map((_, j) => (
            <Star key={j} size={14} className="fill-amber text-amber" />
          ))}
        </div>
        <span className="text-dark/35 text-xs">{review.date}</span>
      </div>

      <div className="relative flex-1 mb-6">
        <span className="absolute -top-2 -left-1 font-serif text-6xl text-sage/30 leading-none select-none pointer-events-none">
          "
        </span>
        <p className="text-dark/75 leading-[1.85] text-[0.95rem] pl-4">
          {review.quote}
        </p>
      </div>

      <div className="flex items-center justify-between pt-5 border-t border-sage/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-sage-light flex items-center justify-center flex-shrink-0">
            <span className="font-bold text-forest text-sm">{initials}</span>
          </div>
          <div>
            <p className="font-semibold text-dark text-sm">{review.name}</p>
            {review.reviewerBadge && (
              <p className="text-xs text-amber font-medium">{review.reviewerBadge}</p>
            )}
          </div>
        </div>
        {review.googleUrl && (
          <a
            href={review.googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest/60 hover:text-forest border border-sage/50 hover:border-forest/40 px-3 py-1.5 rounded-full transition-all duration-200"
          >
            <ExternalLink size={11} />
            Google
          </a>
        )}
      </div>
    </div>
  );
}

function FeaturedSection() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-cream py-20 md:py-28" ref={ref}>
      <div className="max-w-site mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <span className="inline-block text-xs font-bold tracking-[0.12em] text-forest uppercase mb-5 bg-white border border-sage/60 px-5 py-2 rounded-full shadow-sm">
            Verified Google Reviews
          </span>
          <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-4">
            What Dog Owners Are Saying
          </h2>
          <p className="text-dark/55 text-lg max-w-md mx-auto leading-relaxed">
            Every review is real, verified, and linked directly to Google.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURED_REVIEWS.map((review, i) => (
            <ReviewCard key={review.id} review={review} index={i} visible={visible} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MoreReviewsSection() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-sage-light py-20 md:py-28" ref={ref}>
      <div className="max-w-site mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <h2 className="font-serif text-3xl sm:text-[2rem] text-dark mb-3">
            More Happy Customers
          </h2>
          <p className="text-dark/50 text-base max-w-sm mx-auto">
            From our broader community of satisfied dog owners.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MORE_REVIEWS.map((review, i) => (
            <ReviewCard key={review.id} review={review} index={i} visible={visible} variant="secondary" />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ReviewsPage() {
  useSEO({
    title: 'Customer Reviews | Scoop Dogg — Dog Poop Cleanup Ventura County',
    description: 'Read real 5-star Google reviews from Ventura County dog owners who use Scoop Dogg for weekly pooper scooper service and yard cleanup. 5.0 average across 27 reviews.',
    canonicalPath: '/reviews',
  });

  return (
    <>
      {/* Hero */}
      <section className="bg-forest pt-36 pb-20 md:pt-44 md:pb-24 relative overflow-hidden">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none select-none opacity-[0.04]"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <pattern id="reviews-hero-grid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
              <circle cx="30" cy="30" r="1" fill="#fff" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#reviews-hero-grid)" />
        </svg>

        <div className="relative max-w-site mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-serif text-4xl sm:text-5xl md:text-[3.2rem] text-white leading-[1.15] mb-6 max-w-2xl mx-auto">
            Real Reviews from Real Dog Owners
          </h1>

          <p className="text-white/60 text-lg max-w-lg mx-auto leading-relaxed mb-10">
            27 five-star reviews from neighbors across Ventura County. See what they're saying about Josue and the Scoop Dogg team.
          </p>

          {/* Star aggregate */}
          <div className="inline-flex flex-col items-center gap-3 bg-white/10 border border-white/15 rounded-2xl px-10 py-6">
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={22} className="fill-amber text-amber" />
              ))}
            </div>
            <p className="text-white font-bold text-2xl leading-none">5.0</p>
            <p className="text-white/50 text-sm">27 Google reviews</p>
            <a
              href={GOOGLE_PROFILE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-amber hover:text-amber/80 text-xs font-semibold transition-colors mt-1"
            >
              <ExternalLink size={11} />
              View our Google profile
            </a>
          </div>
        </div>
      </section>

      <FeaturedSection />
      <MoreReviewsSection />

      {/* CTA */}
      <section className="bg-forest py-20 md:py-24">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl sm:text-4xl text-white mb-4">
            Ready to Join Them?
          </h2>
          <p className="text-white/60 text-lg max-w-md mx-auto mb-8 leading-relaxed">
            Book your first cleanup and see why Ventura County dog owners trust Scoop Dogg.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/book"
              className="bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-3.5 rounded-full text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
            >
              Book Your First Cleanup
            </Link>
            <Link
              to="/services"
              className="text-white/60 hover:text-white font-medium text-sm transition-colors"
            >
              View all services →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}