import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';

export default function Hero() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative overflow-hidden" style={{ minHeight: '92vh' }}>
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover object-center"
      >
        <source src="https://videos.pexels.com/video-files/854383/854383-hd_1280_720_30fps.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-gradient-to-b from-dark/60 via-dark/50 to-dark/70" />
      <div className="absolute inset-0 bg-gradient-to-r from-dark/30 via-transparent to-dark/20" />

      <div className="relative flex flex-col justify-center min-h-[92vh] pt-36 pb-16">
        <div className="max-w-site mx-auto px-4 sm:px-6 w-full text-center">
          <h1
            className={`font-serif text-5xl sm:text-6xl lg:text-7xl text-white leading-[1.06] mb-6 transition-all duration-700 delay-100 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
            }`}
            style={{ textShadow: '0 2px 20px rgba(0,0,0,0.4)' }}
          >
            Dog Poop Cleaning Services in{' '}
            <em className="not-italic" style={{ color: '#F4A024' }}>Ventura County</em>
          </h1>

          <p
            className={`text-lg md:text-xl text-white/85 mb-10 max-w-2xl mx-auto leading-[1.75] transition-all duration-700 delay-200 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
            }`}
            style={{ textShadow: '0 1px 8px rgba(0,0,0,0.5)' }}
          >
            Weekly and one-time dog poop cleaning services across Ventura County —
            Ventura, Oxnard, Thousand Oaks, Camarillo, Simi Valley, Ojai, Santa Paula,
            and Westlake Village. Yards scooped, bagged, and hauled off. Turf deodorizing
            available. Starting at $15/visit.
          </p>

          <div
            className={`flex flex-col sm:flex-row gap-3 justify-center mb-10 transition-all duration-700 delay-300 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
            }`}
          >
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold px-10 py-4 rounded-full transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_6px_24px_rgba(244,160,36,0.45)] text-base"
            >
              Book in 60 Seconds →
            </a>
            <a
              href="tel:8058698070"
              className="inline-flex items-center justify-center gap-2 bg-white/15 backdrop-blur-sm border border-white/30 text-white hover:bg-white/25 font-semibold px-10 py-4 rounded-full transition-all duration-200 text-base"
            >
              <Phone size={16} />
              (805) 869-8070
            </a>
          </div>

          <div
            className={`transition-all duration-700 delay-400 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
            }`}
          >
            <p className="text-white/40 text-sm tracking-wide">
              Weekly service from{' '}
              <span className="font-semibold text-white/70">$15/week</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
