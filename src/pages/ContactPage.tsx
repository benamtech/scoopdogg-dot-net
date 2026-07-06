import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, ArrowRight, CheckCircle, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSEO } from '../lib/useSEO';

const SUBJECTS = ['General Question', 'Request a Quote', 'Existing Customer', 'Other'];

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export default function ContactPage() {
  useSEO({
    title: 'Contact Scoop Dogg | Pet Waste Removal Ventura County',
    description: 'Have a question or want to get a quote? Reach out to Scoop Dogg — pet waste removal serving all of Ventura County. Call, email, or send a message online.',
    canonicalPath: '/contact',
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('General Question');
  const [message, setMessage] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState('submitting');
    setErrorMsg('');

    const { error } = await supabase.from('contact_messages').insert({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      subject,
      message: message.trim(),
      status: 'unread',
    });

    if (error) {
      setErrorMsg('Something went wrong. Please try again or call us directly.');
      setFormState('error');
      return;
    }

    setFormState('success');
  };

  return (
    <div className="bg-cream">
      <section className="bg-forest pt-36 pb-16 md:pt-44 md:pb-20">
        <div className="max-w-site mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-4">Contact Us</h1>
          <p className="text-sage text-lg max-w-md mx-auto leading-relaxed">
            Questions about service, pricing, or availability? We're happy to help. Or skip the back-and-forth and book directly — most people do.
          </p>
        </div>
      </section>

      <section className="py-12 bg-white">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-amber/5 border-l-4 border-amber rounded-r-2xl p-8 text-center shadow-sm">
              <h2 className="font-serif text-3xl sm:text-4xl text-dark mb-4">
                Want to skip the back-and-forth?
              </h2>
              <p className="text-dark/65 text-base leading-relaxed mb-8 max-w-lg mx-auto">
                Most of our customers book online in under 60 seconds — no phone call, no waiting for a reply. Pick your service, pick your day, done.
              </p>
              <Link
                to="/book"
                className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-hover text-white font-semibold text-lg px-10 py-4 rounded-full transition-all hover:scale-[1.02] hover:shadow-lg w-full sm:w-auto"
              >
                Book Your Service Now
                <ArrowRight size={20} />
              </Link>
              <p className="text-dark/40 text-sm mt-4">No credit card required. We confirm same day.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20 bg-cream">
        <div className="max-w-site mx-auto px-4 sm:px-6">
          <p className="text-center text-dark/40 text-sm font-semibold uppercase tracking-wider mb-12">
            Still have questions? We're here.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-16">
            <div className="lg:col-span-3">
              <div className="bg-white rounded-card shadow-card p-8">
                {formState === 'success' ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-5">
                      <CheckCircle size={32} className="text-green-600" />
                    </div>
                    <h3 className="font-serif text-2xl text-dark mb-3">Message sent!</h3>
                    <p className="text-dark/55 leading-relaxed max-w-sm">
                      We'll get back to you shortly. If you need a faster answer, give us a call.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-dark/70">
                          Name <span className="text-amber">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your full name"
                          className="border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-dark/70">
                          Email <span className="text-amber">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@email.com"
                          className="border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-dark/70">Phone</label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="(805) 000-0000"
                          className="border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-dark/70">Subject</label>
                        <div className="relative">
                          <select
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            className="w-full appearance-none border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors bg-white text-dark pr-10"
                          >
                            {SUBJECTS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <ChevronDown size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-dark/30 pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-dark/70">
                        Message <span className="text-amber">*</span>
                      </label>
                      <textarea
                        required
                        rows={4}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="What's on your mind?"
                        className="border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors resize-none"
                      />
                    </div>

                    {formState === 'error' && (
                      <p className="text-red-600 text-sm">{errorMsg}</p>
                    )}

                    <button
                      type="submit"
                      disabled={formState === 'submitting'}
                      className="w-full bg-amber hover:bg-amber-hover text-white font-semibold py-4 rounded-full transition-all hover:shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {formState === 'submitting' ? 'Sending...' : 'Send Message →'}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="lg:col-span-2 flex flex-col gap-8 justify-start pt-2">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-forest/10 flex items-center justify-center flex-shrink-0">
                    <Phone size={16} className="text-forest" />
                  </div>
                  <p className="font-semibold text-dark">Call Us</p>
                </div>
                <a
                  href="tel:8058698070"
                  className="text-xl font-serif text-forest hover:text-amber transition-colors ml-12"
                >
                  (805) 869-8070
                </a>
                <p className="text-dark/45 text-sm mt-1 ml-12">Mon–Sat, 7am–6pm</p>
              </div>

              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-forest/10 flex items-center justify-center flex-shrink-0">
                    <Mail size={16} className="text-forest" />
                  </div>
                  <p className="font-semibold text-dark">Email</p>
                </div>
                <a
                  href="mailto:josue@scoopdogg.net"
                  className="text-base text-forest hover:text-amber transition-colors ml-12 break-all"
                >
                  josue@scoopdogg.net
                </a>
                <p className="text-dark/45 text-sm mt-1 ml-12">We respond within a few hours.</p>
              </div>

              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-forest/10 flex items-center justify-center flex-shrink-0">
                    <MapPin size={16} className="text-forest" />
                  </div>
                  <p className="font-semibold text-dark">Service Area</p>
                </div>
                <p className="text-dark/65 text-sm ml-12 mb-2">15 cities across Ventura County and more.</p>
                <Link
                  to="/#areas"
                  className="text-sm font-medium text-forest hover:text-amber transition-colors ml-12"
                >
                  View all service areas →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
