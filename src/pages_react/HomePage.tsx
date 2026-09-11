import Hero from '../components/home/Hero';
import HowItWorks from '../components/home/HowItWorks';
import Services from '../components/home/Services';
import Areas from '../components/home/Areas';
import HomeGallery from '../components/home/HomeGallery';
import AboutTrust from '../components/home/AboutTrust';
import Testimonials from '../components/home/Testimonials';
import BookingSection from '../components/home/BookingSection';
import HomeFAQ from '../components/home/HomeFAQ';
import { useSEO } from '../lib/useSEO';

export default function HomePage() {
  useSEO({
    title: 'Dog Poop Cleaning Services in Ventura County, CA | Scoop Dogg',
    description: 'Professional dog poop cleaning services in Ventura County. Weekly yard scoops, one-time cleanups, turf deodorizing. Free quote in 60 seconds.',
    canonicalPath: '/',
  });

  return (
    <>
      <Hero />
      <HowItWorks />
      <Services />
      <Areas />
      <HomeGallery />
      <AboutTrust />
      <Testimonials />
      <HomeFAQ />
      <BookingSection />
    </>
  );
}
