import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type FetchStatusResponse, type ItemsStats } from '../../lib/api';
import { useAuth } from '../../lib/use-auth';
import type { SettingsMode } from './shared';

interface SettingsContextValue {
  mode: SettingsMode;
  isAdmin: boolean;
  user: ReturnType<typeof useAuth>['user'];
  loading: boolean;
  error: string | null;
  notice: string | null;
  setError: (err: string | null) => void;
  setNotice: (msg: string | null) => void;
  fetchStatus: FetchStatusResponse | null;
  itemStats: ItemsStats | null;
  refreshBase: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ mode, children }: { mode: SettingsMode; children: React.ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fetchStatus, setFetchStatus] = useState<FetchStatusResponse | null>(null);
  const [itemStats, setItemStats] = useState<ItemsStats | null>(null);

  const refreshBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchResp, statResp] = await Promise.all([
        api.fetch.status(),
        api.items.stats(),
      ]);
      setFetchStatus(fetchResp);
      setItemStats(statResp);
    } catch (err) {
      setError((err as Error).message || '加载基础数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBase();
  }, [refreshBase]);

  return (
    <SettingsContext.Provider value={{ mode, isAdmin, user, loading, error, notice, setError, setNotice, fetchStatus, itemStats, refreshBase }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
