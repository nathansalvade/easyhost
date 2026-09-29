import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthenticatedHandler } from './api/client';
import type { AuthStatus } from './api/types';

interface AuthContextValue {
  status: AuthStatus | null;
  refresh(): Promise<void>;
  markLoggedOut(): void;
  /**
   * A recovery code just created by setup or recovery. Held here, not in a
   * navigation, because the same action also logs the user in and the
   * routes change under it; App shows it until the user continues.
   */
  newRecoveryCode: string | null;
  setNewRecoveryCode(code: string | null): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await api<AuthStatus>('GET', '/api/auth/status'));
  }, []);
  const markLoggedOut = useCallback(() => {
    setStatus((s) => (s ? { ...s, authenticated: false } : s));
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(markLoggedOut);
    refresh().catch(() => setStatus({ setupRequired: false, authenticated: false }));
  }, [refresh, markLoggedOut]);

  return (
    <AuthContext.Provider value={{ status, refresh, markLoggedOut, newRecoveryCode, setNewRecoveryCode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
