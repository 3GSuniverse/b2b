import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, Clock3, Headset, KeyRound, Mail, FileText, LayoutDashboard, LogOut, Megaphone, Menu as MenuIcon, MessageCircle, MessageSquarePlus, Plane, Plus, Repeat2, Search, Settings, UserPlus, Users } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { date, n } from '@/lib/format';
import { CountUp, play, SMOOTH, SPRING, useSlidingIndicator } from '@/lib/motion';
import { useCurrentNavSection, type NavSection } from '@/lib/section';
import { useSession } from '@/lib/session';
import type { Overview } from '@/lib/types';
import { CommandPalette } from './command-palette';
import { NotificationsButton } from './notifications';
import { Button, LinkButton } from './ui/button';
import { Field, Input } from './ui/field';
import { Avatar, Badge, Kbd, ProgressBar } from './ui/display';
import { Dialog, Menu, MenuItem, MenuSeparator, Sheet, Tooltip } from './ui/overlay';

// The sidebar: home, the two master tabs (Email, WhatsApp), the day-to-day work, then the agency
type Role = 'OWNER' | 'ADMIN' | 'MEMBER';
type NavDef = { to: string; label: string; icon: typeof Plane; end?: boolean; group?: string; anim: string; roles?: Role[]; also?: string[]; section?: NavSection; dot?: string };
const NAV: NavDef[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true, anim: 'nav-pop' },
  { to: '/email', label: 'Email', icon: Mail, group: 'Send to customers', anim: 'nav-shout', also: ['/templates'], section: 'email', dot: '#8f86ff' },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, anim: 'nav-wiggle', section: 'whatsapp', dot: '#25c48a' },
  { to: '/trips', label: 'Trips', icon: Plane, group: 'Your work', anim: 'nav-fly', also: ['/groups'] },
  { to: '/contacts', label: 'Customers', icon: Users, anim: 'nav-hop' },
  { to: '/agency', label: 'Agency', icon: Building2, group: 'Your agency', anim: 'nav-pop', roles: ['OWNER'] },
  { to: '/settings', label: 'Settings', icon: Settings, anim: 'nav-spin', roles: ['OWNER', 'ADMIN'] },
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
  const { user, tenant } = useSession();
  const section = useCurrentNavSection();
  // Customers waiting for a reply on WhatsApp
  const waUnread = useQuery({
    queryKey: ['inbox', 'unread'],
    queryFn: () => api.get<{ chats: number; messages: number }>('/api/inbox/unread'),
    refetchInterval: 15_000,
    enabled: !!tenant.features?.whatsapp,
  }).data?.chats;
  const nav = NAV.filter((x) => !x.roles || x.roles.includes(user.role as Role));
  // The agency group needs a heading only when it has something in it
  const groups = nav.map((x, i) => (x.roles && !nav.slice(0, i).some((y) => y.roles) ? { ...x, group: 'Your agency' } : x));
  const { pathname } = useLocation();
  // The highlight slides from item to item instead of jumping
  const { ref, box, animate } = useSlidingIndicator<HTMLElement>('[data-lit=true]', 'y', [pathname, section]);
  const item = (lit: boolean) =>
    cn(
      'group/nav relative z-[1] flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors duration-200',
      lit ? 'text-nav-active-ink' : 'text-nav-ink hover:bg-nav-hover',
      lit && !box && 'bg-nav-active',
    );
  const icon = 'h-[18px] w-[18px] shrink-0';
  const isLit = (x: NavDef) => {
    if (x.section && section) return x.section === section;
    if (x.end) return pathname === x.to && !section;
    return [x.to, ...(x.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  };
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
      {groups.map((x) => {
        const { to, label, icon: Icon, end, group, anim, dot } = x;
        const lit = isLit(x);
        return (
          <Fragment key={to}>
            {group && <span className="px-3 pb-1 pt-4 text-[12px] font-semibold text-nav-muted">{group}</span>}
            <NavLink to={to} end={end} onClick={onNavigate} data-lit={lit} className={item(lit)}>
              <Icon className={cn(icon, anim, lit && 'text-highlight')} aria-hidden />
              {label}
              {to === '/whatsapp' && waUnread ? (
                <span className="tnum ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#25c48a] px-1.5 text-[11px] font-bold text-white" aria-label={`${waUnread} unread`}>
                  {waUnread}
                </span>
              ) : (
                dot && <span className="ml-auto h-2 w-2 rounded-full opacity-80" style={{ background: dot }} aria-hidden />
              )}
            </NavLink>
          </Fragment>
        );
      })}
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
  const [pw, setPw] = useState(false);
  const loc = useLocation();
  const signOut = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: () => {
      qc.clear();
      nav('/signin', { replace: true });
    },
  });
  return (
    <>
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
        <p className="text-xs text-muted">{user.role === 'OWNER' ? `Agency owner · ${user.email}` : `@${user.username} at ${tenant.loginCode}`}</p>
      </div>
      <MenuSeparator />
      {user.role === 'OWNER' && <MenuItem icon={<Building2 />} onSelect={() => nav('/agency')}>Agency, logins and plan</MenuItem>}
      {user.role !== 'MEMBER' && <MenuItem icon={<Settings />} onSelect={() => nav('/settings/company')}>Settings</MenuItem>}
      <MenuItem icon={<Headset />} onSelect={() => nav(careLink(loc.pathname))}>Contact customer care</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<KeyRound />} onSelect={() => setPw(true)}>Change my password</MenuItem>
      <MenuItem icon={<LogOut />} onSelect={() => signOut.mutate()}>Sign out</MenuItem>
    </Menu>
    <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </>
  );
}

