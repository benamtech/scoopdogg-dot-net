import { useState, useEffect, useRef } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Clock, Calendar, ArrowUp } from 'lucide-react';
import { ARTICLE_MAP } from '../lib/articles';
import { useSEO } from '../lib/useSEO';
import { SITE_URL } from '../lib/constants';
import type { ArticleSection } from '../lib/articles';

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-sage-light last:border-0">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between py-4 text-left font-medium text-dark hover:text-forest transition-colors"
      >
        {q}
        <ChevronDown
          size={18}
          className={`flex-shrink-0 ml-4 transition-transform ${open ? 'rotate-180 text-forest' : 'text-dark/40'}`}
        />
      </button>
      {open && <p className="text-dark/60 pb-4 leading-relaxed text-sm">{a}</p>}
    </div>
  );
}

function TableOfContents({ sections, activeId }: { sections: ArticleSection[]; activeId: string }) {
  return (
    <nav className="space-y-1">
      <p className="text-xs font-bold tracking-[0.1em] uppercase text-dark/40 mb-3">In This Article</p>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={`block py-1.5 text-sm transition-colors border-l-2 pl-3 ${
            activeId === section.id
              ? 'border-forest text-forest font-medium'
              : 'border-transparent text-dark/50 hover:text-dark hover:border-sage'
          }`}
        >
          {section.heading}
        </a>
      ))}
    </nav>
  );
}

