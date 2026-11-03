import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import type { Me } from './types';

const SessionContext = createContext<Me | null>(null);

export function useSession(): Me {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside a signed-in page');
  return s;
}

export const meQuery = {
  queryKey: ['me'],
  queryFn: () => api.get<Me>('/api/auth/me'),
  retry: (count: number, err: unknown) => !(err instanceof ApiError && err.status === 401) && count < 2,
  staleTime: 30_000,
  refetchInterval: 60_000, // trial days and WhatsApp allowance stay current
};

/** Wraps signed-in pages: loads the session, or sends the user to sign in. */
export function RequireSession({ children }: { children: ReactNode }) {
  const q = useQuery(meQuery);
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    const onEnded = () => {
      qc.clear();
      nav(`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
    };
    window.addEventListener('session-ended', onEnded);
    return () => window.removeEventListener('session-ended', onEnded);
  }, [nav, loc, qc]);

  useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401) {
      nav(`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
    }
  }, [q.error, nav, loc]);

  if (q.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" aria-label="Loading" />
      </div>
    );
  }
  if (!q.data) return null;
  return <SessionContext.Provider value={q.data}>{children}</SessionContext.Provider>;
}
