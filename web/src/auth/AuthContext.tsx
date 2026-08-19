import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getMe, login as apiLogin } from '../api/auth';
import { clearToken, setToken, TOKEN_KEY } from '../api/client';
import type { Driver, User } from '../types';

interface AuthState {
  user: User | null;
  driver: Driver | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      setDriver(null);
      return;
    }
    try {
      const me = await getMe();
      setUser(me.user);
      setDriver(me.driver);
    } catch {
      clearToken();
      setUser(null);
      setDriver(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await apiLogin(email, password);
      setToken(res.token);
      setUser(res.user);
      await refresh();
      return res.user;
    },
    [refresh]
  );

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
    setDriver(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, driver, loading, signIn, signOut, refresh }),
    [user, driver, loading, signIn, signOut, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