function SectionRenderer({ section }: { section: ArticleSection }) {
  const ref = useRef<HTMLElement>(null);
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
    <section
      ref={ref}
      id={section.id}
      className={`scroll-mt-28 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
    >
      <h2 className="font-serif text-2xl sm:text-3xl text-dark mb-5 leading-snug">
        {section.heading}
      </h2>

      {section.paragraphs.map((p, i) => (
        <p key={i} className="text-dark/70 leading-[1.8] mb-5">
          {p}
        </p>
      ))}

      {section.table && (
        <div className="my-6 overflow-x-auto rounded-xl border border-sage-light">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="bg-forest text-white">
                <th className="text-left py-3 px-4 font-semibold">Question</th>
                <th className="text-left py-3 px-4 font-semibold">Answer</th>
              </tr>
            </thead>
            <tbody>
              {section.table.map((row, i) => (
                <tr key={i} className={`border-t border-sage-light ${i % 2 === 0 ? 'bg-white' : 'bg-sage-light/40'}`}>
                  <td className="py-3 px-4 font-medium text-dark align-top">{row.question}</td>
                  <td className="py-3 px-4 text-dark/70 leading-relaxed">{row.answer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section.callout && (
        <div className="bg-sage-light border-l-4 border-amber rounded-r-xl p-5 my-6">
          <p className="text-dark/80 text-[0.95rem] leading-relaxed italic">
            {section.callout.text}
          </p>
          {section.callout.source && (
            <p className="text-dark/40 text-xs font-medium mt-2 uppercase tracking-wide">
              — {section.callout.source}
            </p>
          )}
        </div>
      )}

      {section.numberedSteps && (
        <ol className="space-y-3 my-6">
          {section.numberedSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="w-7 h-7 rounded-full bg-forest text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-dark/70 leading-relaxed text-[0.95rem] pt-1">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {section.bullets && (
        <ul className="space-y-2.5 my-6">
          {section.bullets.map((bullet, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-2 h-2 rounded-full bg-forest mt-2 flex-shrink-0" />
              <span className="text-dark/70 leading-relaxed text-[0.95rem]">{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {section.subsections && (
        <div className="space-y-6 my-6">
          {section.subsections.map((sub) => (
            <div key={sub.heading} className="bg-white rounded-xl border border-sage-light p-5">
              <h3 className="font-semibold text-dark mb-2 text-[0.95rem]">{sub.heading}</h3>
              {sub.paragraphs.map((p, i) => (
                <p key={i} className="text-dark/60 text-sm leading-relaxed">{p}</p>
              ))}
            </div>
          ))}
        </div>
      )}

      {section.image && (
        <div className="my-8 rounded-2xl overflow-hidden shadow-card">
          <img
            src={section.image.src}
            alt={section.image.alt}
            loading="lazy"
            className="w-full h-auto aspect-[16/9] object-cover"
          />
        </div>
      )}

      {section.internalLinks && section.internalLinks.length > 0 && (
        <div className="flex flex-wrap gap-2 my-6">
          {section.internalLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="inline-flex items-center gap-1.5 bg-white border border-sage-light px-4 py-2 rounded-full text-sm font-medium text-forest hover:bg-forest hover:text-white transition-all"
            >
              {link.label}
              <ArrowRight size={12} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? ARTICLE_MAP[slug] : null;
  const [activeSection, setActiveSection] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    if (!article) return;

    const observers: IntersectionObserver[] = [];
    article.sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(section.id);
        },
        { rootMargin: '-20% 0px -60% 0px' }
      );
      observer.observe(el);
      observers.push(observer);
    });

    const scrollHandler = () => setShowBackToTop(window.scrollY > 600);
    window.addEventListener('scroll', scrollHandler, { passive: true });

    return () => {
      observers.forEach((o) => o.disconnect());
      window.removeEventListener('scroll', scrollHandler);
    };
  }, [article]);

  const faqSchema = article ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: article.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  } : undefined;

  const breadcrumbSchema = article ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Resources', item: `${SITE_URL}/resources` },
      { '@type': 'ListItem', position: 3, name: article.title, item: `${SITE_URL}/resources/${slug}` },
    ],
  } : undefined;

  const articleBody = article
    ? [article.openingAnswer, ...article.sections.flatMap((s) => s.paragraphs)].join(' ')
    : '';

  const articleSchema = article ? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.metaDescription,
    image: `${SITE_URL}${article.heroImage}`,
    keywords: article.tags.join(', '),
    datePublished: article.publishedDate,
    dateModified: article.updatedDate,
    author: { '@type': 'Organization', name: 'Scoop Dogg', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'Scoop Dogg', url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}/resources/${slug}`,
    articleBody,
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['[data-speakable]'],
    },
  } : undefined;

  useSEO({
    title: article?.metaTitle || 'Scoop Dogg',
    description: article?.metaDescription || '',
    canonicalPath: `/resources/${slug || ''}`,
    jsonLd: faqSchema && breadcrumbSchema && articleSchema
      ? [articleSchema, faqSchema, breadcrumbSchema]
      : undefined,
  });

  if (!article) return <Navigate to="/resources" replace />;

  return (
    <div className="bg-cream">
      {/* Hero */}
      <section className="relative pt-24 pb-0 md:pt-28">
        <div className="absolute inset-0 h-[420px] md:h-[480px] overflow-hidden">
          <img
            src={article.heroImage}
            alt={article.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-forest/80 via-forest/70 to-forest/90" />
        </div>

        <div className="relative max-w-site mx-auto px-4 sm:px-6 pb-16 md:pb-20">
          <div className="flex items-center gap-2 text-sage/80 text-sm mb-5">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link to="/resources" className="hover:text-white transition-colors">Resources</Link>
            <span>/</span>
            <span className="text-white/80 truncate max-w-[200px]">{article.title}</span>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl text-white mb-6 max-w-3xl leading-[1.12]">
            {article.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-sage">
              <Clock size={14} />
              {article.readTime}
            </span>
            <span className="flex items-center gap-1.5 text-sage">
              <Calendar size={14} />
              Updated {new Date(article.updatedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>
      </section>

      {/* Article Body */}
      <section className="py-12 md:py-16">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-12 lg:gap-16">
            {/* Main Content */}
            <div className="min-w-0">
              <p
                data-speakable
                className="text-dark/80 text-lg leading-relaxed pt-4 mb-12 pb-12 border-b border-sage-light"
              >
                {article.openingAnswer}
              </p>

              <div className="space-y-12">
                {article.sections.map((section) => (
                  <SectionRenderer key={section.id} section={section} />
                ))}
              </div>

              {/* FAQ */}
              <div className="mt-16 pt-12 border-t border-sage-light">
                <h2 className="font-serif text-2xl sm:text-3xl text-dark mb-6">
                  Frequently Asked Questions
                </h2>
                <div className="bg-white rounded-2xl p-6 border border-sage-light">
                  {article.faqs.map((faq) => (
                    <FAQItem key={faq.q} q={faq.q} a={faq.a} />
                  ))}
                </div>
              </div>

              {/* Sources */}
              {article.sources && article.sources.length > 0 && (
                <div className="mt-12 pt-8 border-t border-sage-light">
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-dark/40 mb-4">Sources</p>
                  <ol className="space-y-2">
                    {article.sources.map((source) => (
                      <li key={source.id} className="flex items-start gap-2 text-sm">
                        <span className="text-dark/30 font-mono text-xs mt-0.5">[{source.id}]</span>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-forest hover:underline"
                        >
                          {source.label}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Bottom CTA */}
              <div className="mt-12 bg-forest rounded-2xl p-8 md:p-10">
                <h3 className="font-serif text-2xl text-white mb-3">
                  Ready for a cleaner yard?
                </h3>
                <p className="text-sage mb-6 leading-relaxed">
                  Book in 60 seconds. No contracts, no commitment. We confirm same day.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    to="/book"
                    className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-7 py-3.5 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg"
                  >
                    Book Service <ArrowRight size={16} />
                  </Link>
                  <a
                    href="tel:8058698070"
                    className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white hover:border-white hover:bg-white/10 font-semibold px-7 py-3.5 rounded-full transition-all"
                  >
                    (805) 869-8070
                  </a>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="hidden lg:block">
              <div className="sticky top-28 space-y-8">
                {/* Table of Contents */}
                <div className="bg-white rounded-2xl border border-sage-light p-5">
                  <TableOfContents sections={article.sections} activeId={activeSection} />
                </div>

                {/* Book CTA */}
                <div className="bg-forest rounded-2xl p-5 text-center">
                  <p className="font-serif text-lg text-white mb-2">Clean yard starts here</p>
                  <p className="text-sage text-xs mb-4">From $15/week. Cancel anytime.</p>
                  <Link
                    to="/book"
                    className="block bg-amber hover:bg-amber-hover text-white font-semibold py-3 px-5 rounded-full transition-all text-sm hover:scale-[1.02]"
                  >
                    Book in 60 Seconds
                  </Link>
                </div>

                {/* Tags */}
                <div className="bg-white rounded-2xl border border-sage-light p-5">
                  <p className="text-xs font-bold tracking-[0.1em] uppercase text-dark/40 mb-3">Topics</p>
                  <div className="flex flex-wrap gap-2">
                    {article.tags.map((tag) => (
                      <span
                        key={tag}
                        className="bg-sage-light text-dark/60 text-xs px-3 py-1.5 rounded-full font-medium"
                      >
                        {tag.replace(/-/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Back to Resources */}
      <section className="bg-white py-10 border-t border-sage-light">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <Link
            to="/resources"
            className="inline-flex items-center gap-2 text-forest font-medium hover:gap-3 transition-all text-sm"
          >
            <ArrowRight size={14} className="rotate-180" />
            Back to Knowledge Base
          </Link>
        </div>
      </section>

      {/* Back to top button */}
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-forest text-white shadow-card-hover flex items-center justify-center hover:bg-forest-dark transition-colors"
          aria-label="Back to top"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}
