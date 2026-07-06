import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, Sparkles, Leaf, Droplets, Cat, Fence, Wind, Waves, Brush, Scissors } from 'lucide-react';
import { SERVICES } from '../lib/services';
import { useSEO } from '../lib/useSEO';
import type { ComponentType } from 'react';

const ICON_MAP: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  'weekly-pooper-scooper-service': RefreshCw,
  'one-time-dog-poop-cleanup': Sparkles,
  'artificial-turf-deodorizing': Droplets,
  'yard-deep-clean': Leaf,
  'weekly-turf-maintenance': Brush,
  'weekly-yard-maintenance': Scissors,
  'kitty-litter-exchange': Cat,
  'dog-run-cleanups': Fence,
  'cat-tree-cleaning': Wind,
  'pressure-washing': Waves,
  'kitty-litter-robot-cleaning': Sparkles,
};

const MASCOT_MAP: Record<string, { src: string; alt: string }> = {
  'weekly-yard-maintenance': { src: 'https://i.ibb.co/prvTXTXd/transp-dog-character-mowing-grass.png', alt: 'Dog character mowing grass' },
  'kitty-litter-exchange': { src: 'https://i.ibb.co/B5YqDzzq/transp-cat-character-cleaning-litter-box.png', alt: 'Cat character cleaning litter box' },
  'cat-tree-cleaning': { src: 'https://i.ibb.co/C5W7dZ5x/transp-cat-character-cleaning-cat-tree.png', alt: 'Cat character cleaning cat tree' },
  'pressure-washing': { src: 'https://i.ibb.co/TBkDkRfC/transp-dog-character-pressure-washing-driveway.png', alt: 'Dog character pressure washing driveway' },
  'kitty-litter-robot-cleaning': { src: 'https://i.ibb.co/h3QqsW8/5878.png', alt: 'Litter-Robot automatic litter box' },
};

export default function ServicesPage() {
  useSEO({
    title: 'Services | Scoop Dogg Ventura County',
    description: 'All services from Scoop Dogg: weekly poop scooping, turf maintenance, landscaping, pressure washing, and pet cleanup. Serving Ventura County. Starting at $15.',
    canonicalPath: '/services',
  });

  return (
    <div className="bg-cream">
      <section className="bg-forest pt-28 pb-16 md:pt-36 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-4">
            Our Services
          </h1>
          <p className="text-sage text-lg max-w-xl mx-auto leading-relaxed">
            Pet waste, turf care, landscaping, pressure washing, and more — everything your property needs to stay clean, handled by one reliable team.
          </p>
        </div>
      </section>

      <section className="relative -mt-10 mb-0">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="rounded-2xl overflow-hidden shadow-card h-56 md:h-72">
            <img
              src="/artificial-grass-installed-sunnyvale.jpg"
              alt="Dog relaxing in a beautifully maintained yard"
              className="w-full h-full object-cover object-center"
            />
          </div>
        </div>
      </section>

      <section className="pb-20 pt-24 md:pt-28">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 gap-y-28">
            {SERVICES.map((service) => {
              const Icon = ICON_MAP[service.slug] || Leaf;
              const mascot = MASCOT_MAP[service.slug];
              return (
                <Link
                  key={service.slug}
                  to={`/services/${service.slug}`}
                  className="group relative bg-white rounded-2xl border border-sage-light p-7 hover:shadow-card hover:-translate-y-1 transition-all flex flex-col overflow-visible"
                >
                  {mascot && (
                    <img
                      src={mascot.src}
                      alt={mascot.alt}
                      loading="lazy"
                      className="hidden md:block absolute -top-16 -right-6 w-28 h-28 object-contain drop-shadow-md pointer-events-none select-none"
                    />
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-sage-light flex items-center justify-center flex-shrink-0 group-hover:bg-forest/10 transition-colors">
                      <Icon size={20} className="text-forest" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-serif text-xl text-dark group-hover:text-forest transition-colors leading-snug">
                        {service.name}
                      </h2>
                      <p className="text-dark/40 text-xs">{service.pricing[0].price}</p>
                    </div>
                  </div>
                  <p className="text-dark/60 text-sm leading-relaxed mb-5 line-clamp-3 flex-1">
                    {service.intro}
                  </p>
                  <span className="inline-flex items-center gap-2 text-forest font-semibold text-sm group-hover:gap-3 transition-all">
                    Learn More <ArrowRight size={14} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 bg-forest">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl text-white mb-4">Ready to get started?</h2>
          <p className="text-sage mb-8 max-w-md mx-auto">
            Book in 60 seconds. No commitment. We confirm same day.
          </p>
          <Link
            to="/book"
            className="inline-flex items-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            Book Your Service <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}