/** Anyone can change their own password; their other devices are signed out. */
function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ current: '', next: '' });
  const m = useMutation({
    mutationFn: () => api.post('/api/auth/password', f),
    onSuccess: () => {
      toast.success('Password changed', { description: 'Other devices were signed out.' });
      setF({ current: '', next: '' });
      onClose();
    },
  });
  const err = (k: string) => (m.error instanceof ApiError ? (m.error.field(k) ?? (k === 'current' && m.error.code === 'wrong_password' ? m.error.message : undefined)) : undefined);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    m.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Change my password"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={() => submit()}>
            Change password
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Current password" error={err('current')}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" autoFocus value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />}
        </Field>
        <Field label="New password" hint="At least 8 characters." error={err('next')}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
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

/** One button for everything new: an enquiry, a message to many, an automatic message, a customer. */
function CreateMenu() {
  const nav = useNavigate();
  const items = [
    { icon: <MessageSquarePlus />, label: 'New enquiry', note: 'A trip someone asked about', to: '/trips?new=1' },
    { icon: <Mail />, label: 'Email broadcast', note: 'One email to many customers', to: '/campaigns/new' },
    { icon: <MessageCircle />, label: 'WhatsApp broadcast', note: 'One WhatsApp message to many customers', to: '/campaigns/new?channel=WHATSAPP' },
    { icon: <Repeat2 />, label: 'Automatic message', note: 'Birthdays, anniversaries, any date', to: '/automations?new=1' },
    { icon: <UserPlus />, label: 'Customer', note: 'Add someone to your address book', to: '/contacts?add=1' },
  ];
  return (
    <Menu
      trigger={
        <button
          type="button"
          className="group/create inline-flex h-11 items-center gap-2 rounded-[var(--radius-button)] bg-primary px-3 text-sm font-semibold text-on-primary shadow-[inset_0_-1px_0_rgb(0_0_0/0.2)] transition-[background,transform,box-shadow] duration-200 hover:bg-primary-hover hover:shadow-[0_6px_16px_-6px_var(--color-primary)] active:scale-[0.97] data-[state=open]:bg-primary-hover sm:px-4"
          aria-label="Create"
        >
          <Plus className="h-[18px] w-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)] group-data-[state=open]/create:rotate-45" strokeWidth={2.4} />
          <span className="hidden sm:inline">Create</span>
          <ChevronDown className="hidden h-4 w-4 opacity-70 transition-transform duration-200 group-data-[state=open]/create:rotate-180 sm:inline" />
        </button>
      }
    >
      <div className="stagger flex w-72 flex-col">
        {items.map((it) => (
          <MenuItem key={it.to} icon={it.icon} onSelect={() => nav(it.to)}>
            <span className="flex flex-col">
              <span className="font-semibold">{it.label}</span>
              <span className="text-xs text-muted">{it.note}</span>
            </span>
          </MenuItem>
        ))}
      </div>
    </Menu>
  );
}

