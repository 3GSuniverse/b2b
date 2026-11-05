import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DispatchPanel } from '@/components/auth/dispatch-panel';
import { Logo } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { takeoff } from '@/lib/celebrate';
import type { Me } from '@/lib/types';

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
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
  };
}

export function SignInPage() {
  const done = useAfterAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const m = useMutation({
    mutationFn: () => api.post<Me>('/api/auth/login', form),
    onSuccess: (me) => {
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
        <>
          New here? <Link to="/signup" className="font-semibold text-accent hover:text-accent-strong">Start a free trial</Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError error={m.error} />
        <Field label="Work email" error={fieldErr(m.error, 'email')}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />}
        </Field>
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
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const m = useMutation({ mutationFn: () => api.post<Me>('/api/auth/signup', form), onSuccess: done });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <AuthLayout
      title="Start your free trial"
      subtitle="5 days to try everything: trips, quotes, payments and messages. No card needed."
      footer={
        <>
          Already have an account? <Link to="/signin" className="font-semibold text-accent hover:text-accent-strong">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError error={m.error} />
        <Field label="Company name" error={fieldErr(m.error, 'companyName')}>
          {(p) => <Input {...p} autoComplete="organization" autoFocus value={form.companyName} onChange={set('companyName')} placeholder="Kurukshetra Travels" />}
        </Field>
        <Field label="Your name" error={fieldErr(m.error, 'name')}>
          {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Work email" error={fieldErr(m.error, 'email')}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@company.com" />}
        </Field>
        <Field label="Password" hint="At least 10 characters." error={fieldErr(m.error, 'password')}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={m.isPending} className="mt-1 w-full">
          Start free trial
        </Button>
        <p className="-mt-1 text-center text-xs leading-relaxed text-muted">
          By starting a trial you agree to the <Link to="/terms" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Terms</Link> and{' '}
          <Link to="/privacy" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Privacy Policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}
