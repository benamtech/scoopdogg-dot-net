import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useSEO } from '../lib/useSEO';

interface GalleryItem {
  id: string;
  title: string;
  description: string;
  before: { src: string; alt: string };
  after: { src: string; alt: string };
}

const GALLERY_ITEMS: GalleryItem[] = [
  {
    id: 'backyard',
    title: 'Full Backyard Cleanup',
    description: 'A heavily used backyard brought back to a clean, usable state. Waste removed, surfaces treated, and ready for weekly maintenance to keep it this way.',
    before: {
      src: 'https://i.ibb.co/cXNyTLZV/backyard-before.jpg',
      alt: 'Backyard before cleanup',
    },
    after: {
      src: 'https://i.ibb.co/jvBZ46R5/backyard-after.jpg',
      alt: 'Backyard after cleanup',
    },
  },
  {
    id: 'backyard-section',
    title: 'Backyard Section Reset',
    description: 'A problem corner that had accumulated months of buildup. We cleared waste, applied enzyme treatment to the grass, and eliminated the odor entirely.',
    before: {
      src: 'https://i.ibb.co/MytJR8kx/backyard-section-before.jpg',
      alt: 'Backyard section before cleanup',
    },
    after: {
      src: 'https://i.ibb.co/C34RBMzR/backyard-section-after.jpg',
      alt: 'Backyard section after cleanup',
    },
  },
  {
    id: 'paved-dog-run',
    title: 'Paved Dog Run Restored',
    description: 'Years of buildup on a paved dog run require more than a hose. We pressure-washed, scrubbed, and applied a sanitizing agent that neutralizes bacteria and keeps odors from returning.',
    before: {
      src: 'https://i.ibb.co/tTjkfNpD/paved-dog-run-before.jpg',
      alt: 'Paved dog run before cleanup',
    },
    after: {
      src: 'https://i.ibb.co/B2wTdf9p/paved-dog-run-after.jpg',
      alt: 'Paved dog run after cleanup',
    },
  },
  {
    id: 'grass-dog-run',
    title: 'Grass Dog Run Cleanup',
    description: 'A grass dog run that had gotten out of hand. Waste removed, grass treated with enzyme spray, and the area sanitized to stop odor at the source.',
    before: {
      src: 'https://i.ibb.co/jv8W7Yx6/grass-dog-run-before.jpg',
      alt: 'Grass dog run before cleanup',
    },
    after: {
      src: 'https://i.ibb.co/S7tnM8v5/grass-dog-run-after.jpg',
      alt: 'Grass dog run after cleanup',
    },
  },
  {
    id: 'enclosure',
    title: 'Dog Enclosure Deep Clean',
    description: 'A fully enclosed dog area cleaned top to bottom — solid waste removed, surfaces scrubbed, and a professional deodorizer applied to the entire space.',
    before: {
      src: 'https://i.ibb.co/8gCCdxTL/enclosure-before.jpg',
      alt: 'Dog enclosure before cleanup',
    },
    after: {
      src: 'https://i.ibb.co/R4Zn8q2W/enclosure-after.jpg',
      alt: 'Dog enclosure after cleanup',
    },
  },
  {
    id: 'small-section',
    title: 'Small Section Spot Clean',
    description: 'Even a small problem area can make the whole yard unusable. We cleared the waste, treated the ground, and had this section smelling fresh in under 20 minutes.',
    before: {
      src: 'https://i.ibb.co/vRc7ZTg/small-section-before.jpg',
      alt: 'Small yard section before cleanup',
    },
    after: {
      src: 'https://i.ibb.co/Hp9B0fKK/small-section-after.jpg',
      alt: 'Small yard section after cleanup',
    },
  },
  {
    id: 'walkway',
    title: 'Neglected Walkway Restored',
    description: 'Not everything we clean is dog-related — this walkway had years of grime, moss, and buildup that made it slippery and unsightly. Pressure-washed back to looking brand new.',
    before: {
      src: 'https://i.ibb.co/MyBH26ks/walkway-before.png',
      alt: 'Walkway before cleaning',
    },
    after: {
      src: 'https://i.ibb.co/nsfjR6qp/walkway-after.png',
      alt: 'Walkway after cleaning',
    },
  },
  {
    id: 'turf-treatment',
    title: 'Artificial Turf Treatment',
    description: 'Artificial turf traps odor like a sponge. We pressure-washed the entire surface and applied professional enzyme treatment to neutralize bacteria deep in the infill.',
    before: {
      src: 'https://i.ibb.co/0V8QVdZD/turf1-before.jpg',
      alt: 'Artificial turf before treatment',
    },
    after: {
      src: 'https://i.ibb.co/Z1JTJGLV/turf2-after.jpg',
      alt: 'Artificial turf after treatment',
    },
  },
  {
    id: 'hedge-trimming',
    title: 'Hedge Trimming',
    description: 'Overgrown hedges crowding a fence line brought back into shape in a single visit. Clean cuts, cleared debris, and a yard that looks maintained again.',
    before: {
      src: 'https://i.ibb.co/wZ5XPGS9/gravel-sand-yard-before.png',
      alt: 'Overgrown hedges before trimming',
    },
    after: {
      src: 'https://i.ibb.co/jZx8Mrnn/gravel-sand-yard-after.png',
      alt: 'Hedges after professional trimming',
    },
  },
];

