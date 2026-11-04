import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, FileText, LayoutDashboard, LogOut, Menu as MenuIcon, MessageCircle, Plane, Plus, Search, Send, Settings, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { date, n } from '@/lib/format';
import { CountUp, play, SMOOTH, SPRING, useSlidingIndicator } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { Overview } from '@/lib/types';
import { CommandPalette } from './command-palette';
import { NotificationsButton } from './notifications';
import { LinkButton } from './ui/button';
import { Avatar, Badge, Kbd, ProgressBar } from './ui/display';
import { Menu, MenuItem, MenuSeparator, Sheet } from './ui/overlay';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/trips', label: 'Trips', icon: Plane },
  { to: '/campaigns', label: 'Campaigns', icon: Send },
  { to: '/automations', label: 'Automations', icon: Clock3 },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** The Dhrona mark: a D of target rings with an arrow in the centre. On hover the arrow strikes. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 64 64" className="shrink-0">
      <rect width="64" height="64" rx="15" fill="#4A3FD1" />
      <path d="M20 13H29.5C41.5 13 51 21.5 51 32.5S41.5 52 29.5 52H20Z" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinejoin="round" />
      <path d="M27.5 21.8H30C36 21.8 41 26.5 41 32.5S36 43.2 30 43.2H27.5Z" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="3" strokeLinejoin="round" />
      <g className="transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)] group-hover/logo:translate-x-[2px] group-hover/logo:translate-y-[2px]">
        <path d="M8.5 8.5L30.5 30.5" stroke="#4A3FD1" strokeWidth="8" strokeLinecap="round" />
        <path d="M8.5 8.5L30.5 30.5" stroke="#FF8A1F" strokeWidth="3.3" strokeLinecap="round" />
        <path d="M14.6 9.6L15.3 15.3L9.6 14.6M10.9 5.9L11.6 11.6L5.9 10.9" fill="none" stroke="#FF8A1F" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="33" cy="32.5" r="4.4" fill="#FF8A1F" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('group/logo flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[18px] font-extrabold tracking-[-0.03em]">{BRAND.name}</span>
    </span>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const whatsapp = !!useSession().tenant.features?.whatsapp;
  const { pathname } = useLocation();
  const onWhatsapp = whatsapp && pathname.startsWith('/settings/whatsapp');
  // The green highlight slides from item to item instead of jumping
  const { ref, box, animate } = useSlidingIndicator<HTMLElement>('[data-lit=true]', 'y', [pathname, whatsapp]);
  const item = (lit: boolean) =>
    cn(
      'group/nav relative z-[1] flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors duration-200',
      lit ? 'text-nav-active-ink' : 'text-nav-ink hover:bg-nav-hover',
      lit && !box && 'bg-nav-active',
    );
  const icon = 'h-[18px] w-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)] group-hover/nav:scale-110 group-active/nav:scale-95';
  return (
    <nav ref={ref} aria-label="Main" className="relative flex flex-col gap-0.5">
      {box && (
        <span
          aria-hidden
          className="absolute inset-x-0 rounded-[10px] bg-nav-active"
          style={{ top: box.offset, height: box.size, transition: animate ? `top 420ms ${SPRING}, height 420ms ${SPRING}` : 'none' }}
        >
          <span className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r-full bg-highlight" />
        </span>
      )}
      {NAV.map(({ to, label, icon: Icon, end }) => {
        const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
        // WhatsApp has its own item, so Settings stays unlit there
        const lit = active && !(to === '/settings' && onWhatsapp);
        return (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} data-lit={lit} className={item(lit)}>
            <Icon className={cn(icon, lit && 'text-highlight')} aria-hidden />
            {label}
          </NavLink>
        );
      })}
      {whatsapp ? (
        <NavLink to="/settings/whatsapp" onClick={onNavigate} data-lit={onWhatsapp} className={item(onWhatsapp)}>
          <MessageCircle className={cn(icon, onWhatsapp && 'text-highlight')} aria-hidden />
          WhatsApp
        </NavLink>
      ) : (
        <span className="flex h-10 items-center justify-between rounded-[10px] px-3 text-sm font-medium text-nav-muted opacity-70" aria-disabled>
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
  const { tenant } = useSession();
  const trial = tenant.plan?.plan === 'TRIAL';
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview'), staleTime: 30_000 });
  if (!q.data) return null;
  const { used, limit, resetsOn } = q.data.quota;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-nav-line bg-nav-card p-3.5 text-nav-ink">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold">{trial ? 'Trial emails' : 'Monthly emails'}</span>
        <span className="tnum text-nav-muted">
          <CountUp value={used} /> / {n(limit)}
        </span>
      </div>
      <ProgressBar value={used} max={limit} label="Monthly emails used" tone={used / limit > 0.9 ? 'warm' : 'highlight'} track="bg-white/15" />
      <span className="text-xs text-nav-muted">{trial ? 'Included in your free trial' : `Resets on ${date(resetsOn, { day: 'numeric', month: 'short' })}`}</span>
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
        <button type="button" className="flex w-full items-center gap-3 rounded-[12px] p-2 text-left text-nav-ink transition-colors hover:bg-nav-hover">
          <Avatar name={user.name} email={user.email} size={34} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold">{tenant.name}</span>
            <span className="truncate text-xs text-nav-muted">{user.name}</span>
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
    <aside className="hidden w-[248px] shrink-0 border-r border-nav-line bg-nav text-nav-ink lg:block">
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
        className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-left text-sm text-faint hover:border-[#cfcde6] sm:max-w-80"
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

/** Trial status: a quiet line while it runs, a clear stop once it's over. */
export function TrialBanner() {
  const { tenant } = useSession();
  const p = tenant.plan;
  if (!p || p.plan !== 'TRIAL') return null;
  const upgrade = `mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`Upgrade ${tenant.name} to the paid plan`)}`;
  if (p.trialEnded) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 rounded-[14px] bg-ink px-5 py-4 text-white">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="text-[15px] font-semibold">Your free trial has ended</strong>
          <span className="text-[13px] text-white/70">Sending is off and WhatsApp has been unlinked. Your contacts, templates and reports are safe. Upgrade to pick up where you left off.</span>
        </div>
        <a href={upgrade} className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-white px-4 text-sm font-semibold text-ink hover:bg-white/90">
          Upgrade
        </a>
      </div>
    );
  }
  const waLeft = p.whatsapp ? Math.max(0, p.whatsapp.perDay - p.whatsapp.sentToday) : null;
  const urgent = (p.daysLeft ?? 9) <= 1;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[14px] border px-4 py-2.5 text-[13px]', urgent ? 'border-[#f3c9a8] bg-warm-soft text-warm-strong' : 'border-line bg-surface text-ink-2')}>
      <span className="flex items-center gap-2 font-semibold text-ink">
        <span className={cn('h-2 w-2 rounded-full', urgent ? 'bg-warm' : 'bg-accent')} aria-hidden />
        Free trial: {p.daysLeft === 0 ? 'ends today' : `${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left`}
      </span>
      {waLeft !== null && (
        <span className="tnum">
          {n(waLeft)} of {n(p.whatsapp!.perDay)} WhatsApp messages left today
        </span>
      )}
      {p.emailLimit !== null && <span className="tnum">{n(p.emailLimit)} emails included</span>}
      <a href={upgrade} className="ml-auto font-semibold text-accent hover:text-accent-strong">
        Upgrade
      </a>
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
  const main = useRef<HTMLElement>(null);
  const firstPath = useRef(loc.pathname);

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
  // Each new page eases in. The page isn't remounted, so nothing typed is lost.
  useEffect(() => {
    if (loc.pathname === firstPath.current) return;
    firstPath.current = '';
    play(main.current, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SMOOTH });
  }, [loc.pathname]);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 px-4 pb-16 pt-5 sm:px-6 lg:px-10 lg:pt-7">
          <TopBar onSearch={() => setPalette(true)} onMenu={() => setMobileNav(true)} />
          <TrialBanner />
          <PausedBanner />
          <main ref={main} id="main" className="flex flex-col gap-6">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <Sheet open={mobileNav} onOpenChange={setMobileNav} title={<Logo />} width="max-w-[300px]" tone="nav">
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
