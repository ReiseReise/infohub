import { useEffect, useMemo, useState } from 'react';
import { api, type AuthResponse, type AuthUser } from './api';
import { AuthContext, type AuthContextValue } from './auth-context';
import { clearStoredToken, getStoredToken, setStoredToken } from './auth-storage';

function applyAuthResponse(resp: AuthResponse, setUser: (user: AuthUser | null) => void, setToken: (token: string | null) => void) {
  setStoredToken(resp.accessToken);
  setToken(resp.accessToken);
  setUser(resp.user);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const currentToken = getStoredToken();
    if (!currentToken) {
      setUser(null);
      setToken(null);
      return;
    }
    const me = await api.auth.me();
    setToken(currentToken);
    setUser(me.user);
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        await refresh();
      } catch {
        clearStoredToken();
        if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    loading,
    login: async (email: string, password: string) => {
      const resp = await api.auth.login({ email, password });
      applyAuthResponse(resp, setUser, setToken);
    },
    register: async (email: string, username: string, password: string) => {
      const resp = await api.auth.register({ email, username, password });
      applyAuthResponse(resp, setUser, setToken);
    },
    logout: () => {
      clearStoredToken();
      setUser(null);
      setToken(null);
    },
    refresh,
  }), [loading, token, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
