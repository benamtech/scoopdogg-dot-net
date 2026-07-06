import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'How much does dog poop cleaning cost in Ventura County?',
    a: 'Weekly dog poop cleaning starts at $15/visit for one dog. Two dogs are $20/week, three dogs are $23/week, and four or more is $25/week. One-time cleanups and turf deodorizing start at $20. No hidden fees, no setup costs.',
  },
  {
    q: 'How often should I get my yard scooped?',
    a: 'Weekly service is the most popular option — and the most effective. Dog waste left longer than a week starts to attract flies and bacteria, and the smell becomes harder to eliminate. If you have multiple dogs or a smaller yard, weekly is especially important. One-time cleanups are available for yards that need a fresh start.',
  },
  {
    q: 'Do you clean up after multiple dogs?',
    a: 'Yes. We service yards with one dog or a whole pack. Pricing scales by dog count: $15/week for one dog, $20 for two, $23 for three, and $25 for four or more. Just let us know how many dogs you have when you book.',
  },
  {
    q: 'What if my yard hasn\'t been cleaned in months?',
    a: 'No problem — that\'s exactly what our one-time deep clean is for. We\'ll do a full reset on your yard regardless of how long it\'s been neglected. After that, many customers switch to a weekly plan to keep it that way.',
  },
  {
    q: 'Do you offer one-time dog poop cleanup services?',
    a: 'Yes. One-time yard cleanups are available with no commitment required. Book a single visit online in 60 seconds and we\'ll come out, scoop everything, bag it, and haul it off. Great for moves, parties, or just a long-overdue reset.',
  },
  {
    q: 'Do you sanitize or deodorize the yard?',
    a: 'Yes — we offer a Turf Rescue enzyme treatment that eliminates odor at the source on artificial turf, gravel, concrete, and grass. It\'s 100% natural and pet-safe immediately after application. If your yard has a persistent smell even after scooping, this is the fix.',
  },
  {
    q: 'Do I need to be home when you come?',
    a: "Never. Most of our customers are at work when we stop by. As long as we have gate access, we take care of everything and secure the gate behind us. You'll get a text confirmation once we're finished.",
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border-b border-sage-light last:border-0"
      itemScope
      itemProp="mainEntity"
      itemType="https://schema.org/Question"
    >
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between py-5 text-left font-semibold text-dark hover:text-forest transition-colors gap-4"
        aria-expanded={open}
      >
        <span itemProp="name" className="text-base leading-snug">{q}</span>
        <ChevronDown
          size={18}
          className={`flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-forest' : 'text-dark/30'}`}
        />
      </button>
      <div
        itemScope
        itemProp="acceptedAnswer"
        itemType="https://schema.org/Answer"
        className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 pb-5' : 'max-h-0'}`}
      >
        <p itemProp="text" className="text-dark/65 leading-relaxed text-[0.95rem]">{a}</p>
      </div>
    </div>
  );
}

export default function HomeFAQ() {
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
    <section
      className="bg-cream py-24 md:py-32"
      ref={ref}
      itemScope
      itemType="https://schema.org/FAQPage"
    >
      <div className="max-w-site mx-auto px-4 sm:px-6">
        <div
          className={`max-w-3xl mx-auto transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
        >
          <div className="text-center mb-12">
            <span className="inline-block text-xs font-bold tracking-[0.12em] text-forest uppercase mb-5 bg-white border border-sage/60 px-5 py-2 rounded-full shadow-sm">
              Common Questions
            </span>
            <h2 className="font-serif text-4xl sm:text-[2.6rem] text-dark mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-dark/55 text-lg max-w-md mx-auto leading-relaxed">
              Everything you need to know before getting started.
            </p>
          </div>

          <div className="bg-white rounded-card shadow-card px-6 md:px-10 py-2">
            {faqs.map((faq, i) => (
              <FAQItem key={faq.q} q={faq.q} a={faq.a} index={i} />
            ))}
          </div>

          <p className="text-center text-dark/40 text-sm mt-8">
            Still have a question?{' '}
            <a href="tel:8058698070" className="text-forest font-semibold hover:text-amber transition-colors">
              Call us at (805) 869-8070
            </a>
            {' '}— we answer.
          </p>
        </div>
      </div>
    </section>
  );
}
