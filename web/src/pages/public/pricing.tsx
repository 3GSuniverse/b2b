import { Check, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LinkButton } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { BRAND, PLANS } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/motion';
import { PublicFooter, PublicHeader } from './layout';

const rupees = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const QUESTIONS = [
  { q: 'Do I need a card for the free trial?', a: 'No. Sign up with your agency’s name and email, and start using it straight away.' },
  { q: 'How do I pay?', a: 'By UPI, card or net banking. You get a receipt by email for every payment.' },
  { q: 'Can I cancel?', a: <>Any time, with no fee. Your plan runs to the end of the period you paid for. See <Link to="/refunds">Cancellation and refunds</Link>.</> },
  { q: 'What counts as an email?', a: 'Each email to each customer counts once, reminders included: a broadcast to 500 people is 500 emails. WhatsApp messages aren’t counted.' },
];

export function PricingPage() {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const page = useReveal<HTMLDivElement>();
  useEffect(() => {
    document.title = `Pricing · ${BRAND.name}`;
    window.scrollTo(0, 0);
    return () => {
      document.title = BRAND.name;
    };
  }, []);

  return (
    <div ref={page} className="flex min-h-screen flex-col overflow-x-clip bg-ground">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-14 px-4 pb-20 pt-8 sm:px-6 lg:px-8 lg:pt-14">
        <header className="auth-rise flex flex-col items-center gap-4 text-center">
          <h1 className="text-balance text-[36px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[48px]">Simple pricing, in rupees</h1>
          <p className="max-w-[52ch] text-[17px] leading-relaxed text-ink-2">Start with a free trial. Pick a plan when you’re ready. Cancel any time.</p>
          <Segmented
            label="Billing period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'year', label: 'Yearly · 2 months free' },
            ]}
          />
        </header>

        <section aria-label="Plans" className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-3">
          <article className="reveal flex flex-col gap-5 rounded-[var(--radius-panel)] border border-dashed border-line bg-sunken p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Free trial</h2>
              <p className="text-sm text-muted">See it working for your agency first.</p>
            </div>
            <p className="flex items-baseline gap-1.5">
              <span className="text-[40px] font-extrabold tracking-[-0.03em]">₹0</span>
              <span className="text-sm text-muted">for 5 days</span>
            </p>
            <ul className="flex flex-col gap-2.5 text-sm">
              {['Every feature to try', '200 emails, and up to 100 WhatsApp messages a day', 'No card needed'].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <LinkButton to="/signup" className="mt-auto">
              Start free trial
            </LinkButton>
          </article>

          {PLANS.map((p, i) => {
            const price = period === 'month' ? p.price : p.yearly;
            return (
              <article
                key={p.id}
                className={cn(
                  'reveal relative flex flex-col gap-5 rounded-[var(--radius-panel)] bg-surface p-6 shadow-[var(--panel-shadow)] transition-transform duration-300 hover:-translate-y-1',
                  p.popular && 'shadow-[0_0_0_2px_var(--color-accent),var(--shadow-lift)]',
                )}
                style={{ transitionDelay: `${(i + 1) * 80}ms` }}
              >
                {p.popular && (
                  <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-on-primary">
                    <Sparkles className="h-3 w-3" aria-hidden /> Most agencies pick this
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <p className="text-sm text-muted">{p.forWho}</p>
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span key={`${p.id}-${period}`} className="dispatch-pop tnum text-[40px] font-extrabold tracking-[-0.03em]">
                    {rupees(price)}
                  </span>
                  <span className="text-sm text-muted">{period === 'month' ? 'a month' : 'a year'}</span>
                </p>
                <ul className="flex flex-col gap-2.5 text-sm">
                  <li className="flex gap-2 font-semibold">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    {p.emails.toLocaleString('en-IN')} emails a month
                  </li>
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <LinkButton to="/signup" variant={p.popular ? 'primary' : 'secondary'} className="mt-auto">
                  Start with {p.name}
                </LinkButton>
              </article>
            );
          })}
        </section>

        <p className="reveal -mt-6 text-center text-[13px] text-muted">
          All prices in Indian rupees. Pay by UPI, card or net banking. Messages you send through your own WhatsApp number cost nothing extra from us.
        </p>

        <section aria-labelledby="faq" className="reveal mx-auto flex w-full max-w-[720px] flex-col gap-4">
          <h2 id="faq" className="text-[22px] font-semibold tracking-[-0.02em]">
            Questions people ask
          </h2>
          <div className="flex flex-col divide-y divide-line-soft rounded-[var(--radius-panel)] bg-surface shadow-[var(--panel-shadow)]">
            {QUESTIONS.map((x) => (
              <details key={x.q} className="group px-5 py-4 [&_a]:font-semibold [&_a]:text-accent">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold">
                  {x.q}
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition-transform duration-300 group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="pt-2 text-[15px] leading-relaxed text-ink-2">{x.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
