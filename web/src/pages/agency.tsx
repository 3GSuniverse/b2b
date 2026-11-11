import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CreditCard, KeyRound, Link2, Mail, MessageCircle, MoreHorizontal, Pencil, Power, Shield, Trash2, UserPlus, Users, Wand2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BillingSettings } from '@/components/billing';
import { planName } from '@/lib/brand';
import { Button, LinkButton } from '@/components/ui/button';
import { Avatar, Badge, CopyButton, EmptyState, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { burst } from '@/lib/celebrate';
import { cn } from '@/lib/cn';
import { ago } from '@/lib/format';
import { CountUp, useMounted } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { tx } from '../lib/words';

/**
 * The agency console: only the agency owner (the account that signed up) sees it.
 * Like an AWS root user, the owner creates employee logins here, sees what each person sends,
 * and pays for the plan. Employees sign in with the agency ID and their username.
 */

type Role = 'OWNER' | 'ADMIN' | 'MEMBER';
type Usage = { email: number; whatsapp: number; broadcasts: number; trips: number };
type Person = { id: string; name: string; username: string | null; email: string | null; role: Role; disabled: boolean; lastLoginAt: string | null; createdAt: string; usage: Usage };
type Agency = {
  agency: { name: string; loginCode: string };
  seats: { used: number; limit: number };
  people: Person[];
  automatic: Usage;
  totals: { email: number; whatsapp: number };
};

const ROLE: Record<Role, { label: string; tone: 'blue' | 'orange' | 'grey' }> = {
  OWNER: { label: tx("Agency owner"), tone: 'blue' },
  ADMIN: { label: 'Manager', tone: 'orange' },
  MEMBER: { label: 'Employee', tone: 'grey' },
};

const signInLink = (code: string) => `${location.origin}/signin/${code}`;

/** A password that's easy to read out over the phone: three short words and two digits. */
function makePassword() {
  const words = ['ganga', 'kashi', 'tirupati', 'goa', 'kerala', 'munnar', 'ooty', 'hampi', 'puri', 'leh', 'agra', 'mysore', 'shirdi', 'vizag', 'araku', 'coorg'];
  const r = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
  const a = r() % words.length;
  const b = (a + 1 + (r() % (words.length - 1))) % words.length;
  return `${words[a]}-${words[b]}-${(r() % 90) + 10}`;
}

function OwnerOnly({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user.role !== 'OWNER') {
    return (
      <EmptyState icon={<Shield />} title={tx("Only the agency owner can open this")}>
        {tx("Your agency owner manages logins and the plan. Ask them if you need something changed.")}
      </EmptyState>
    );
  }
  return <>{children}</>;
}

export function AgencyPage() {
  return (
    <OwnerOnly>
      <AgencyConsole />
    </OwnerOnly>
  );
}

export function AgencyBillingPage() {
  return (
    <OwnerOnly>
      <div className="flex flex-col gap-6">
        <PageHeader title="Plan & billing" description="Choose a plan and exactly how many employee logins you need. Both stay fixed for the billing cycle you pay for." back={<Link to="/agency">{tx("Agency")}</Link>} />
        <BillingSettings />
      </div>
    </OwnerOnly>
  );
}

function AgencyConsole() {
  const { tenant } = useSession();
  const q = useQuery({ queryKey: ['agency'], queryFn: () => api.get<Agency>('/api/agency') });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [resetting, setResetting] = useState<Person | null>(null);
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);

  if (q.isPending) return <Skeleton className="h-[560px]" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger">{tx("Couldn’t load your agency. Refresh to try again.")}</p>;
  const a = q.data;
  const employees = a.people.filter((p) => p.role !== 'OWNER');
  const full = a.seats.used >= a.seats.limit;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={a.agency.name}
        description={tx("Your agency: who can sign in, what each person sends, and your plan.")}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} disabled={full}>
            <UserPlus className="h-4 w-4" /> Add employee
          </Button>
        }
      />

      <div className="stagger grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <PlanCard seats={a.seats} />
        <SeatsCard seats={a.seats} onAdd={() => setAdding(true)} />
        <SignInCard code={a.agency.loginCode} />
      </div>

      <Panel className="flex flex-col">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[17px] font-semibold">Your team this month</h2>
            <p className="text-[13px] text-muted">{tx("Messages each person sent since the 1st, the broadcasts they started and the trips they added.")}</p>
          </div>
          <div className="flex gap-5 text-sm">
            <span className="flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-accent" /> <b className="tnum"><CountUp value={a.totals.email} /></b> emails
            </span>
            <span className="flex items-center gap-1.5">
              <MessageCircle className="h-4 w-4 text-success" /> <b className="tnum"><CountUp value={a.totals.whatsapp} /></b> WhatsApp
            </span>
          </div>
        </div>
        <TeamTable a={a} onEdit={setEditing} onReset={setResetting} />
        {employees.length === 0 && (
          <div className="border-t border-line-soft px-5 py-8 sm:px-6">
            <EmptyState
              icon={<Users />}
              title="Add the people who work with you"
              action={
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <UserPlus className="h-4 w-4" /> Add your first employee
                </Button>
              }
            >
              {tx("Give each employee their own username and password. They sign in as “Employee” with your agency ID")} <b>{a.agency.loginCode}</b>, and you’ll see what each of them sends here.
            </EmptyState>
          </div>
        )}
      </Panel>

      <AddEmployeeDialog open={adding} onClose={() => setAdding(false)} loginCode={a.agency.loginCode} onCreated={setCreated} />
      <EditDialog person={editing} onClose={() => setEditing(null)} />
      <ResetDialog person={resetting} onClose={() => setResetting(null)} onDone={(p, password) => setCreated({ name: p.name, username: p.username ?? '', password })} />
      <LoginDetailsDialog details={created} loginCode={a.agency.loginCode} agencyName={tenant.name} onClose={() => setCreated(null)} />
    </div>
  );
}

