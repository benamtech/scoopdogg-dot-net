import BookingWidget from '../BookingWidget';

export default function BookingSection() {
  return (
    <div id="booking" className="relative">
      <div style={{ background: '#FAF8F5' }}>
        <svg
          viewBox="0 0 1440 60"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block', width: '100%', height: '60px' }}
        >
          <path d="M0,0 C480,60 960,60 1440,0 L1440,60 L0,60 Z" fill="#1B4332" />
        </svg>
      </div>

      <section
        className="relative py-20 md:py-28"
        style={{
          background: 'radial-gradient(ellipse at 50% -10%, #234d3c 0%, #1B4332 50%, #143728 100%)',
        }}
      >
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="font-serif text-4xl sm:text-[2.6rem] text-white mb-4">
              Book Your Service
            </h2>
            <p className="text-sage text-lg max-w-md mx-auto leading-relaxed">
              Takes less than 60 seconds. No credit card required. We'll reach out same day.
            </p>
          </div>
          <div
            className="rounded-[20px] p-6 md:p-10"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.16)',
            }}
          >
            <BookingWidget sourcePage="/" />
          </div>
        </div>
      </section>
    </div>
  );
}
