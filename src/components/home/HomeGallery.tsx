import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

interface GalleryItem {
  id: string;
  title: string;
  description: string;
  before: { src: string; alt: string };
  after: { src: string; alt: string };
}

const FEATURED: GalleryItem[] = [
  {
    id: 'backyard',
    title: 'Full Backyard Cleanup',
    description: 'A heavily used backyard brought back to a clean, usable state. Waste removed, surfaces treated, and ready for weekly maintenance.',
    before: { src: 'https://i.ibb.co/cXNyTLZV/backyard-before.jpg', alt: 'Backyard before cleanup' },
    after: { src: 'https://i.ibb.co/jvBZ46R5/backyard-after.jpg', alt: 'Backyard after cleanup' },
  },
  {
    id: 'paved-dog-run',
    title: 'Paved Dog Run Restored',
    description: 'Years of buildup on a paved dog run require more than a hose. Pressure-washed, scrubbed, and sanitized so odors don\'t come back.',
    before: { src: 'https://i.ibb.co/tTjkfNpD/paved-dog-run-before.jpg', alt: 'Paved dog run before cleanup' },
    after: { src: 'https://i.ibb.co/B2wTdf9p/paved-dog-run-after.jpg', alt: 'Paved dog run after cleanup' },
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
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="relative overflow-hidden rounded-2xl shadow-card md:max-h-[65vh]" style={{ aspectRatio: '9/16' }}>
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
              view === 'before' ? 'bg-white text-dark shadow-sm' : 'text-dark/50 hover:text-dark/70'
            }`}
          >
            Before
          </button>
          <button
            onClick={() => setView('after')}
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wide transition-all duration-200 ${
              view === 'after' ? 'bg-forest text-white shadow-sm' : 'text-dark/50 hover:text-dark/70'
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

export default function HomeGallery() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-cream py-24 md:py-32" ref={ref}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`text-center mb-14 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <span className="inline-block text-forest text-xs font-bold tracking-[0.2em] uppercase mb-4">Before & After</span>
          <h2 className="font-serif text-3xl md:text-4xl text-dark mb-4">Real Results, Real Yards</h2>
          <p className="text-dark/60 text-base max-w-xl mx-auto leading-relaxed">
            We let the work speak for itself. Every job gets the same attention to detail whether it's a quick scoop or a full deep clean.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-14">
          {FEATURED.map((item, i) => (
            <GalleryCard key={item.id} item={item} index={i} />
          ))}
        </div>

        <div className={`text-center mt-14 transition-all duration-700 delay-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <Link
            to="/gallery"
            className="inline-flex items-center gap-2 bg-forest text-white px-8 py-3.5 rounded-full font-semibold text-sm tracking-wide hover:bg-forest/90 transition-colors"
          >
            View Full Gallery
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
