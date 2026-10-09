import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type AuthResponse, type AuthUser } from './api';
import { AuthContext, type AuthContextValue } from './auth-context';
import {
  clearStoredToken,
  getStoredToken,
  isStoredTokenChange,
  setStoredToken,
  shouldInvalidateSessionForRequest,
} from './auth-storage';
import { registerUnauthorizedHandler } from './unauthorized-bus';
import { queryClient } from './query-client';
import { clearApiSessionCaches } from './session-cache';

async function clearOldApiCaches(): Promise<void> {
  await clearApiSessionCaches().then(() => undefined, () => undefined);
}

function clearSessionCaches(): void {
  queryClient.clear();
  void clearOldApiCaches();
}

function applyAuthResponse(resp: AuthResponse, setUser: (user: AuthUser | null) => void, setToken: (token: string | null) => void) {
  setStoredToken(resp.accessToken);
  setToken(resp.accessToken);
  setUser(resp.user);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [loading, setLoading] = useState(true);
  const sessionGenerationRef = useRef(0);

  const refreshSession = useCallback(async (generation: number) => {
    await clearOldApiCaches();
    if (sessionGenerationRef.current !== generation) return;
    const requestToken = getStoredToken();
    if (!requestToken) {
      setUser(null);
      setToken(null);
      return;
    }
    try {
      const me = await api.auth.me();
      if (
        sessionGenerationRef.current !== generation
        || getStoredToken() !== requestToken
      ) return;
      setToken(requestToken);
      setUser(me.user);
    } catch (error) {
      if (
        sessionGenerationRef.current === generation
        && shouldInvalidateSessionForRequest(requestToken, getStoredToken())
      ) {
        clearStoredToken();
        clearSessionCaches();
        setUser(null);
        setToken(null);
      }
      throw error;
    }
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++sessionGenerationRef.current;
    await refreshSession(generation);
  }, [refreshSession]);

  useEffect(() => {
    let cancelled = false;
    const generation = ++sessionGenerationRef.current;

    const bootstrap = async () => {
      try {
        await refreshSession(generation);
      } catch {
        if (!cancelled && sessionGenerationRef.current === generation) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled && sessionGenerationRef.current === generation) {
          setLoading(false);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!isStoredTokenChange(event)) return;
      const generation = ++sessionGenerationRef.current;
      queryClient.clear();
      void clearOldApiCaches();
      setUser(null);
      setToken(event.newValue);
      if (!event.newValue) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void refreshSession(generation)
        .catch(() => undefined)
        .finally(() => {
          if (sessionGenerationRef.current === generation) setLoading(false);
        });
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshSession]);

  // SEC-008：请求层遇到 401 时清空会话，交由 RequireAuth 跳转登录页（自带 state.from 回跳）
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      sessionGenerationRef.current += 1;
      clearStoredToken();
      clearSessionCaches();
      setUser(null);
      setToken(null);
    });
    return () => registerUnauthorizedHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    loading,
    login: async (email: string, password: string) => {
      const generation = ++sessionGenerationRef.current;
      clearSessionCaches();
      const resp = await api.auth.login({ email, password });
      if (sessionGenerationRef.current !== generation) return;
      applyAuthResponse(resp, setUser, setToken);
    },
    register: async (email: string, username: string, password: string) => {
      const generation = ++sessionGenerationRef.current;
      clearSessionCaches();
      const resp = await api.auth.register({ email, username, password });
      if (sessionGenerationRef.current !== generation) return;
      applyAuthResponse(resp, setUser, setToken);
    },
    logout: () => {
      sessionGenerationRef.current += 1;
      clearStoredToken();
      clearSessionCaches();
      setUser(null);
      setToken(null);
    },
    refresh,
  }), [loading, refresh, token, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