function GalleryCard({ item, index }: { item: GalleryItem; index: number }) {
  const [view, setView] = useState<'before' | 'after'>('before');
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.08 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const current = view === 'before' ? item.before : item.after;

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
      style={{ transitionDelay: `${(index % 3) * 80}ms` }}
    >
      {/* Image */}
      <div
        className="relative overflow-hidden rounded-2xl shadow-card md:max-h-[65vh]"
        style={{ aspectRatio: '9/16' }}
      >
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          loading="lazy"
          className="w-full h-full object-cover transition-opacity duration-300"
        />
      </div>

      {/* Toggle + text */}
      <div className="mt-4">
        {/* iOS-style segmented toggle */}
        <div className="inline-flex bg-sage-light rounded-full p-1 mb-4">
          <button
            onClick={() => setView('before')}
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wide transition-all duration-200 ${
              view === 'before'
                ? 'bg-white text-dark shadow-sm'
                : 'text-dark/50 hover:text-dark/70'
            }`}
          >
            Before
          </button>
          <button
            onClick={() => setView('after')}
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wide transition-all duration-200 ${
              view === 'after'
                ? 'bg-forest text-white shadow-sm'
                : 'text-dark/50 hover:text-dark/70'
            }`}
          >
            After
          </button>
        </div>

        <h3 className="font-serif text-xl text-dark mb-2 leading-snug">{item.title}</h3>
        <p className="text-dark/60 text-sm leading-[1.75]">{item.description}</p>
      </div>
    </div>
  );
}

function LandscapeGalleryCard({ item, index }: { item: GalleryItem; index: number }) {
  const [view, setView] = useState<'before' | 'after'>('before');
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.08 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const current = view === 'before' ? item.before : item.after;

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
      style={{ transitionDelay: `${(index % 3) * 80}ms` }}
    >
      <div
        className="relative overflow-hidden rounded-2xl shadow-card w-full"
        style={{ aspectRatio: '16/9' }}
      >
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          loading="lazy"
          className="w-full h-full object-cover transition-opacity duration-300"
        />
      </div>
      <div className="mt-4">
        <div className="inline-flex bg-sage-light rounded-full p-1 mb-4">
          <button
            onClick={() => setView('before')}
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wide transition-all duration-200 ${
              view === 'before'
                ? 'bg-white text-dark shadow-sm'
                : 'text-dark/50 hover:text-dark/70'
            }`}
          >
            Before
          </button>
          <button
            onClick={() => setView('after')}
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wide transition-all duration-200 ${
              view === 'after'
                ? 'bg-forest text-white shadow-sm'
                : 'text-dark/50 hover:text-dark/70'
            }`}
          >
            After
          </button>
        </div>
        <h3 className="font-serif text-xl text-dark mb-2 leading-snug">{item.title}</h3>
        <p className="text-dark/60 text-sm leading-[1.75]">{item.description}</p>
      </div>
    </div>
  );
}

function GalleryPage() {
  useSEO({
    title: 'Before & After Gallery | Scoop Dogg Ventura County',
    description: 'See real before and after results from Scoop Dogg\'s yard cleanup, turf deodorizing, dog run cleanup, and pressure washing services across Ventura County.',
    canonicalPath: '/gallery',
  });

  return (
    <div className="bg-cream">
      {/* Hero */}
      <section className="relative pt-24 pb-0 md:pt-28">
        <div className="absolute inset-0 h-[360px] md:h-[420px] overflow-hidden">
          <img
            src="https://i.ibb.co/jvBZ46R5/backyard-after.jpg"
            alt="Clean yard after professional pet waste cleanup"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-forest/80 via-forest/70 to-forest/90" />
        </div>

        <div className="relative max-w-site mx-auto px-4 sm:px-6 pb-16 md:pb-20">
          <div className="flex items-center gap-2 text-sage/80 text-sm mb-5">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <span className="text-white/80">Gallery</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl text-white mb-4 max-w-2xl leading-[1.12]">
            Before & After Results
          </h1>
          <p className="text-white/75 text-lg max-w-md leading-[1.75]">
            Real yards. Real results. Tap Before or After to see the difference.
          </p>
        </div>
      </section>

      {/* Grid */}
      <section className="py-14 md:py-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-14">
            {GALLERY_ITEMS.slice(0, -1).map((item, i) => (
              <GalleryCard key={item.id} item={item} index={i} />
            ))}
          </div>
          <div className="mt-14">
            <LandscapeGalleryCard item={GALLERY_ITEMS[GALLERY_ITEMS.length - 1]} index={GALLERY_ITEMS.length - 1} />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-forest py-16 md:py-20">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl sm:text-4xl text-white mb-4">
            Your yard could be next
          </h2>
          <p className="text-sage mb-8 max-w-md mx-auto leading-relaxed">
            Book in 60 seconds. No contracts. We confirm same day.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/book"
              className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-[0_6px_24px_rgba(244,160,36,0.45)]"
            >
              Book a Cleanup <ArrowRight size={16} />
            </Link>
            <a
              href="tel:8058698070"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white hover:border-white hover:bg-white/10 font-semibold px-8 py-4 rounded-full transition-all"
            >
              (805) 869-8070
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

export default GalleryPage