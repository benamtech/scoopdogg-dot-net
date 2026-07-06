import { Link } from 'react-router-dom';
import { ArrowRight, Clock, BookOpen } from 'lucide-react';
import { ARTICLES } from '../lib/articles';
import { useSEO } from '../lib/useSEO';

export default function ResourcesPage() {
  useSEO({
    title: 'Ventura County Dog Waste Knowledge Base | Scoop Dogg',
    description: 'Local guides on dog waste management in Ventura County: cleanup challenges, disposal rules, turf maintenance, stormwater concerns, and practical solutions for every yard type.',
    canonicalPath: '/resources',
  });

  return (
    <div className="bg-cream">
      <section className="bg-forest pt-28 pb-20 md:pt-36 md:pb-28">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sage text-sm mb-5">
              <BookOpen size={15} />
              <span className="font-medium tracking-wide uppercase text-xs">Knowledge Base</span>
            </div>
            <h1 className="font-serif text-4xl sm:text-5xl text-white mb-5 leading-[1.1]">
              Ventura County Dog Waste Knowledge Base
            </h1>
            <p className="text-sage text-lg leading-relaxed">
              Local conditions, official sources, and practical solutions — written for Ventura County dog owners who want real answers, not generic advice.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {ARTICLES.map((article) => (
              <Link
                key={article.slug}
                to={`/resources/${article.slug}`}
                className="group bg-white rounded-2xl border border-sage-light overflow-hidden hover:shadow-card-hover hover:-translate-y-1 transition-all duration-300"
              >
                <div className="aspect-[16/10] overflow-hidden">
                  <img
                    src={article.heroImage}
                    alt={article.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 text-xs text-dark/40 mb-3">
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {article.readTime}
                    </span>
                    <span>{new Date(article.publishedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                  <h2 className="font-serif text-xl text-dark mb-3 leading-snug group-hover:text-forest transition-colors">
                    {article.title}
                  </h2>
                  <p className="text-dark/60 text-sm leading-relaxed mb-4 line-clamp-3">
                    {article.excerpt}
                  </p>
                  <span className="inline-flex items-center gap-2 text-forest font-semibold text-sm group-hover:gap-3 transition-all">
                    Read Article <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {ARTICLES.length === 1 && (
            <div className="mt-16 text-center">
              <div className="inline-block bg-sage-light rounded-2xl px-8 py-6 border border-sage/30">
                <p className="text-dark/50 text-sm">
                  More articles covering turf maintenance, seasonal yard care, and city-specific guides coming soon.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="py-16 bg-forest">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-3xl text-white mb-4">Have a question we haven't covered?</h2>
          <p className="text-sage mb-8 max-w-md mx-auto">
            Call us directly — we know Ventura County yards inside and out.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/book"
              className="inline-flex items-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg"
            >
              Book Service <ArrowRight size={16} />
            </Link>
            <a
              href="tel:8058698070"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/40 text-white hover:border-white hover:bg-white/10 font-semibold px-8 py-4 rounded-full transition-all"
            >
              (805) 869-8070
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
