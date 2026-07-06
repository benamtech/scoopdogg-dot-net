import { Link } from 'react-router-dom';
import { Phone, Mail, CheckCircle, ExternalLink } from 'lucide-react';
import { useSEO } from '../lib/useSEO';

const stats = [
  { number: '400+', label: 'Yards cleaned' },
  { number: '3+', label: 'Years in business' },
  { number: '12', label: 'Cities served' },
  { number: '0', label: 'Yards we wouldn\'t eat lunch in' },
];

const visitSteps = [
  { step: '01', title: 'We arrive on time', desc: 'You get a heads-up when we\'re on the way. No guessing, no waiting.' },
  { step: '02', title: 'Gate check', desc: 'We confirm the gate is secure before we open it, and again when we close it. Every single time.' },
  { step: '03', title: 'Full property walk', desc: 'We don\'t do a quick sweep and leave. We walk every corner, including the sneaky spots behind the AC unit and under the deck.' },
  { step: '04', title: 'Everything bagged and removed', desc: 'We haul it out. It\'s not left on your property. Not in your trash. It leaves with us.' },
  { step: '05', title: 'Done — you get a text', desc: 'Gate\'s secured. Yard\'s clean. You\'ll get a quick message confirming we\'re finished so you never have to wonder.' },
];

export default function AboutPage() {
  useSEO({
    title: 'About Scoop Dogg | Pet Waste Removal Ventura County',
    description: 'Meet Josue, owner of Scoop Dogg. A locally owned, background-checked pet waste removal service serving Ventura County with 5-star reviews.',
    canonicalPath: '/about',
  });

  return (
    <div className="bg-cream">

      <section className="bg-forest py-24 md:py-32">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-6">
            Locally Owned Pet Waste Removal in Ventura County
          </h1>
          <p className="text-sage text-lg max-w-xl mx-auto leading-relaxed">
            Not a franchise. Not a call center. Just Josue — your neighbor in Ventura County, showing up every week.
          </p>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            <div className="relative">
              <div className="rounded-card overflow-hidden shadow-card">
                <img
                  src="https://i.ibb.co/WvDqz4S0/4824.png"
                  alt="Josue, owner of Scoop Dogg"
                  className="w-full h-auto block"
                />
              </div>
            </div>

            <div>
              <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-6">Meet Josue</h2>
              <p className="text-dark/70 leading-relaxed mb-5">
                I grew up in Ventura County. Before Scoop Dogg, I worked landscaping — I was already in people's yards, already knew the neighborhoods, already had the work ethic. One day I noticed how many homeowners with dogs were just living with the problem. No good options, no reliable service, lots of no-shows. So I started doing something about it.
              </p>
              <p className="text-dark/70 leading-relaxed mb-5">
                I know my clients' dogs by name. I know which gates stick. I know which yards have the sneaky spots behind the AC unit that everyone misses. I've been doing this long enough that I've become a regular part of people's weeks — and that's exactly how I like it.
              </p>
              <p className="text-dark/70 leading-relaxed mb-8">
                This isn't a side hustle. It's my business, my name on it, and my reputation in the community I grew up in. That means you'll always get me — not a random employee, not a subcontractor, not a different face every time.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/book"
                  className="inline-flex items-center justify-center bg-amber hover:bg-amber-hover text-white font-semibold px-7 py-3.5 rounded-full transition-all hover:scale-[1.02] hover:shadow-md"
                >
                  Book Service
                </Link>
                <a
                  href="tel:8058698070"
                  className="inline-flex items-center justify-center gap-2 border-2 border-forest text-forest hover:bg-forest hover:text-white font-semibold px-7 py-3.5 rounded-full transition-all"
                >
                  <Phone size={16} />
                  (805) 869-8070
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-sage-light">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-center gap-5 mb-14">
            <img
              src="/2dogjumping.png"
              alt="Scoop Dogg mascot jumping"
              className="w-44 h-44 object-contain drop-shadow-md flex-shrink-0 hidden md:block"
            />
            <div className="text-center md:text-left">
              <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-2">By the Numbers</h2>
              <p className="text-dark/60 max-w-md">Three years. Hundreds of yards. One standard.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((s) => (
              <div key={s.label} className="bg-white rounded-card p-7 shadow-card text-center">
                <div className="font-serif text-4xl sm:text-5xl text-forest mb-2">{s.number}</div>
                <div className="text-dark/60 text-sm font-medium leading-snug">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-4">What a Typical Visit Looks Like</h2>
              <p className="text-dark/60 max-w-md mx-auto">
                This is the page where you decide if you trust someone to come into your yard. So here's exactly what happens.
              </p>
            </div>
            <div className="space-y-6">
              {visitSteps.map((item) => (
                <div key={item.step} className="flex gap-5 items-start">
                  <div className="w-10 h-10 rounded-full bg-sage-light flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-forest font-bold text-xs">{item.step}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-dark mb-1">{item.title}</h3>
                    <p className="text-dark/65 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-sage-light">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-card p-8 md:p-10 shadow-card flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle size={20} className="text-amber" />
              </div>
              <div>
                <h3 className="font-semibold text-dark mb-1">See what customers are saying</h3>
                <p className="text-dark/60 text-sm leading-relaxed max-w-md">
                  Real reviews from real Ventura County homeowners on Google. If you want proof before you book, start there.
                </p>
              </div>
            </div>
            <a
              href="https://maps.app.goo.gl/9gB4PZfqtLwkHhQ3A"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border-2 border-forest text-forest hover:bg-forest hover:text-white font-semibold px-6 py-3 rounded-full transition-all flex-shrink-0 text-sm"
            >
              View Google Reviews
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-forest">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <div className="flex justify-center mb-4">
            <img
              src="/2dogjumping.png"
              alt="Scoop Dogg mascot jumping"
              className="w-48 h-48 object-contain drop-shadow-lg"
            />
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-white mb-4">
            Ready to give it a try?
          </h2>
          <p className="text-sage mb-3 max-w-lg mx-auto leading-relaxed">
            Book online and I'll personally confirm your first visit. Or just call me directly — I answer my phone.
          </p>
          <p className="text-sage/70 text-sm mb-10 italic">— Josue, Owner &amp; Operator</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/book"
              className="inline-flex items-center justify-center bg-amber hover:bg-amber-hover text-white font-semibold px-8 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg"
            >
              Book Online
            </Link>
            <a
              href="tel:8058698070"
              className="inline-flex items-center justify-center gap-2 border-2 border-white text-white hover:bg-white hover:text-forest font-semibold px-8 py-4 rounded-full transition-all"
            >
              <Phone size={16} />
              (805) 869-8070
            </a>
            <a
              href="mailto:josue@scoopdogg.net"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/40 text-white/80 hover:border-white hover:text-white font-semibold px-8 py-4 rounded-full transition-all"
            >
              <Mail size={16} />
              Email Josue
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
