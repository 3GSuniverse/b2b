import { CalendarClock, FileText, Lock, Mail, Send, Users, Wallet } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DispatchPanel } from '@/components/auth/dispatch-panel';
import { LinkButton } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { PublicFooter, PublicHeader } from './layout';

/** What a signed-out visitor sees at the site's address: what Drona is, and how it treats Gmail. */

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <FileText />,
    title: 'Enquiries and quotes',
    body: 'Every enquiry, whether it came by phone, WhatsApp or your website, sits on one board. Build a quote from your packages and price list, send it as a link, and see when it’s opened.',
  },
  {
    icon: <Wallet />,
    title: 'Payments and reminders',
    body: 'Set the advance and balance once. Reminders go out before each due date, customers pay by UPI or Razorpay, and receipts are numbered for you.',
  },
  {
    icon: <Send />,
    title: 'Campaigns by email and WhatsApp',
    body: 'Send festival offers and new packages to the right list, from your own address. Bounces and unsubscribes are handled, so you never message someone twice by mistake.',
  },
  {
    icon: <Users />,
    title: 'Group departures',
    body: 'Families, rooms, traveller details and the manifest for every group trip, with one message to everyone booked when plans change.',
  },
  {
    icon: <CalendarClock />,
    title: 'Messages that go on their own',
    body: 'Pre-trip details, birthday wishes and a thank-you after the trip go out at the right time, even when nobody is at the desk.',
  },
];

export function HomePage() {
  useEffect(() => {
    document.title = `${BRAND.name}: messages, quotes and payments for travel agencies`;
    return () => {
      document.title = BRAND.name;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <PublicHeader />

      <main className="flex flex-1 flex-col">
        {/* What it is */}
        <section className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:px-8 lg:pb-24 lg:pt-12">
          <div className="flex flex-col gap-6">
            <h1 className="auth-rise text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px]">Every traveller messaged on time, from your own name.</h1>
            <p className="auth-rise max-w-[52ch] text-[17px] leading-[1.65] text-ink-2" style={{ '--d': '80ms' } as React.CSSProperties}>
              {BRAND.name} is where a travel agency keeps its enquiries, quotes, trips and payments, and messages its customers by email and WhatsApp.
            </p>
            <div className="auth-rise flex flex-wrap items-center gap-3" style={{ '--d': '160ms' } as React.CSSProperties}>
              <LinkButton to="/signup" variant="primary" size="lg">
                Start free trial
              </LinkButton>
              <LinkButton to="/signin" size="lg">
                Sign in
              </LinkButton>
            </div>
            <p className="auth-rise text-[13px] text-muted" style={{ '--d': '220ms' } as React.CSSProperties}>
              5 days free. No card needed.
            </p>
          </div>
          <DispatchPanel headline={false} className="h-[560px]" />
        </section>

        {/* What it does */}
        <section aria-labelledby="what" className="border-t border-line bg-surface">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="flex max-w-[60ch] flex-col gap-3">
              <h2 id="what" className="text-[28px] font-semibold tracking-[-0.025em] sm:text-[32px]">
                From the first call to the trip home
              </h2>
              <p className="text-[16px] leading-[1.65] text-ink-2">The work of a travel desk, in one place, with the follow-ups done for you.</p>
            </div>
            <ul className="stagger grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="group flex flex-col gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent-soft text-accent transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)] group-hover:-translate-y-0.5 group-hover:rotate-[-4deg] [&>svg]:h-5 [&>svg]:w-5">
                    {f.icon}
                  </span>
                  <h3 className="text-[16px] font-semibold">{f.title}</h3>
                  <p className="text-[15px] leading-[1.65] text-ink-2">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Sending from your own address, and what the Gmail permission is for */}
        <section aria-labelledby="sending" className="border-t border-line">
          <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-20">
            <div className="flex flex-col gap-3">
              <h2 id="sending" className="text-[28px] font-semibold tracking-[-0.025em] sm:text-[32px]">
                Sent from your address, not ours
              </h2>
              <p className="max-w-[52ch] text-[16px] leading-[1.65] text-ink-2">
                Customers see your agency’s name and email. Send from your company domain, or connect the Gmail or Google Workspace account you already use.
              </p>
            </div>
            <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-ink text-accent-ring">
                  <Mail className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <h3 className="text-[16px] font-semibold">If you connect Gmail</h3>
              </div>
              <ul className="flex flex-col gap-2.5 text-[15px] leading-[1.6] text-ink-2">
                <li className="flex gap-2.5">
                  <Lock className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  {BRAND.name} asks Google only for permission to send email. It can’t read, search or list your inbox.
                </li>
                <li className="flex gap-2.5">
                  <Lock className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  It sends only the campaigns, reminders and quotes your agency creates in {BRAND.name}.
                </li>
                <li className="flex gap-2.5">
                  <Lock className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  The access is stored encrypted, and you can disconnect it at any time.
                </li>
              </ul>
              <p className="text-[13px] text-muted">
                Details are in our <Link to="/privacy" className="font-semibold text-accent hover:text-accent-strong">Privacy Policy</Link>.
              </p>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
