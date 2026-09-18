import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../lib/api';
import { loadSession } from '../lib/secure-store';

interface AuthState {
  email: string | null;
  sessionId: string | null;
  loading: boolean;
  lastForegroundAt: Date | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Refetch trigger — screens refresh on foreground (offline-first pattern). */
  refreshTick: number;
  bump: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastForegroundAt, setLastForegroundAt] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const bump = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    loadSession()
      .then((s) => {
        if (s) setSessionId(s.sessionId);
      })
      .finally(() => setLoading(false));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setLastForegroundAt(new Date());
        bump();
      }
    });
    return () => sub.remove();
  }, [bump]);

  const signIn = useCallback(async (e: string, password: string) => {
    const r = await api.login(e, password);
    setEmail(r.user.email);
    setSessionId(r.sessionId);
  }, []);

  const register = useCallback(async (e: string, password: string) => {
    const r = await api.register(e, password);
    setEmail(r.user.email);
    setSessionId(r.sessionId);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setEmail(null);
    setSessionId(null);
  }, []);

  const value = useMemo(
    () => ({ email, sessionId, loading, lastForegroundAt, signIn, register, signOut, refreshTick, bump }),
    [email, sessionId, loading, lastForegroundAt, refreshTick, bump],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/** True when inside the 10-min recent-auth window (destructive + pairing confirm). */
export async function hasRecentAuth(): Promise<boolean> {
  const { getRecentAuthAt } = await import('../lib/secure-store');
  const { RECENT_AUTH_WINDOW_MS } = await import('../lib/config');
  const at = await getRecentAuthAt();
  if (!at) return false;
  return Date.now() - at.getTime() < RECENT_AUTH_WINDOW_MS;
}
