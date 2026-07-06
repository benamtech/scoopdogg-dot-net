import { useEffect, useRef, useState } from 'react';

const steps = [
  {
    num: '01',
    title: 'Pick Your Service',
    desc: "Weekly scooping, turf deodorizing, or a one-time deep clean. No commitment to start.",
  },
  {
    num: '02',
    title: 'We Show Up',
    desc: "Background-checked team, on schedule, every time. You don't need to be home.",
  },
  {
    num: '03',
    title: 'Enjoy Your Yard',
    desc: 'Bare feet welcome. Go ahead — let the dogs out.',
  },
];

export default function HowItWorks() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.2 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-white py-24 md:py-32" ref={ref}>
      <div className="max-w-site mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center mb-16">
          <div className="rounded-2xl overflow-hidden shadow-card aspect-[4/3] hidden lg:block">
            <img
              src="/artificial-grass-installed-sunnyvale.jpg"
              alt="Dog relaxing on freshly installed artificial grass"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="text-center lg:text-left">
            <h2 className="font-serif text-4xl sm:text-[2.6rem] text-dark mb-4">
              Here's How It Works
            </h2>
            <p className="text-dark/55 text-lg max-w-md leading-relaxed mx-auto lg:mx-0">
              Getting started takes less than a minute. We handle everything else.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
          <div className="hidden md:block absolute top-[5.75rem] left-[calc(16.67%+2.5rem)] right-[calc(16.67%+2.5rem)] h-px bg-gradient-to-r from-sage-light via-sage/40 to-sage-light" />

          {steps.map((step, i) => (
            <div
              key={step.num}
              className={`relative flex flex-col items-center text-center px-8 py-10 rounded-card transition-all duration-700 hover:bg-sage-light/50 ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{ transitionDelay: `${i * 150}ms` }}
            >
              <div className="relative mb-7">
                <span className="font-serif text-[5.5rem] font-bold text-sage/20 leading-none select-none block">
                  {step.num}
                </span>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-[3.25rem] h-[3.25rem] rounded-full bg-white border-2 border-sage shadow-[0_2px_10px_rgba(0,0,0,0.07)] flex items-center justify-center">
                    <span className="font-bold text-forest text-base">{i + 1}</span>
                  </div>
                </div>
              </div>
              <h3 className="font-serif text-2xl text-dark mb-3">{step.title}</h3>
              <p className="text-dark/55 leading-relaxed text-[1.05rem]">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