function CardShell({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <Panel className={cn('lift flex flex-col gap-3 p-5', className)}>
      <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {title}
      </span>
      {children}
    </Panel>
  );
}

function PlanCard({ seats }: { seats: Agency['seats'] }) {
  const { tenant } = useSession();
  const p = tenant.plan;
  const name = p?.plan === 'PAID' ? (p.planId ? planName(p.planId) : 'Paid plan') : 'Free trial';
  const sub =
    p?.plan === 'PAID'
      ? p.paidUntil
        ? `Paid until ${new Date(p.paidUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : 'Active'
      : p?.trialEnded
        ? 'Ended. Sending is off.'
        : `${p?.daysLeft ?? 0} ${p?.daysLeft === 1 ? 'day' : 'days'} left`;
  return (
    <CardShell icon={<CreditCard />} title="Plan">
      <div className="flex flex-col">
        <span className="text-[22px] font-extrabold tracking-[-0.02em]">{name}</span>
        <span className={cn('text-sm', p?.trialEnded ? 'font-semibold text-danger' : 'text-ink-2')}>{sub}</span>
      </div>
      <span className="text-xs text-muted">{seats.limit} employee login{seats.limit === 1 ? '' : 's'}{p?.plan === 'PAID' ? '' : ' on the trial'}</span>
      <LinkButton to="/agency/billing" size="sm" variant={p?.plan === 'PAID' ? 'secondary' : 'primary'} className="mt-auto self-start">
        {p?.plan === 'PAID' ? 'Plan & billing' : 'Choose a plan'}
      </LinkButton>
    </CardShell>
  );
}

function SeatsCard({ seats, onAdd }: { seats: Agency['seats']; onAdd: () => void }) {
  const mounted = useMounted();
  const pct = Math.min(1, seats.used / Math.max(1, seats.limit));
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <CardShell icon={<Users />} title="Employee logins">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90" aria-hidden>
          <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth="8" />
          <circle
            cx="36"
            cy="36"
            r={r}
            fill="none"
            stroke={pct >= 1 ? 'var(--color-warm-chart)' : 'var(--color-accent)'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${mounted ? pct * c : 0} ${c}`}
            className="transition-[stroke-dasharray] duration-1000 ease-out"
          />
        </svg>
        <div className="flex flex-col">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">
            <CountUp value={seats.used} /> <span className="text-base font-semibold text-muted">of {seats.limit}</span>
          </span>
          <span className="text-sm text-ink-2">{seats.used >= seats.limit ? 'All logins in use' : `${seats.limit - seats.used} more you can add`}</span>
        </div>
      </div>
      {seats.used >= seats.limit ? (
        <LinkButton to="/agency/billing" size="sm" variant="secondary" className="mt-auto self-start">
          Get more logins
        </LinkButton>
      ) : (
        <Button size="sm" variant="secondary" onClick={onAdd} className="mt-auto self-start">
          <UserPlus className="h-4 w-4" /> Add employee
        </Button>
      )}
    </CardShell>
  );
}

