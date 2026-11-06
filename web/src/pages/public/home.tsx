import { Check, IndianRupee, Languages, Lock, Mail, MessageCircle, Wallet } from 'lucide-react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DispatchPanel } from '@/components/auth/dispatch-panel';
import { BoardGraphic, JourneyHero, PaymentsGraphic, QuoteGraphic, SeatsGraphic } from '@/components/public/graphics';
import { LinkButton } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/motion';
import { PublicFooter, PublicHeader } from './layout';

/**
 * The public home page: what Drona is, who it's for, and how it treats Gmail.
 * Google's verification needs a home page that describes the app, not just a sign-in screen.
 */

const step = (n: number) => ({ '--d': `${n * 90}ms` }) as CSSProperties;

type Feature = { id: string; title: string; body: string; points: string[]; graphic: ReactNode };

const FEATURES: Feature[] = [
  {
    id: 'enquiries',
    title: 'Every enquiry on one board',
    body: 'Phone calls, WhatsApp chats, walk-ins and website forms all end up in the same place. Each trip moves from enquiry to quoted to booked, so you can see at a glance what needs attention today.',
    points: ['Add enquiries from your website or an AI call agent automatically', 'Drag a trip to the next stage, or let a payment move it for you', 'See who is waiting for a quote and who is leaving this week'],
    graphic: <BoardGraphic />,
  },
  {
    id: 'quotes',
    title: 'Quotes in minutes, priced from your own rates',
    body: 'Keep your hotels, cabs and sightseeing in one price list, and build a quote from your packages in a few clicks. Send it as a link and you’ll know the moment the customer opens it.',
    points: ['Draft the day-by-day plan with AI, in English, Telugu or Hindi', 'Prices always come from your price list, never from guesswork', 'Keep every version, and see which one the customer accepted'],
    graphic: <QuoteGraphic />,
  },
  {
    id: 'payments',
    title: 'Payments followed up, politely and on time',
    body: `Set the advance, instalments and balance once. ${BRAND.name} reminds the customer before each due date, takes payment by UPI or Razorpay, and sends a numbered receipt when the money arrives.`,
    points: ['A payment page for each trip, with UPI and card', 'Reminders by WhatsApp or email, before and after the due date', 'Overdue amounts flagged on the board and in the summary'],
    graphic: <PaymentsGraphic />,
  },
  {
    id: 'messages',
    title: 'Messages that go out on their own',
    body: 'Pre-trip details, birthday wishes, festival offers and a thank-you after the trip reach your customers at the right time, by email or WhatsApp, from your agency’s own name.',
    points: ['Broadcasts to the right list, from your domain or Gmail', 'Unsubscribes and bounced addresses are respected automatically', 'Delivery, opens and clicks reported for every broadcast'],
    graphic: <DispatchPanel headline={false} className="!flex h-[500px] sm:h-[540px]" />,
  },
  {
    id: 'groups',
    title: 'Group departures without the spreadsheet',
    body: 'Run fixed departures like a yatra or a school trip in one place: the families who booked, how many seats are left, rooms, traveller details, and what each family still owes.',
    points: ['Families fill in traveller details themselves from a link', 'Print the manifest, with each traveller’s room, in one click', 'Message everyone who booked when plans change'],
    graphic: <SeatsGraphic />,
  },
];

const HOW: { title: string; body: string }[] = [
  { title: 'Create your agency’s account', body: 'Sign up with your agency’s name and email. It takes about two minutes.' },
  { title: 'Add your packages and price list', body: 'Enter your hotels, cabs and sightseeing at your own rates, so every quote is priced correctly from day one.' },
  { title: 'Connect your email and WhatsApp', body: 'Send from your company domain or Gmail, link your WhatsApp number, and your first quote can go out the same day.' },
];

const INDIA: { icon: ReactNode; text: string }[] = [
  { icon: <IndianRupee />, text: 'Prices in rupees, lakhs and crores' },
  { icon: <MessageCircle />, text: 'WhatsApp built in' },
  { icon: <Wallet />, text: 'UPI and Razorpay payments' },
  { icon: <Languages />, text: 'Quotes in English, Telugu and Hindi' },
];

