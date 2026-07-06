import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, UserCheck, MapPin, Star, CalendarCheck } from 'lucide-react';

const badges = [
  { icon: ShieldCheck, label: 'Fully Insured' },
  { icon: UserCheck, label: 'Background-Checked' },
  { icon: MapPin, label: 'Locally Owned' },
  { icon: Star, label: '5-Star Rated' },
  { icon: CalendarCheck, label: 'Cancel Anytime' },
];

export default function AboutTrust() {
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
    <section className="bg-white py-24 md:py-32" ref={ref}>
      <div className="max-w-site mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <div
            className={`transition-all duration-700 ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`}
          >
            <div className="relative">
              <div className="bg-sage-light rounded-card max-w-md mx-auto lg:mx-0 overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.1)]">
                <img
                  src="https://i.ibb.co/WvDqz4S0/4824.png"
                  alt="Josue, owner of Scoop Dogg"
                  loading="lazy"
                  decoding="async"
                  className="w-full h-auto block"
                />
              </div>
              <div className="absolute -bottom-3 -right-3 bg-forest text-white rounded-2xl shadow-lg px-5 py-3.5 hidden lg:block">
                <p className="font-serif text-2xl leading-none">5.0</p>
                <div className="flex gap-0.5 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} width="10" height="10" viewBox="0 0 10 10" fill="#F4A024">
                      <path d="M5 0l1.18 3.09H9.5L6.91 5l.9 3.09L5 6.18l-2.81 1.91L3.09 5 .5 3.09h3.32z" />
                    </svg>
                  ))}
                </div>
                <p className="text-sage text-xs mt-1">Average Rating</p>
              </div>
            </div>
          </div>

          <div
            className={`transition-all duration-700 delay-150 ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
          >
            <span className="inline-block text-xs font-bold tracking-[0.12em] text-forest uppercase mb-6 bg-sage-light border border-sage/50 px-5 py-2 rounded-full">
              Meet the Owner
            </span>
            <h2 className="font-serif text-4xl sm:text-[2.6rem] text-dark mb-6 leading-[1.1]">
              Meet Josue
            </h2>

            <blockquote className="border-l-4 border-amber pl-5 mb-6">
              <p className="text-dark/70 text-[1.05rem] leading-[1.8] italic font-serif">
                "I'm out scooping alongside my team every week."
              </p>
            </blockquote>

            <p className="text-dark/65 leading-[1.8] text-[1.02rem] mb-5">
              I'm Josue. I started Scoop Dogg because I got tired of seeing dog owners stressed
              about something that should be simple. You love your dog. You shouldn't have to
              dread your own backyard.
            </p>
            <p className="text-dark/65 leading-[1.8] text-[1.02rem] mb-5">
              I know my clients' dogs by name, I know which gates stick, and I know which yards
              have the sneaky spots. This isn't a side hustle — it's my business, and I take it
              personally.
            </p>
            <p className="text-dark font-semibold text-[1.02rem] mb-8">
              Every visit, every yard, done right.
            </p>

            <div className="flex flex-wrap gap-2.5">
              {badges.map((badge) => {
                const Icon = badge.icon;
                return (
                  <div
                    key={badge.label}
                    className="flex items-center gap-1.5 bg-cream border border-dark/8 px-3.5 py-2 rounded-full text-xs font-semibold text-dark/60 tracking-wide"
                  >
                    <Icon size={13} className="text-forest" />
                    {badge.label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
