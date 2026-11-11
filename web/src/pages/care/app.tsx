import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Headset, Inbox, LogOut, Search, ShieldCheck } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AgencyPanel } from '@/components/care/agency-profile';
import { LogoMark } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Menu, MenuItem } from '@/components/ui/overlay';
import { api, ApiError, qs } from '@/lib/api';
import type { AgencyRow, CareStaff, CareSummary } from '@/lib/care';
import { cn } from '@/lib/cn';
import { ago, date } from '@/lib/format';
import { CareInbox } from './inbox';
import { businessLabel, nb } from '../../lib/words';

const StaffContext = createContext<CareStaff | null>(null);
export const useStaff = () => useContext(StaffContext)!;

export const summaryQuery = { queryKey: ['care', 'summary'], queryFn: () => api.get<CareSummary>('/api/care/summary'), refetchInterval: 15_000 };

/**
 * Customer care: Dhrona's own team answering agencies. A separate app at /care with its own
 * sign-in; agency logins can't open it.
 */
export function CareApp() {
  useEffect(() => {
    const t = document.title;
    document.title = 'Customer care · Dhrona';
    return () => {
      document.title = t;
    };
  }, []);
  return (
    <Routes>
      <Route path="signin" element={<CareSignIn />} />
      <Route
        path="*"
        element={
          <RequireStaff>
            <CareShell>
              <Routes>
                <Route index element={<CareInbox />} />
                <Route path="t/:id" element={<CareInbox />} />
                <Route path="agencies" element={<AgenciesPage />} />
                <Route path="agencies/:id" element={<AgencyPage />} />
                <Route path="*" element={<Navigate to="/care" replace />} />
              </Routes>
            </CareShell>
          </RequireStaff>
        }
      />
    </Routes>
  );
}

function RequireStaff({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['care', 'me'], queryFn: () => api.get<{ staff: CareStaff }>('/api/care/auth/me'), retry: false, staleTime: 60_000 });
  useEffect(() => {
    const ended = () => {
      qc.removeQueries({ queryKey: ['care'] });
      nav(`/care/signin?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
    };
    window.addEventListener('care-session-ended', ended);
    return () => window.removeEventListener('care-session-ended', ended);
  }, [nav, loc.pathname, qc]);
  if (q.isPending)
    return (
      <div className="grid min-h-screen place-items-center bg-nav">
        <Headset className="h-8 w-8 animate-pulse text-white/60" />
      </div>
    );
  if (q.error instanceof ApiError && q.error.status === 401) return <Navigate to={`/care/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!q.data) return <p className="p-8 text-sm text-muted">Customer care couldn’t load. Refresh the page.</p>;
  return <StaffContext.Provider value={q.data.staff}>{children}</StaffContext.Provider>;
}

function CareSignIn() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const next = new URLSearchParams(useLocation().search).get('next');
  const [f, setF] = useState({ email: '', password: '' });
  const m = useMutation({
    mutationFn: () => api.post<{ staff: CareStaff }>('/api/care/auth/login', f),
    onSuccess: (r) => {
      qc.setQueryData(['care', 'me'], r);
      nav(next?.startsWith('/care') ? next : '/care', { replace: true });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-nav px-4 py-10">
      {/* Signal rings: someone, somewhere, asking for help */}
      <svg aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[1100px] w-[1100px] -translate-x-1/2 -translate-y-1/2 opacity-[0.13]" viewBox="0 0 400 400">
        {[40, 80, 120, 160, 200].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke={i % 2 ? '#ff8a1f' : '#8f86ff'} strokeWidth="1.2" />
        ))}
      </svg>
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <LogoMark size={40} />
          <span className="flex flex-col leading-tight">
            <span className="text-[18px] font-extrabold tracking-[-0.03em]">Dhrona</span>
            <span className="text-[13px] font-medium text-highlight">Customer care</span>
          </span>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-5 rounded-[24px] bg-surface p-7 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)]">
          <div className="flex flex-col gap-1">
            <h1 className="text-[22px] font-bold tracking-[-0.02em]">{nb("Sign in to help agencies")}</h1>
            <p className="text-sm text-muted">For the Dhrona support team only.</p>
          </div>
          {m.error && !(m.error instanceof ApiError && m.error.details?.fields) && (
            <p role="alert" className="rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {m.error.message}
            </p>
          )}
          <Field label="Work email" error={m.error instanceof ApiError ? m.error.field('email') : undefined}>
            {(p) => <Input {...p} type="email" autoComplete="username" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
          </Field>
          <Field label="Password" error={m.error instanceof ApiError ? m.error.field('password') : undefined}>
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={m.isPending}>
            Sign in
          </Button>
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
            <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-success" />
            {nb("You’ll see agencies’ details to help them. Use them only for that.")}
          </p>
        </form>
        <p className="mt-5 text-center text-[13px] text-white/55">
          Run a business?{' '}
          <Link to="/signin" className="font-semibold text-white/85 hover:text-white">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}

/** The left rail: the queue, agency lookup, and who's signed in. Becomes a top bar on small screens. */
function CareShell({ children }: { children: ReactNode }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const nav = useNavigate();
  const s = useQuery(summaryQuery).data;
  const out = useMutation({
    mutationFn: () => api.post('/api/care/auth/logout'),
    onSettled: () => {
      qc.removeQueries({ queryKey: ['care'] });
      nav('/care/signin', { replace: true });
    },
  });
  const { pathname } = useLocation();
  const items = [
    { to: '/care', label: 'Requests', icon: Inbox, lit: pathname === '/care' || pathname.startsWith('/care/t/'), count: s?.needsReply },
    { to: '/care/agencies', label: 'Agencies', icon: Building2, lit: pathname.startsWith('/care/agencies') },
  ];
  return (
    <div className="flex h-dvh flex-col bg-ground lg:flex-row">
      <aside className="flex shrink-0 items-center gap-1 bg-nav px-3 py-2 text-nav-ink lg:w-[84px] lg:flex-col lg:gap-2 lg:px-2 lg:py-4">
        <Link to="/care" className="group/logo mr-2 flex items-center gap-2 lg:mb-4 lg:mr-0 lg:flex-col lg:gap-1" aria-label="Customer care home">
          <LogoMark size={34} />
          <span className="text-[10.5px] font-bold text-highlight lg:text-center">Care</span>
        </Link>
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={cn(
              'relative flex items-center gap-2 rounded-[12px] px-3 py-2 text-[12px] font-semibold transition-colors lg:w-full lg:flex-col lg:gap-1 lg:px-1 lg:py-2.5',
              it.lit ? 'bg-nav-active text-white' : 'text-nav-muted hover:bg-nav-hover hover:text-white',
            )}
          >
            <it.icon className="h-5 w-5" />
            {it.label}
            {!!it.count && (
              <span className="tnum absolute -top-1 right-0 grid h-5 min-w-5 place-items-center rounded-full bg-highlight px-1 text-[11px] font-bold text-white lg:right-2 lg:top-1">{it.count}</span>
            )}
          </NavLink>
        ))}
        <div className="ml-auto lg:ml-0 lg:mt-auto">
          <Menu
            align="start"
            trigger={
              <button type="button" className="rounded-full p-0.5 ring-2 ring-transparent transition hover:ring-white/30" aria-label={`Signed in as ${staff.name}`}>
                <Avatar name={staff.name} email={staff.email} size={36} />
              </button>
            }
          >
            <div className="px-2.5 py-2">
              <p className="text-[13px] font-semibold">{staff.name}</p>
              <p className="text-xs text-muted">
                Customer care · {staff.email}
              </p>
            </div>
            <MenuItem icon={<LogOut />} onSelect={() => out.mutate()}>
              Sign out
            </MenuItem>
          </Menu>
        </div>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- agency lookup

function AgenciesPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery({ queryKey: ['care', 'agencies', term], queryFn: () => api.get<{ agencies: AgencyRow[] }>(`/api/care/agencies${qs({ q: term })}`), placeholderData: (p) => p });
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{nb("Agencies")}</h1>
          <p className="text-sm text-muted">{nb("Find one by its name, agency ID, anyone’s name or email, or its WhatsApp number.")}</p>
        </div>
        <Input
          leading={<Search className="h-4 w-4" />}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Kurukshetra, kt-travels, ravi@…, 98480…"
          className="h-12 text-[15px]"
          aria-label="Find an agency"
        />
        {r.isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[72px] rounded-[16px]" />
            ))}
          </div>
        ) : !r.data?.agencies.length ? (
          <p className="rounded-[16px] border border-dashed border-line px-5 py-8 text-center text-sm text-muted">{term ? nb(`No agency matches “${term}”.`) : nb('No agencies yet.')}</p>
        ) : (
          <ul className={cn('stagger flex flex-col gap-2', r.isFetching && 'opacity-70')}>
            {!term && <li className="text-[12.5px] font-semibold text-muted">Newest first</li>}
            {r.data.agencies.map((a) => (
              <li key={a.id}>
                <Link to={`/care/agencies/${a.id}`} className="lift flex flex-wrap items-center gap-4 rounded-[16px] border border-line bg-surface px-4 py-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2 truncate text-[15px] font-semibold">
                      {a.name}
                      {a.status !== 'ACTIVE' && <Badge tone="red">{a.status.toLowerCase()}</Badge>}
                      {a.businessType !== 'TRAVEL' && <Badge tone="grey">{businessLabel(a.businessType)}</Badge>}
                    </span>
                    <span className="truncate text-[12.5px] text-muted">
                      {a.loginCode} · {a.ownerName ?? 'No owner'} {a.ownerEmail ? `· ${a.ownerEmail}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <Badge tone={a.trial ? 'orange' : 'blue'}>{a.planLabel}</Badge>
                    <span className="tnum text-muted">{a.logins} logins</span>
                    {a.openRequests > 0 && <Badge tone="red">{a.openRequests} open</Badge>}
                    <span className="hidden text-faint sm:inline">joined {date(a.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AgencyPage() {
  const { id } = useParams();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6 sm:px-8">
        <Link to="/care/agencies" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {nb("Agencies")}
        </Link>
        <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--panel-shadow)]">
          <AgencyPanel id={id!} wide />
        </div>
        <AgencyRequests id={id!} />
      </div>
    </div>
  );
}

function AgencyRequests({ id }: { id: string }) {
  const r = useQuery({ queryKey: ['care', 'tickets', 'agency', id], queryFn: () => api.get<{ tickets: { id: string; number: number; subject: string; status: string; lastMessageAt: string }[] }>(`/api/care/tickets${qs({ view: 'all', agency: id })}`) });
  if (!r.data?.tickets.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">{nb("Requests from this agency")}</h2>
      <ul className="flex flex-col gap-1.5">
        {r.data.tickets.map((t) => (
          <li key={t.id}>
            <Link to={`/care/t/${t.id}`} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-2.5 text-[13.5px] hover:border-[#cfcde6]">
              <span className="tnum text-faint">{t.number}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{t.subject}</span>
              <span className="text-[12px] text-muted">{ago(t.lastMessageAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

