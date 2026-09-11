import BookingWidget from '../components/BookingWidget';
import { useSEO } from '../lib/useSEO';

export default function BookPage() {
  useSEO({
    title: 'Book Dog Poop Cleaning Service | Scoop Dogg',
    description: 'Weekly dog poop cleanup starting at $15/visit. Serving all of Ventura County with flexible plans and optional turf deodorizing. Book in 60 seconds.',
    canonicalPath: '/book',
  });

  return (
    <div className="min-h-screen bg-forest">
      <div className="max-w-site mx-auto px-4 sm:px-6 py-24 md:py-32">
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl sm:text-5xl text-white mb-4">
            Book Your Service
          </h1>
          <p className="text-sage max-w-md mx-auto text-lg">
            Takes less than 60 seconds. No commitment required. We'll follow up same day.
          </p>
        </div>
        <BookingWidget sourcePage="/book" />
      </div>
    </div>
  );
}