export function HomePage() {
  const page = useReveal<HTMLDivElement>();
  useEffect(() => {
    document.title = `${BRAND.name}: everyday software for small travel agencies`;
    return () => {
      document.title = BRAND.name;
    };
  }, []);

  return (
    <div ref={page} className="flex min-h-screen flex-col overflow-x-clip bg-ground">
      <PublicHeader
        sections={[
          { href: '#features', label: 'Features' },
          { href: '#how', label: 'How it works' },
          { href: '#privacy-note', label: 'Privacy' },
        ]}
      />

      <main className="flex flex-1 flex-col">
        {/* ------------------------------------------------ Who it's for, and one trip's journey */}
        <section className="relative">
          {/* A soft saffron glow behind the journey, the page's one decorative flourish */}
          <div aria-hidden className="glow-drift pointer-events-none absolute right-[-10%] top-[-12%] h-[620px] w-[620px] rounded-full bg-highlight/15 blur-[90px]" />
          <div className="relative mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:px-8 lg:pb-24 lg:pt-10">
            <div className="flex flex-col gap-6">
              <p className="auth-rise inline-flex items-center gap-2 self-start rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-ink-2 shadow-[0_1px_2px_rgb(23_21_59/0.06)]">
                <span className="h-2 w-2 rounded-full bg-highlight" aria-hidden />
                Made for small and growing travel agencies
              </p>
              <h1 className="auth-rise text-balance text-[40px] font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-[56px]" style={step(1)}>
                The everyday software for small travel agencies.
              </h1>
              <p className="auth-rise max-w-[54ch] text-[17px] leading-[1.65] text-ink-2 sm:text-[18px]" style={step(2)}>
                {BRAND.name} keeps your enquiries, quotes, bookings, payments and customer messages together, and follows up on time, so your team can spend the day selling trips instead of chasing them.
              </p>
              <div className="auth-rise flex flex-wrap items-center gap-3" style={step(3)}>
                <LinkButton to="/signup" variant="primary" size="lg">
                  Start your free trial
                </LinkButton>
                <LinkButton to="/signin" size="lg">
                  Sign in
                </LinkButton>
              </div>
              <ul className="auth-rise flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-muted" style={step(4)}>
                {[`Free for ${BRAND.trialDays} days`, 'No card needed', 'Set up in minutes'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-success" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <JourneyHero />
          </div>
        </section>

        {/* ------------------------------------------------ Made for Indian agencies */}
        <section aria-label="Made for Indian agencies" className="border-y border-line bg-surface">
          <ul className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-center gap-x-8 gap-y-4 px-4 py-6 sm:px-6 lg:justify-between lg:px-8">
            {INDIA.map((x) => (
              <li key={x.text} className="flex items-center gap-2.5 text-[14px] font-semibold text-ink-2">
                <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent-soft text-accent [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
                  {x.icon}
                </span>
                {x.text}
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------ What it does */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-6">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pt-20 sm:px-6 lg:px-8 lg:pt-28">
            <div className="flex max-w-[62ch] flex-col gap-3">
              <h2 id="features-title" className="text-balance text-[32px] font-extrabold tracking-[-0.03em] sm:text-[40px]">
                From the first call to the trip home
              </h2>
              <p className="text-[17px] leading-[1.65] text-ink-2">
                The work of a travel desk, in one place. Here is what {BRAND.name} does for your team every day.
              </p>
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-20 px-4 pb-24 pt-14 sm:px-6 lg:gap-28 lg:px-8 lg:pb-32">
            {FEATURES.map((f, i) => (
              <article key={f.id} id={f.id} className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-2 lg:gap-16">
                <div className={cn('reveal flex flex-col gap-4', i % 2 === 1 && 'lg:order-2')}>
                  <h3 className="text-balance text-[26px] font-extrabold leading-tight tracking-[-0.025em] sm:text-[30px]">{f.title}</h3>
                  <p className="max-w-[56ch] text-[16px] leading-[1.7] text-ink-2">{f.body}</p>
                  <ul className="mt-1 flex flex-col gap-2.5">
                    {f.points.map((p) => (
                      <li key={p} className="flex gap-3 text-[15px] leading-snug text-ink-2">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-soft text-success" aria-hidden>
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={cn('reveal min-w-0', i % 2 === 1 && 'lg:order-1')} style={{ transitionDelay: '120ms' }}>
                  {f.graphic}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ How it works: a real sequence, so numbered */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-6 bg-nav text-nav-ink">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
            <div className="flex max-w-[60ch] flex-col gap-3">
              <h2 id="how-title" className="text-[32px] font-extrabold tracking-[-0.03em] text-white sm:text-[40px]">
                Ready for your first quote today
              </h2>
              <p className="text-[17px] leading-[1.65] text-nav-muted">There is nothing to install. Three steps and your agency is running on {BRAND.name}.</p>
            </div>
            <ol className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-3">
              {HOW.map((h, i) => (
                <li key={h.title} className="reveal relative flex flex-col gap-3 rounded-[20px] border border-nav-line bg-nav-card p-6" style={{ transitionDelay: `${i * 120}ms` }}>
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-highlight text-[16px] font-extrabold text-nav" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="text-[18px] font-bold text-white">{h.title}</h3>
                  <p className="text-[15px] leading-[1.65] text-nav-muted">{h.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------ Sending from your address, and what the Gmail permission is for */}
        <section id="privacy-note" aria-labelledby="sending" className="scroll-mt-6">
          <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <h2 id="sending" className="text-[30px] font-extrabold tracking-[-0.03em] sm:text-[36px]">
                Sent in your agency’s name, with your customers’ trust intact
              </h2>
              <p className="max-w-[54ch] text-[16px] leading-[1.7] text-ink-2">
                Customers see your agency’s name and email address, never ours. Send from your company domain, or connect the Gmail or Google Workspace account you already use. Your data stays yours, and we never sell it.
              </p>
            </div>
            <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-surface p-6 shadow-[var(--panel-shadow)]">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-ink text-accent-ring">
                  <Mail className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <h3 className="text-[17px] font-bold">If you connect Gmail</h3>
              </div>
              <ul className="flex flex-col gap-3 text-[15px] leading-[1.6] text-ink-2">
                <li className="flex gap-2.5">
                  <Lock className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  {BRAND.name} asks Google only for permission to send email. It cannot read, search or list your inbox.
                </li>
                <li className="flex gap-2.5">
                  <Lock className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  It sends only the broadcasts, reminders and quotes your agency creates in {BRAND.name}.
                </li>
                <li className="flex gap-2.5">
                  <Lock className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  The access is stored encrypted, and removing the address cancels it straight away.
                </li>
              </ul>
              <p className="text-[13px] text-muted">
                The details are in our{' '}
                <Link to="/privacy" className="font-semibold text-accent hover:text-accent-strong">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Closing invitation */}
        <section className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-24">
          <div className="relative mx-auto flex w-full max-w-[1200px] flex-col items-start gap-6 overflow-hidden rounded-[28px] bg-primary px-6 py-12 text-white sm:px-12 sm:py-16 lg:flex-row lg:items-center lg:justify-between">
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute -right-10 -top-16 h-[300px] w-[300px] fill-none stroke-white/15" strokeWidth={0.7}>
              <path d="M4 12l16-8-6 16-3-7-7-1z" />
            </svg>
            <div className="relative flex max-w-[48ch] flex-col gap-3">
              <h2 className="text-balance text-[30px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[38px]">Give your agency a calmer, better-organised day.</h2>
              <p className="text-[16px] leading-[1.65] text-white/80">Try every feature free for {BRAND.trialDays} days. If it isn’t for you, simply stop. There’s nothing to cancel.</p>
            </div>
            <div className="relative flex flex-wrap gap-3">
              <Link to="/signup" className="inline-flex h-12 items-center rounded-[var(--radius-button)] bg-highlight px-6 text-[15px] font-bold text-nav transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]">
                Start your free trial
              </Link>
              <a href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`${BRAND.name} for my agency`)}`} className="inline-flex h-12 items-center rounded-[var(--radius-button)] border border-white/30 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">
                Talk to us
              </a>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