/** Where "Contact customer care" goes: a new request that knows which page you were on. */
const careLink = (from: string) => (from.startsWith('/help') ? '/help' : `/help/new?from=${encodeURIComponent(from)}`);

/** The headset at the top: opens customer care, with a dot when they've replied. */
function CareButton() {
  const { pathname } = useLocation();
  const unread = useQuery({ queryKey: ['support', 'unread'], queryFn: () => api.get<{ unread: number }>('/api/support/unread'), refetchInterval: 45_000 }).data?.unread ?? 0;
  return (
    <Tooltip content={unread ? 'Customer care replied' : 'Contact customer care'} side="bottom">
      <Link
        to={unread ? '/help' : careLink(pathname)}
        aria-label={unread ? `Customer care, ${unread} new ${unread === 1 ? 'reply' : 'replies'}` : 'Contact customer care'}
        className="group/care relative grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-ink-2 transition-transform duration-200 hover:bg-sunken active:scale-95"
      >
        <Headset className="h-[18px] w-[18px] transition-transform duration-300 group-hover/care:-rotate-12" />
        {unread > 0 && (
          <span key={unread} className="tnum absolute -right-1 -top-1 grid h-5 min-w-5 animate-check place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-white ring-2 ring-ground">
            {unread}
          </span>
        )}
      </Link>
    </Tooltip>
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
        <span className="min-w-0 flex-1 truncate">Search customers, trips, broadcasts…</span>
        <span className="hidden sm:inline">
          <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-2.5">
        <CareButton />
        <NotificationsButton />
        <CreateMenu />
      </div>
    </div>
  );
}

/** Trial status: a quiet line while it runs, a clear stop once it's over. */
export function TrialBanner() {
  const { tenant, user } = useSession();
  const p = tenant.plan;
  if (!p || p.plan !== 'TRIAL') return null;
  const upgrade = '/agency/billing';
  const owner = user.role === 'OWNER';
  if (p.trialEnded) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 rounded-[14px] bg-ink px-5 py-4 text-white">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="text-[15px] font-semibold">{p.planId ? 'Your plan has ended' : 'Your free trial has ended'}</strong>
          <span className="text-[13px] text-white/70">
            {p.planId ? 'Sending is off until you renew.' : 'Sending is off and WhatsApp has been unlinked.'} Your customers, trips, templates and reports are safe.{' '}
            {owner ? `${p.planId ? 'Renew' : 'Choose a plan'} to pick up where you left off.` : ''}
          </span>
        </div>
        {owner ? (
          <Link to={upgrade} className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-white px-4 text-sm font-semibold text-ink hover:bg-white/90">
            {p.planId ? 'Renew' : 'Choose a plan'}
          </Link>
        ) : (
          <span className="text-[13px] font-semibold text-white/85">Ask your agency owner to {p.planId ? 'renew' : 'choose a plan'}.</span>
        )}
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
      {owner && (
        <Link to={upgrade} className="ml-auto font-semibold text-accent hover:text-accent-strong">
          Choose a plan
        </Link>
      )}
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
