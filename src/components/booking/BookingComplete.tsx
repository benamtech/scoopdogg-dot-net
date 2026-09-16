/** The page Stripe returns to. Confirms the payment server-side, then hands off to the account. */
import { useEffect, useState } from 'react';

type Result = { name: string; package: string; next_visit: string; weekday: string };

export default function BookingComplete() {
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const booking = url.searchParams.get('booking');
    const session = url.searchParams.get('session_id');
    let tries = 0;
    const attempt = async () => {
      tries++;
      try {
        const r = await fetch('/api/booking/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ booking_id: booking, session_id: session }) });
        const j = await r.json();
        if (r.status === 402 && tries < 6) return setTimeout(attempt, 1500);
        if (!r.ok) throw new Error(j.error || 'We could not confirm your booking.');
        sessionStorage.removeItem('sd-booking-v1');
        try { (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', 'purchase', { transaction_id: booking }); } catch { /* never breaks */ }
        setResult(j); setState('done');
      } catch (e) { setError((e as Error).message); setState('error'); }
    };
    attempt();
  }, []);

  const date = result ? new Date(`${result.next_visit}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';

  if (state === 'working') return (
    <div className="text-center" role="status">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-forest-100 border-t-forest-600" />
      <p className="mt-6 text-lg text-ink-700">Confirming your payment…</p>
    </div>
  );
  if (state === 'error') return (
    <div className="rounded-xl border border-line bg-paper p-8">
      <h1 className="text-h2 text-forest-900">We're checking on your booking</h1>
      <p className="mt-3 text-lg text-ink-700">{error} If you were charged, you're booked — we'll email your confirmation. Questions? Call (805) 869-8070.</p>
      <a href="/account" className="btn-primary mt-6">Go to my account</a>
    </div>
  );
  return (
    <div className="rounded-xl border border-line bg-paper p-8 text-center shadow-md sm:p-12">
      <img src="/brand/mark-192.png" alt="" width="96" height="96" className="mx-auto h-24 w-24 rounded-full shadow-sm" />
      <h1 className="mt-6 text-h1 text-forest-900">You're booked{result?.name ? `, ${result.name.split(' ')[0]}` : ''}!</h1>
      <p className="mt-4 text-lg text-ink-700">Your first visit is <strong className="font-semibold text-forest-900">{date}</strong>, and we'll be back every {result?.weekday}.</p>
      <p className="mt-2 text-base text-ink-500">A confirmation is on its way to your inbox.</p>
      <a href="/account" className="btn-primary btn-lg mt-8">Go to my account</a>
    </div>
  );
}
