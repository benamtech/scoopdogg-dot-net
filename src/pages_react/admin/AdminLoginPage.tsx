import { useState } from 'react';
import { Mail, KeyRound, ArrowRight, Loader2 } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';

/**
 * Sign in with an email code. No password.
 *
 * The old screen used Supabase email+password and had a `signUp` fallback, which meant a
 * stranger who guessed the URL could create an account. Access is now decided by a row in
 * `team_members`, and an address that is not on that list gets the same reply as one that
 * is — so this page cannot be used to find out who has access.
 */
export default function AdminLoginPage() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await adminApi.startLogin(email);
      setNotice(r.message);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setBusy(false); }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await adminApi.verifyLogin(email, code);
      window.location.assign('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/horizontallogo.png" alt="Scoop Dogg" className="h-14 w-auto mx-auto mb-5" />
          <h1 className="font-serif text-2xl text-dark">Scoop Dogg admin</h1>
          <p className="text-dark/50 text-sm mt-1">Leads, messages and settings</p>
        </div>

        <div className="bg-white rounded-2xl border border-sage-light shadow-card p-7">
          {step === 'email' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-dark/50">Email</span>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-sage-light px-3 focus-within:border-forest transition-colors">
                  <Mail size={16} className="text-dark/30 flex-shrink-0" />
                  <input
                    type="email" required autoFocus autoComplete="email" value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="you@example.com"
                    className="w-full py-3 bg-transparent text-dark placeholder-dark/30 outline-none text-sm"
                  />
                </div>
              </label>
              {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button
                type="submit" disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-forest hover:bg-forest-dark disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              {notice && <p className="text-sm text-dark/60 bg-sage-light rounded-lg px-3 py-2">{notice}</p>}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-dark/50">Six-digit code</span>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-sage-light px-3 focus-within:border-forest transition-colors">
                  <KeyRound size={16} className="text-dark/30 flex-shrink-0" />
                  <input
                    inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus
                    autoComplete="one-time-code" value={code}
                    onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full py-3 bg-transparent text-dark placeholder-dark/30 outline-none tracking-[0.4em] text-lg"
                  />
                </div>
              </label>
              {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button
                type="submit" disabled={busy || code.length !== 6}
                className="w-full flex items-center justify-center gap-2 bg-forest hover:bg-forest-dark disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('email'); setCode(''); setError(''); }}
                className="w-full text-dark/50 hover:text-dark text-sm transition-colors"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-dark/40 text-xs mt-6">
          Codes expire after 10 minutes and work once.
        </p>
      </div>
    </div>
  );
}