function SignInCard({ code }: { code: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const m = useMutation({
    mutationFn: () => api.patch<{ loginCode: string }>('/api/agency/id', { loginCode: value }),
    onSuccess: () => {
      setEditing(false);
      toast.success(tx("Agency ID changed"), { description: 'Tell your employees: they sign in with the new one from now on.' });
      qc.invalidateQueries({ queryKey: ['agency'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <CardShell icon={<Link2 />} title="How employees sign in">
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field label={tx("Agency ID")} error={m.error instanceof ApiError ? m.error.field('loginCode') ?? m.error.message : undefined}>
            {(p) => <Input {...p} autoFocus autoCapitalize="none" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value.toLowerCase())} />}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" loading={m.isPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setValue(code))}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted">{tx("Agency ID")}</span>
              <span className="truncate text-lg font-bold tracking-[-0.01em]">{code}</span>
            </span>
            <button type="button" onClick={() => setEditing(true)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={tx("Change agency ID")}>
              <Pencil className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-[10px] bg-sunken px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{signInLink(code).replace(/^https?:\/\//, '')}</span>
            <CopyButton value={signInLink(code)} label="Copy link" />
          </div>
          <p className="text-xs text-muted">{tx("Share this link: it opens the employee sign-in with your agency ID filled in.")}</p>
        </>
      )}
    </CardShell>
  );
}

/** Each person, with a bar of what they sent next to the busiest person's. */
function TeamTable({ a, onEdit, onReset }: { a: Agency; onEdit: (p: Person) => void; onReset: (p: Person) => void }) {
  const mounted = useMounted();
  const qc = useQueryClient();
  const busiest = Math.max(1, ...a.people.map((p) => p.usage.email + p.usage.whatsapp), a.automatic.email + a.automatic.whatsapp);
  const toggle = useMutation({
    mutationFn: (p: Person) => api.patch(`/api/agency/employees/${p.id}`, { disabled: !p.disabled }),
    onSuccess: (_r, p) => {
      toast.success(p.disabled ? `${p.name} can sign in again` : `${p.name} is switched off`, { description: p.disabled ? undefined : 'They’ve been signed out, and their login no longer counts towards your plan.' });
      qc.invalidateQueries({ queryKey: ['agency'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (p: Person) => api.del(`/api/agency/employees/${p.id}`),
    onSuccess: (_r, p) => {
      toast.success(`${p.name} was removed`, { description: tx("Their trips and messages stay.") });
      qc.invalidateQueries({ queryKey: ['agency'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [confirm, setConfirm] = useState<Person | null>(null);

  const bar = (u: Usage) => {
    const e = (u.email / busiest) * 100;
    const w = (u.whatsapp / busiest) * 100;
    return (
      <span className="flex h-2 w-[140px] overflow-hidden rounded-full bg-line-soft" aria-hidden>
        <span className="h-full bg-accent transition-[width] duration-700 ease-out" style={{ width: mounted ? `${e}%` : 0 }} />
        <span className="h-full bg-success transition-[width] delay-150 duration-700 ease-out" style={{ width: mounted ? `${w}%` : 0 }} />
      </span>
    );
  };

  return (
    <div className="overflow-x-auto border-t border-line-soft">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line-soft">
            <th className="px-5 py-2.5 font-medium sm:px-6">Person</th>
            <th className="px-3 py-2.5 text-right font-medium">Emails</th>
            <th className="px-3 py-2.5 text-right font-medium">WhatsApp</th>
            <th className="px-3 py-2.5 font-medium" aria-label="Share of messages" />
            <th className="px-3 py-2.5 text-right font-medium">Broadcasts</th>
            <th className="px-3 py-2.5 text-right font-medium">{tx("Trips added")}</th>
            <th className="px-3 py-2.5 font-medium">Last signed in</th>
            <th className="w-12 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="stagger">
          {a.people.map((p) => (
            <tr key={p.id} className={cn('border-b border-line-soft transition-colors hover:bg-sunken/60', p.disabled && 'opacity-55')}>
              <td className="px-5 py-3 sm:px-6">
                <span className="flex items-center gap-3">
                  <Avatar name={p.name} email={p.email} size={34} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 font-semibold">
                      {p.name}
                      <Badge tone={ROLE[p.role].tone}>{tx(ROLE[p.role].label)}</Badge>
                      {p.disabled && <Badge tone="red">Switched off</Badge>}
                    </span>
                    <span className="truncate text-xs text-muted">{p.role === 'OWNER' ? p.email : `@${p.username}`}</span>
                  </span>
                </span>
              </td>
              <td className="tnum px-3 py-3 text-right font-semibold">
                <CountUp value={p.usage.email} />
              </td>
              <td className="tnum px-3 py-3 text-right font-semibold">
                <CountUp value={p.usage.whatsapp} />
              </td>
              <td className="px-3 py-3">{bar(p.usage)}</td>
              <td className="tnum px-3 py-3 text-right">{p.usage.broadcasts}</td>
              <td className="tnum px-3 py-3 text-right">{p.usage.trips}</td>
              <td className="whitespace-nowrap px-3 py-3 text-ink-2">{p.lastLoginAt ? ago(p.lastLoginAt) : <span className="text-muted">Not yet</span>}</td>
              <td className="px-3 py-3 text-right">
                {p.role !== 'OWNER' && (
                  <Menu
                    trigger={
                      <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for ${p.name}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    }
                  >
                    <MenuItem icon={<Pencil />} onSelect={() => onEdit(p)}>
                      Edit name or role
                    </MenuItem>
                    <MenuItem icon={<KeyRound />} onSelect={() => onReset(p)}>
                      Set a new password
                    </MenuItem>
                    <MenuItem icon={<Power />} onSelect={() => toggle.mutate(p)}>
                      {p.disabled ? 'Switch on again' : 'Switch off'}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirm(p)}>
                      Remove
                    </MenuItem>
                  </Menu>
                )}
              </td>
            </tr>
          ))}
          <tr className="bg-sunken/50">
            <td className="px-5 py-3 sm:px-6">
              <span className="flex items-center gap-3">
                <span className="ai-orb grid h-[34px] w-[34px] place-items-center rounded-full bg-accent-soft text-accent">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold">Sent automatically</span>
                  <span className="text-xs text-muted">{tx("Payment reminders, trip messages, automations")}</span>
                </span>
              </span>
            </td>
            <td className="tnum px-3 py-3 text-right font-semibold">
              <CountUp value={a.automatic.email} />
            </td>
            <td className="tnum px-3 py-3 text-right font-semibold">
              <CountUp value={a.automatic.whatsapp} />
            </td>
            <td className="px-3 py-3">{bar(a.automatic)}</td>
            <td className="px-3 py-3" />
            <td className="px-3 py-3" />
            <td className="px-3 py-3" />
            <td />
          </tr>
        </tbody>
      </table>
      <div className="flex flex-wrap gap-4 px-5 py-3 text-xs text-muted sm:px-6">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" /> Emails
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" /> WhatsApp
        </span>
      </div>
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.name}?`}
        description={tx("Their login is deleted. The trips, customers and messages they worked on stay. To keep the login for later, switch it off instead.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(confirm!);
                setConfirm(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}

const usernameFrom = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]!
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30);

function AddEmployeeDialog({ open, onClose, loginCode, onCreated }: { open: boolean; onClose: () => void; loginCode: string; onCreated: (d: { name: string; username: string; password: string }) => void }) {
  const qc = useQueryClient();
  const empty = { name: '', username: '', password: makePassword(), role: 'MEMBER' as 'MEMBER' | 'ADMIN', email: '' };
  const [f, setF] = useState(empty);
  const [touchedUsername, setTouched] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post<{ member: Person }>('/api/agency/employees', f),
    onSuccess: ({ member }) => {
      qc.invalidateQueries({ queryKey: ['agency'] });
      qc.invalidateQueries({ queryKey: ['team'] });
      onClose();
      onCreated({ name: member.name, username: member.username!, password: f.password });
      setF({ ...empty, password: makePassword() });
      setTouched(false);
    },
  });
  const err = (k: string) => (m.error instanceof ApiError ? m.error.field(k) : undefined);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add an employee"
      description={
        <>
          They’ll sign in as <b>Employee</b> {tx("with agency ID")} <b>{loginCode}</b> and the username and password below.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            <UserPlus className="h-4 w-4" /> Add employee
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {m.error && !(m.error instanceof ApiError && m.error.details) && <p className="rounded-[10px] bg-danger-soft px-3 py-2 text-sm text-danger">{m.error.message}</p>}
        <Field label="Name" error={err('name')}>
          {(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, username: touchedUsername ? f.username : usernameFrom(e.target.value) })} placeholder="Ravi Kumar" />}
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field label="Username" error={err('username')}>
            {(p) => (
              <Input
                {...p}
                autoCapitalize="none"
                spellCheck={false}
                value={f.username}
                onChange={(e) => {
                  setTouched(true);
                  setF({ ...f, username: e.target.value.toLowerCase() });
                }}
                placeholder="ravi"
              />
            )}
          </Field>
          <Field label="Password" hint="Share it with them; they can change it later." error={err('password')}>
            {(p) => (
              <span className="flex gap-2">
                <Input {...p} spellCheck={false} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
                <Button size="sm" variant="secondary" onClick={() => setF({ ...f, password: makePassword() })} aria-label="Make a new password" className="h-10 shrink-0 px-2.5">
                  <Wand2 className="h-4 w-4" />
                </Button>
              </span>
            )}
          </Field>
        </div>
        <Field label="Role" hint={f.role === 'ADMIN' ? 'Can also change settings: sending addresses, WhatsApp, payments, and delete customers.' : tx('Trips, quotes, customers, broadcasts and messages. No settings.')}>
          {(p) => (
            <NativeSelect {...p} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'MEMBER' | 'ADMIN' })}>
              <option value="MEMBER">Employee</option>
              <option value="ADMIN">Manager</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="Email (optional)" hint="Only for your records; they sign in with the username." error={err('email')}>
          {(p) => <Input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ravi@yourdomain.com" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function LoginDetailsDialog({ details, loginCode, agencyName, onClose }: { details: { name: string; username: string; password: string } | null; loginCode: string; agencyName: string; onClose: () => void }) {
  if (!details) return null;
  const text = `Your ${agencyName} login for Dhrona\nOpen: ${signInLink(loginCode)}\nSign in as Employee\nAgency ID: ${loginCode}\nUsername: ${details.username}\nPassword: ${details.password}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${details.name}’s login is ready`}
      description="Send these to them now. For safety, the password isn’t shown again."
      footer={
        <>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-button)] border border-line px-4 text-sm font-semibold hover:bg-sunken"
          >
            <MessageCircle className="h-4 w-4 text-success" /> Send on WhatsApp
          </a>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div
        ref={(el) => {
          if (el) burst(el);
        }}
        className="flex flex-col gap-0 overflow-hidden rounded-[14px] border border-line"
      >
        {[
          ['Sign-in link', signInLink(loginCode)],
          [tx('Agency ID'), loginCode],
          ['Username', details.username],
          ['Password', details.password],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5 last:border-0">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted">{k}</span>
              <span className="truncate font-semibold">{v}</span>
            </span>
            <CopyButton value={v!} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <CopyButton value={text} label="Copy all" />
      </div>
    </Dialog>
  );
}

function EditDialog({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<{ name: string; role: 'MEMBER' | 'ADMIN' } | null>(null);
  const cur = f ?? (person ? { name: person.name, role: person.role === 'ADMIN' ? ('ADMIN' as const) : ('MEMBER' as const) } : null);
  const m = useMutation({
    mutationFn: () => api.patch(`/api/agency/employees/${person!.id}`, cur!),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['agency'] });
      setF(null);
      onClose();
    },
  });
  if (!person || !cur) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && (setF(null), onClose())}
      title={`Edit ${person.name}`}
      description={`Username @${person.username} stays the same.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => (setF(null), onClose())}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">{(p) => <Input {...p} value={cur.name} onChange={(e) => setF({ ...cur, name: e.target.value })} />}</Field>
        <Field label="Role">
          {(p) => (
            <NativeSelect {...p} value={cur.role} onChange={(e) => setF({ ...cur, role: e.target.value as 'MEMBER' | 'ADMIN' })}>
              <option value="MEMBER">Employee</option>
              <option value="ADMIN">Manager</option>
            </NativeSelect>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function ResetDialog({ person, onClose, onDone }: { person: Person | null; onClose: () => void; onDone: (p: Person, password: string) => void }) {
  const [password, setPassword] = useState(makePassword);
  const m = useMutation({
    mutationFn: () => api.patch(`/api/agency/employees/${person!.id}`, { password }),
    onSuccess: () => {
      onClose();
      onDone(person!, password);
      setPassword(makePassword());
    },
  });
  if (!person) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`New password for ${person.name}`}
      description="They’ll be signed out everywhere and use this password from now on."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Set password
          </Button>
        </>
      }
    >
      <Field label="New password" error={m.error instanceof ApiError ? (m.error.field('password') ?? m.error.message) : undefined}>
        {(p) => (
          <span className="flex gap-2">
            <Input {...p} spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => setPassword(makePassword())} aria-label="Make a new password" className="h-10 shrink-0 px-2.5">
              <Wand2 className="h-4 w-4" />
            </Button>
          </span>
        )}
      </Field>
    </Dialog>
  );
}

