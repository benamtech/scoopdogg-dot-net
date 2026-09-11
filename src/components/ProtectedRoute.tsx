import { useAuth } from '../lib/auth';

/**
 * Gate for every admin screen. The real gate is server-side — /api/admin/* refuses
 * without a session cookie — so this only decides what a signed-out browser is shown.
 * Never treat it as the security boundary.
 */
export default function ProtectedRoute({
  children,
  requireSuperadmin = false,
}: {
  children: React.ReactNode;
  requireSuperadmin?: boolean;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sage border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    if (typeof window !== 'undefined') window.location.replace('/admin/login');
    return null;
  }

  if (requireSuperadmin && user.role !== 'superadmin') {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-serif text-2xl text-dark mb-2">Superadmin only</h1>
          <p className="text-dark/60 text-sm">
            This screen is limited to AMTECH. You are signed in as {user.email}.
          </p>
          <a href="/admin" className="inline-block mt-5 text-forest font-semibold text-sm">Back to the dashboard</a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
