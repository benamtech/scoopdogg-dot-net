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
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, refresh: async () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try { setUser((await adminApi.session()).user); }
    catch { setUser(null); }
    finally { setLoading(false); }
  };
  const signOut = async () => {
    try { await adminApi.logout(); } finally { setUser(null); window.location.assign('/admin/login'); }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
