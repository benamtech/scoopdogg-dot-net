import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Lock, Mail, UserPlus, LogIn } from 'lucide-react';

const ALLOWED_EMAILS = ['ben@palaskasconsulting.com', 'scoopdogg129@gmail.com', 'josue@scoopdogg.net'];

export default function AdminLoginPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session) return <Navigate to="/admin" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const trimmedEmail = email.toLowerCase().trim();

    if (!ALLOWED_EMAILS.includes(trimmedEmail)) {
      setError('Access denied. This email is not authorized.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);

    if (mode === 'signup') {
      const { error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });
      setSubmitting(false);
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setSuccess('Account created! You can now sign in.');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      setSubmitting(false);
      if (signInError) {
        setError(signInError.message);
      }
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen bg-forest flex items-center justify-center p-4">
      <div className="bg-white rounded-card shadow-card-hover w-full max-w-md p-8">
        <div className="text-center mb-8">
          <p className="font-serif text-2xl text-forest mb-1">Scoop Dogg</p>
          <p className="text-dark/50 text-sm">Admin Portal</p>
        </div>

        <div className="flex mb-6 bg-sage-light/30 rounded-full p-1">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-all ${
              mode === 'login'
                ? 'bg-white text-forest shadow-sm'
                : 'text-dark/40 hover:text-dark/60'
            }`}
          >
            <LogIn size={15} />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-all ${
              mode === 'signup'
                ? 'bg-white text-forest shadow-sm'
                : 'text-dark/40 hover:text-dark/60'
            }`}
          >
            <UserPlus size={15} />
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-dark/30" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full pl-11 pr-4 py-3.5 border border-sage-light rounded-xl focus:outline-none focus:border-forest transition-colors"
            />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-dark/30" />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full pl-11 pr-4 py-3.5 border border-sage-light rounded-xl focus:outline-none focus:border-forest transition-colors"
            />
          </div>
          {mode === 'signup' && (
            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-dark/30" />
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full pl-11 pr-4 py-3.5 border border-sage-light rounded-xl focus:outline-none focus:border-forest transition-colors"
              />
            </div>
          )}
          {error && (
            <p className="text-red-600 text-sm text-center bg-red-50 rounded-lg py-2 px-4">{error}</p>
          )}
          {success && (
            <p className="text-green-700 text-sm text-center bg-green-50 rounded-lg py-2 px-4">{success}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="bg-forest hover:bg-forest-dark text-white font-semibold py-3.5 rounded-full transition-all hover:shadow-md disabled:opacity-60 mt-2"
          >
            {submitting
              ? (mode === 'signup' ? 'Creating account...' : 'Signing in...')
              : (mode === 'signup' ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <p className="text-center text-dark/40 text-xs mt-6">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" onClick={switchMode} className="text-forest hover:underline font-medium">
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
