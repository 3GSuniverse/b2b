import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from './App';
import { TooltipProvider } from './components/ui/overlay';
import { ApiError } from './lib/api';
import './styles.css';

// Cards with the "spotlight" class get a soft light that follows the pointer
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('.spotlight') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    },
    { passive: true },
  );
}

// A page the server sent already drawn is replaced by the live one (see PublicHeader); never leave it behind
setTimeout(() => document.getElementById('prerender')?.remove(), 8000);

/** The success toast's check mark, drawn stroke by stroke */
const DrawnCheck = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
    <circle className="check-circle" cx="12" cy="12" r="10" stroke="var(--color-success)" strokeWidth="2" />
    <path className="check-tick" d="M7.5 12.5l3 3 6-6.5" stroke="var(--color-success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          icons={{ success: DrawnCheck }}
          toastOptions={{
            classNames: {
              toast: '!rounded-[14px] !border-line !bg-surface !text-ink !shadow-[var(--shadow-pop)] !font-sans',
              description: '!text-muted',
              actionButton: '!bg-primary !text-on-primary !rounded-lg',
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
