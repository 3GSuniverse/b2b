import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PeriodPicker, PlanCards, SeatPicker, type Period } from '@/components/plan-picker';
import { LinkButton } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/motion';
import { PublicFooter, PublicHeader } from './layout';

const QUESTIONS = [
  { q: 'Do I need a card for the free trial?', a: 'No. Sign up with your agency’s name and email, and start using it straight away.' },
  { q: 'How do I pay?', a: 'By UPI, card or net banking. You get a receipt by email for every payment.' },
  { q: 'Can I cancel?', a: <>Any time, with no fee. Your plan runs to the end of the period you paid for. See <Link to="/refunds">Cancellation and refunds</Link>.</> },
  { q: 'Who counts as a login?', a: 'Each login you create for someone in your agency. You, the owner, are free. A login you switch off doesn’t count, so you can switch off someone who has left and add someone new.' },
  { q: 'Can I change my plan or logins later?', a: 'Yes. Your plan and logins stay the same for the period you’ve paid for, 30 days (or a year). From 5 days before it ends, pay for the next period with any plan and any number of logins.' },
  { q: 'What counts as an email?', a: 'Each email to each customer counts once, reminders included: a broadcast to 500 people is 500 emails. WhatsApp messages aren’t counted.' },
];

export function PricingPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [seats, setSeats] = useState(3);
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
          <h1 className="text-balance text-[36px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[48px]">Pay only for the logins you need</h1>
          <p className="max-w-[56ch] text-[17px] leading-relaxed text-ink-2">Choose a plan, then exactly how many of your people need a login. One person or fifty. Start with a free trial; cancel any time.</p>
        </header>

        <section aria-label="Free trial" className="reveal flex flex-wrap items-center gap-5 rounded-[var(--radius-panel)] border border-dashed border-line bg-sunken px-6 py-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-lg font-semibold">Free trial: ₹0 for {BRAND.trialDays} days</h2>
            <p className="text-sm text-ink-2">Every feature of Ultra Premium, up to 5 employee logins, 200 emails and up to 100 WhatsApp messages a day. No card needed.</p>
          </div>
          <LinkButton to="/signup">Start free trial</LinkButton>
        </section>

        <section aria-label="Plans" className="reveal -mt-6 flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] bg-surface px-4 py-3.5 shadow-[var(--panel-shadow)]">
            <SeatPicker value={seats} onChange={setSeats} />
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
          <PlanCards
            seats={seats}
            period={period}
            action={(p) => (
              <LinkButton to="/signup" variant={p.popular ? 'primary' : 'secondary'} className={cn(p.id === 'ultra' && 'bg-highlight text-white hover:bg-highlight/90')}>
                Start free, then {p.name}
              </LinkButton>
            )}
          />
        </section>

        <p className="reveal -mt-6 text-center text-[13px] text-muted">
          Prices are in Indian rupees, per agency, before GST. The owner’s own login is always free. More than 50 logins? Write to us. Pay by UPI, card or net banking. Messages you send through your own WhatsApp number cost nothing extra from us.
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
