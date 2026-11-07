import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/brand';
import { DocPage, type DocSection } from './layout';

/**
 * The policy pages a payment provider checks before it lets a business take payments:
 * cancellation and refunds, delivery, contact and about. Plain words, the same facts as the Terms.
 */

const mail = <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>;

// ---------------------------------------------------------------- Cancellation and refunds

const refundSections: DocSection[] = [
  {
    id: 'trial',
    title: 'Try it free first',
    body: <p>Every new account starts with a free trial, with no card needed. You only pay once you’ve seen {BRAND.name} working for your agency.</p>,
  },
  {
    id: 'cancel',
    title: 'Cancelling your plan',
    body: (
      <ul>
        <li>You can cancel any time by writing to {mail} from the email address on your account. There’s no notice period and no cancellation fee.</li>
        <li>Your plan stays active until the end of the period you’ve already paid for. After that it isn’t renewed and you aren’t charged again.</li>
        <li>Your plan and number of employee logins stay the same for each period you pay for (30 days, or a year). You can change either when you pay for the next period, from 5 days before the current one ends. Choosing fewer logins or a smaller plan doesn’t refund any part of a period already paid for.</li>
        <li>Your trips, customers and messages stay in your account after the plan ends. If you ask us to close the account, we delete its data as our <Link to="/privacy">Privacy Policy</Link> describes.</li>
      </ul>
    ),
  },
  {
    id: 'refunds',
    title: 'When we refund',
    body: (
      <>
        <p>We refund the payment in full when:</p>
        <ul>
          <li>you were charged twice for the same period, or charged by mistake;</li>
          <li>you ask within 7 days of your first ever payment, if {BRAND.name} isn’t right for your agency;</li>
          <li>{BRAND.name} was unavailable for more than 3 days in a row in the period you paid for, because of a problem on our side.</li>
        </ul>
        <p>Otherwise, payments for a period that has started aren’t refunded, but you can cancel so you aren’t charged for the next one.</p>
      </>
    ),
  },
  {
    id: 'how',
    title: 'How refunds are paid',
    body: (
      <ul>
        <li>Write to {mail} with your agency’s name and the payment date. We reply within 2 working days.</li>
        <li>Approved refunds go back to the same card, bank account or UPI ID you paid from, within 5 to 7 working days. Your bank may take a few more days to show it.</li>
      </ul>
    ),
  },
  {
    id: 'customers',
    title: 'Payments your customers make to you',
    body: (
      <p>
        When your own customers pay you for a trip through {BRAND.name}, the money goes straight to your agency’s account. Refunds for those payments are between you and your customer, under your agency’s own policy.
      </p>
    ),
  },
];

export function RefundsPage() {
  return (
    <DocPage
      title="Cancellation and refunds"
      intro={<p>How to cancel a {BRAND.name} plan, and when you get your money back.</p>}
      summary={
        <ul>
          <li>Cancel any time, with no fee. You keep access until the end of the period you paid for.</li>
          <li>A full refund within 7 days of your first payment, or if you were charged by mistake.</li>
          <li>Refunds reach you in 5 to 7 working days, the same way you paid.</li>
        </ul>
      }
      sections={refundSections}
    />
  );
}

// ---------------------------------------------------------------- Delivery

const deliverySections: DocSection[] = [
  {
    id: 'online',
    title: 'Nothing is shipped',
    body: <p>{BRAND.name} is online software. There are no physical goods, so nothing is posted or couriered, and there are no shipping charges.</p>,
  },
  {
    id: 'access',
    title: 'When you get access',
    body: (
      <ul>
        <li>Your free trial starts the moment you sign up.</li>
        <li>When you pay for a plan, it’s active on your account straight away, and at the latest within 24 hours. A payment for your next period takes effect on the day that period starts. We email a receipt to the address on your account.</li>
        <li>If your plan isn’t active 24 hours after paying, write to {mail} and we’ll sort it out the same working day.</li>
      </ul>
    ),
  },
  {
    id: 'where',
    title: 'Where it works',
    body: <p>Use {BRAND.name} in any up-to-date web browser on a computer or phone, anywhere in India. Sign in at this website with your email and password.</p>,
  },
];

export function DeliveryPage() {
  return <DocPage title="Delivery" intro={<p>How you receive {BRAND.name} after you sign up or pay.</p>} sections={deliverySections} />;
}

// ---------------------------------------------------------------- Contact

export function ContactPage() {
  const lines = [
    { icon: <Mail />, label: 'Email', value: mail, note: 'Best for anything about your account or a payment. We reply within 1 working day.' },
    ...(BRAND.phone ? [{ icon: <Phone />, label: 'Phone and WhatsApp', value: <a href={`tel:${BRAND.phone.replace(/\s/g, '')}`}>{BRAND.phone}</a>, note: undefined }] : []),
    { icon: <Clock />, label: 'Hours', value: BRAND.supportHours, note: undefined },
    ...(BRAND.address ? [{ icon: <MapPin />, label: 'Address', value: BRAND.address, note: undefined }] : []),
  ];
  const sections: DocSection[] = [
    {
      id: 'reach',
      title: 'Reach us',
      body: (
        <ul className="!list-none !pl-0 flex flex-col gap-4">
          {lines.map((l) => (
            <li key={l.label} className="flex gap-3.5">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent [&_svg]:h-4 [&_svg]:w-4">{l.icon}</span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold text-muted">{l.label}</span>
                <span className="font-medium text-ink">{l.value}</span>
                {l.note && <span className="text-[13px] text-muted">{l.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'who',
      title: 'Who you’re writing to',
      body: (
        <p>
          {BRAND.name} is run by {BRAND.operator}. Questions about a payment, a refund or your data all come to the same address. See also <Link to="/refunds">Cancellation and refunds</Link> and our{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
      ),
    },
  ];
  return <DocPage title="Contact us" intro={<p>Questions, help with your account, or a problem with a payment: here’s how to reach a person.</p>} sections={sections} />;
}

// ---------------------------------------------------------------- About

const aboutSections: DocSection[] = [
  {
    id: 'what',
    title: 'What we make',
    body: (
      <p>
        {BRAND.name} is everyday software for small travel agencies in India. It keeps enquiries, quotes, bookings, payments and customer messages in one place, and sends the reminders and follow-ups on time, by email and
        WhatsApp, from the agency’s own name.
      </p>
    ),
  },
  {
    id: 'why',
    title: 'Why',
    body: (
      <p>
        Most small agencies run on phone calls, WhatsApp chats and notebooks. Payments get chased late, quotes go without a follow-up, and a happy customer is never asked to travel again. {BRAND.name} does that remembering, so a
        small team can give the service of a big one.
      </p>
    ),
  },
  {
    id: 'who',
    title: 'Who runs it',
    body: (
      <p>
        {BRAND.name} is run by {BRAND.operator}, from {BRAND.courts.split(',')[0]}. It’s built around how Indian agencies actually work: rupees, UPI, group yatras, and quotes in Telugu and Hindi. <Link to="/contact">Contact us</Link> any time.
      </p>
    ),
  },
];

export function AboutPage() {
  return <DocPage title={`About ${BRAND.name}`} intro={<p>Who we are and why we built {BRAND.name}.</p>} sections={aboutSections} />;
}
