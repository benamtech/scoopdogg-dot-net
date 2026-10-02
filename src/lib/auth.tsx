import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { adminApi, type AdminUser } from './adminApi';

/**
 * Admin session state, read from the server. There is no token in the browser: the
 * session is an httpOnly cookie the JavaScript cannot see, so "am I signed in" is a
 * question only the server can answer and this asks it.
 */
interface AuthContextType {
  user: AdminUser | null;
  loading: boolean;
  /** Whether the system is in demo mode. Rides the session so every screen can see it. */
  demoMode: boolean;
  demoAddress: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, demoMode: false, demoAddress: null,
  refresh: async () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [demoAddress, setDemoAddress] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await adminApi.session();
      setUser(s.user);
      setDemoMode(s.demo_mode === true);
      setDemoAddress(s.demo_address ?? null);
    }
    catch { setUser(null); }
    finally { setLoading(false); }
  };
  const signOut = async () => {
    try { await adminApi.logout(); } finally { setUser(null); window.location.assign('/admin/login'); }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, demoMode, demoAddress, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
