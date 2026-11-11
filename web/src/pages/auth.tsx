import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DispatchPanel } from '@/components/auth/dispatch-panel';
import { Logo } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { takeoff } from '@/lib/celebrate';
import type { Me } from '@/lib/types';
import { BUSINESS_TYPES } from '@/lib/words';

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-12" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1.5 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Sign-in and sign-up share this frame, so the map keeps flying when you switch between them. */
export function AuthShell() {
  const { pathname } = useLocation();
  return (
    <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-6 lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-2 py-4 sm:px-8 lg:overflow-y-auto lg:px-14">
        <Link to="/" className="auth-rise self-start" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <main key={pathname} className="flex flex-1 flex-col justify-center py-12">
          <Outlet />
        </main>
        <p className="auth-rise flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint" style={{ '--d': '420ms' } as React.CSSProperties}>
          <span>
            Need help? <a className="font-medium text-muted hover:text-ink" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
          </span>
          <Link className="font-medium text-muted hover:text-ink" to="/privacy">Privacy</Link>
          <Link className="font-medium text-muted hover:text-ink" to="/terms">Terms</Link>
        </p>
      </div>
      <DispatchPanel />
    </div>
  );
}

/** Heading, form, and the link to the other page, arriving one after another. */
function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer: ReactNode }) {
  const step = (n: number) => ({ '--d': `${60 + n * 70}ms` }) as React.CSSProperties;
  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col gap-8">
      <div className="auth-rise flex flex-col gap-2" style={step(0)}>
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
        <p className="text-[15px] text-muted">{subtitle}</p>
      </div>
      <div className="auth-rise" style={step(1)}>
        {children}
      </div>
      <p className="auth-rise text-sm text-muted" style={step(2)}>
        {footer}
      </p>
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error || (error instanceof ApiError && error.details?.fields)) return null;
  return (
    <div role="alert" className="rounded-[12px] border border-[#f4c7c2] bg-danger-soft px-4 py-3 text-sm text-danger">
      {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
    </div>
  );
}

const fieldErr = (e: unknown, f: string) => (e instanceof ApiError ? e.field(f) : undefined);

function useAfterAuth() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  return (me: Me) => {
    qc.setQueryData(['me'], me);
    const next = params.get('next');
    // The agency owner starts in the agency console; employees go straight to work
    const home = me.user.role === 'OWNER' ? '/agency' : '/';
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : home, { replace: true });
  };
}

type Who = 'owner' | 'employee';

/**
 * One sign-in page, two kinds of login (like AWS root and IAM users): the agency owner signs in
 * with an email; an employee with the agency ID, a username and the password the owner gave them.
 * /signin/<agency-id> opens the employee form with the agency ID filled in.
 */
export function SignInPage() {
  const done = useAfterAuth();
  const { agency: fromLink } = useParams();
  const [who, setWho] = useState<Who>(() => {
    if (fromLink) return 'employee';
    try {
      return (localStorage.getItem('dhrona.signin') as Who) || 'owner';
    } catch {
      return 'owner';
    }
  });
  const [form, setForm] = useState(() => {
    let agency = fromLink ?? '';
    try {
      agency ||= localStorage.getItem('dhrona.agency') ?? '';
    } catch {
      /* private window */
    }
    return { email: '', password: '', agency, username: '' };
  });
  const m = useMutation({
    mutationFn: () =>
      api.post<Me>('/api/auth/login', who === 'owner' ? { email: form.email, password: form.password } : { agency: form.agency, username: form.username, password: form.password }),
    onSuccess: (me) => {
      try {
        localStorage.setItem('dhrona.signin', who);
        if (who === 'employee') localStorage.setItem('dhrona.agency', form.agency.trim().toLowerCase());
      } catch {
        /* private window */
      }
      takeoff(); // a small send-off into the app
      done(me);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <AuthLayout
      title="Welcome back"
      subtitle={`Sign in to ${BRAND.name}.`}
      footer={
        who === 'owner' ? (
          <>
            New here? <Link to="/signup" className="font-semibold text-accent hover:text-accent-strong">Start a free trial</Link>
          </>
        ) : (
          <>Forgot your password? Ask your agency owner to set a new one.</>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Segmented
          label="Who is signing in"
          value={who}
          onChange={(v) => {
            setWho(v);
            m.reset();
          }}
          options={[
            { value: 'owner', label: 'Agency owner' },
            { value: 'employee', label: 'Employee' },
          ]}
        />
        <FormError error={m.error} />
        {who === 'owner' ? (
          <Field label="Email" error={fieldErr(m.error, 'email')}>
            {(p) => <Input {...p} type="email" autoComplete="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />}
          </Field>
        ) : (
          <>
            <Field label="Agency ID" hint="Your agency owner can tell you this." error={fieldErr(m.error, 'agency')}>
              {(p) => <Input {...p} autoComplete="organization" autoCapitalize="none" spellCheck={false} autoFocus={!form.agency} value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} placeholder="kurukshetra-travels" />}
            </Field>
            <Field label="Username" error={fieldErr(m.error, 'username')}>
              {(p) => <Input {...p} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!!form.agency} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ravi" />}
            </Field>
          </>
        )}
        <Field label="Password" error={fieldErr(m.error, 'password')}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={m.isPending} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SignUpPage() {
  const done = useAfterAuth();
  const [form, setForm] = useState({ companyName: '', businessType: 'TRAVEL', name: '', email: '', password: '' });
  const travel = form.businessType === 'TRAVEL';
  const noun = travel ? 'agency' : 'business';
  const m = useMutation({ mutationFn: () => api.post<Me>('/api/auth/signup', form), onSuccess: done });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <AuthLayout
      title={`Set up your ${noun}`}
      subtitle={`Create the ${noun} owner’s login. You’ll add your employees next. ${BRAND.trialDays} days free, no card needed.`}
      footer={
        <>
          Already have an account? <Link to="/signin" className="font-semibold text-accent hover:text-accent-strong">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError error={m.error} />
        <Field label="What kind of business is it?" error={fieldErr(m.error, 'businessType')}>
          {(p) => (
            <NativeSelect {...p} value={form.businessType} onChange={set('businessType')}>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={travel ? 'Agency name' : 'Business name'} error={fieldErr(m.error, 'companyName')}>
          {(p) => <Input {...p} autoComplete="organization" autoFocus value={form.companyName} onChange={set('companyName')} placeholder={travel ? 'Kurukshetra Travels' : 'Your business name'} />}
        </Field>
        <Field label="Your name" error={fieldErr(m.error, 'name')}>
          {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Owner’s email" hint="You’ll sign in with this. Employees get their own usernames." error={fieldErr(m.error, 'email')}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@company.com" />}
        </Field>
        <Field label="Password" hint="At least 10 characters." error={fieldErr(m.error, 'password')}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={m.isPending} className="mt-1 w-full">
          {travel ? 'Create agency' : 'Create business'}
        </Button>
        <p className="-mt-1 text-center text-xs leading-relaxed text-muted">
          By starting a trial you agree to the <Link to="/terms" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Terms</Link> and{' '}
          <Link to="/privacy" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Privacy Policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}
