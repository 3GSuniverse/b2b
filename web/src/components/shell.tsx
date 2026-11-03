import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, FileText, LayoutDashboard, LogOut, Menu as MenuIcon, MessageCircle, Plus, Search, Send, Settings, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { date, n } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Overview } from '@/lib/types';
import { CommandPalette } from './command-palette';
import { NotificationsButton } from './notifications';
import { LinkButton } from './ui/button';
import { Avatar, Badge, Kbd, ProgressBar } from './ui/display';
import { Menu, MenuItem, MenuSeparator, Sheet } from './ui/overlay';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Send },
  { to: '/automations', label: 'Automations', icon: Clock3 },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span aria-hidden className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-ink">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7FE0C3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12l16-8-6 16-3-7-7-1z" />
        </svg>
      </span>
      <span className="text-[17px] font-bold tracking-[-0.02em]">{BRAND.name}</span>
    </span>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const whatsapp = !!useSession().tenant.features?.whatsapp;
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors',
              // WhatsApp has its own item, so Settings stays unlit there
              isActive && !(to === '/settings' && whatsapp && pathname.startsWith('/settings/whatsapp'))
                ? 'bg-accent-soft text-accent-strong'
                : 'text-ink-2 hover:bg-hover hover:text-ink',
            )
          }
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
          {label}
        </NavLink>
      ))}
      {whatsapp ? (
        <NavLink
          to="/settings/whatsapp"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn('flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors', isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink-2 hover:bg-hover hover:text-ink')
          }
        >
          <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
          WhatsApp
        </NavLink>
      ) : (
        <span className="flex h-10 items-center justify-between rounded-[10px] px-3 text-sm font-medium text-faint" aria-disabled>
          <span className="flex items-center gap-3">
            <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
            WhatsApp
          </span>
          <Badge tone="orange" className="px-2 text-[11px]">Soon</Badge>
        </span>
      )}
    </nav>
  );
}

function QuotaCard() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview'), staleTime: 30_000 });
  if (!q.data) return null;
  const { used, limit, resetsOn } = q.data.quota;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold">Monthly emails</span>
        <span className="tnum text-muted">
          {n(used)} / {n(limit)}
        </span>
      </div>
      <ProgressBar value={used} max={limit} label="Monthly emails used" tone={used / limit > 0.9 ? 'warm' : 'accent'} />
      <span className="text-xs text-muted">Resets on {date(resetsOn, { day: 'numeric', month: 'short' })}</span>
    </div>
  );
}

function AccountMenu() {
  const { user, tenant } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const signOut = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: () => {
      qc.clear();
      nav('/signin', { replace: true });
    },
  });
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className="flex w-full items-center gap-3 rounded-[12px] p-2 text-left hover:bg-hover">
          <Avatar name={user.name} email={user.email} size={34} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold">{tenant.name}</span>
            <span className="truncate text-xs text-muted">{user.name}</span>
          </span>
        </button>
      }
    >
      <div className="px-2.5 py-2">
        <p className="text-[13px] font-semibold">{user.name}</p>
        <p className="text-xs text-muted">{user.email}</p>
      </div>
      <MenuSeparator />
      <MenuItem icon={<Settings />} onSelect={() => nav('/settings/account')}>Account settings</MenuItem>
      <MenuItem icon={<LogOut />} onSelect={() => signOut.mutate()}>Sign out</MenuItem>
    </Menu>
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-[248px] shrink-0 border-r border-line bg-sunken lg:block">
      <div className="sticky top-0 flex h-screen flex-col gap-7 px-4 py-6">
        <Logo className="px-2" />
        <NavItems />
        <div className="mt-auto flex flex-col gap-3">
          <QuotaCard />
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onSearch, onMenu }: { onSearch: () => void; onMenu: () => void }) {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return (
    <div className="flex items-center gap-2.5">
      <button type="button" onClick={onMenu} className="grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line bg-surface lg:hidden" aria-label="Open menu">
        <MenuIcon className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-left text-sm text-faint hover:border-[#d2d7d3] sm:max-w-80"
      >
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Search contacts, campaigns…</span>
        <span className="hidden sm:inline">
          <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-2.5">
        <NotificationsButton />
        <LinkButton to="/campaigns/new" variant="primary" size="icon" className="h-11 w-11 sm:hidden" aria-label="New campaign">
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
        </LinkButton>
        <LinkButton to="/campaigns/new" variant="primary" className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New campaign
        </LinkButton>
      </div>
    </div>
  );
}

export function PausedBanner() {
  const { tenant } = useSession();
  if (tenant.status === 'ACTIVE') return null;
  return (
    <div role="alert" className="rounded-[14px] border border-[#f3c9a8] bg-warm-soft px-4 py-3 text-sm text-warm-strong">
      <strong className="font-semibold">Sending is paused.</strong> {tenant.pausedReason ?? 'Contact support to resume sending.'}
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setMobileNav(false), [loc.pathname]);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 px-4 pb-16 pt-5 sm:px-6 lg:px-10 lg:pt-7">
          <TopBar onSearch={() => setPalette(true)} onMenu={() => setMobileNav(true)} />
          <PausedBanner />
          <main id="main" className="flex flex-col gap-6">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <Sheet open={mobileNav} onOpenChange={setMobileNav} title={<Logo />} width="max-w-[300px]">
        <div className="flex h-full flex-col gap-6">
          <NavItems onNavigate={() => setMobileNav(false)} />
          <div className="mt-auto flex flex-col gap-3">
            <QuotaCard />
            <AccountMenu />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
