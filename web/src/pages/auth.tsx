import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
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

/** A quiet preview of what the product does — the right half of the auth screens on wide displays. */
function SidePanel() {
  const rows = [
    { who: 'Priya Nair', what: 'Your Goa trip starts in 3 days', when: '9:00 AM', tone: 'bg-accent' },
    { who: 'Arjun Mehta', what: 'Happy birthday, Arjun!', when: '8:30 AM', tone: 'bg-warm-chart' },
    { who: 'Sneha Rao', what: 'Kerala backwaters, 5 nights', when: 'Delivered', tone: 'bg-accent' },
  ];
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden rounded-[24px] bg-ink p-10 text-white lg:flex">
      <svg aria-hidden className="absolute -right-24 -top-24 h-[420px] w-[420px] opacity-[0.08]" viewBox="0 0 24 24" fill="none" stroke="#7FE0C3" strokeWidth="0.6">
        <path d="M4 12l16-8-6 16-3-7-7-1z" />
      </svg>
      <div className="relative flex flex-col gap-4">
        <p className="max-w-sm text-[28px] font-semibold leading-tight tracking-[-0.025em]">Email your customers from your own address. Every reminder on time.</p>
        <p className="max-w-sm text-[15px] leading-relaxed text-white/65">Campaigns, trip reminders and birthday wishes, sent from your company domain or Gmail, with every bounce and unsubscribe handled for you.</p>
      </div>
      <div className="relative flex flex-col gap-2.5 rounded-[18px] bg-white/[0.06] p-4 ring-1 ring-white/10">
        <span className="px-1 text-[13px] font-medium text-white/60">Going out today</span>
        {rows.map((r) => (
          <div key={r.who} className="flex items-center gap-3 rounded-[12px] bg-white/[0.05] px-3.5 py-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${r.tone}`} aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{r.what}</span>
              <span className="text-xs text-white/55">To {r.who}</span>
            </span>
            <span className="tnum text-xs text-white/55">{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-h-screen gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-2 py-4 sm:px-8 lg:px-14">
        <Logo />
        <main className="flex flex-1 flex-col justify-center py-12">
          <div className="mx-auto flex w-full max-w-[400px] flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
              <p className="text-[15px] text-muted">{subtitle}</p>
            </div>
            {children}
            <p className="text-sm text-muted">{footer}</p>
          </div>
        </main>
        <p className="text-xs text-faint">
          Need help? <a className="font-medium text-muted hover:text-ink" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
        </p>
      </div>
      <SidePanel />
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
  const m = useMutation({ mutationFn: () => api.post<Me>('/api/auth/login', form), onSuccess: done });
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
          New here? <Link to="/signup" className="font-semibold text-accent hover:text-accent-strong">Create an account</Link>
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
      title="Create your account"
      subtitle="Set up your company. You can connect your domain right after."
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
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
