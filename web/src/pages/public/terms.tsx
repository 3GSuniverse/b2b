import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/brand';
import { DocPage, type DocSection } from './layout';

const mail = <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>;

const sections: DocSection[] = [
  {
    id: 'agreement',
    title: 'This agreement',
    body: (
      <p>
        These terms are an agreement between {BRAND.operator} (“we”, “us”) and the business that signs up for {BRAND.name} (“you”). By creating an account or using {BRAND.name}, you accept them on behalf of your business. Our{' '}
        <Link to="/privacy">Privacy Policy</Link> explains how we handle personal data.
      </p>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: (
      <ul>
        <li>{BRAND.name} is for businesses. Everyone using it must be 18 or over and give accurate details.</li>
        <li>You’re responsible for the people you add to your account, for what they do in it, and for keeping passwords safe. Tell us straight away at {mail} if you think someone has got into your account.</li>
      </ul>
    ),
  },
  {
    id: 'trial',
    title: 'Free trial and plans',
    body: (
      <ul>
        <li>New accounts start with a free trial with limits on how many messages can be sent. When it ends, sending stops until you move to a paid plan. Your data stays.</li>
        <li>Paid plans, their limits and prices are agreed with you before you pay. We’ll give you at least 30 days’ notice before changing the price of a plan you’re on.</li>
      </ul>
    ),
  },
  {
    id: 'messaging',
    title: 'Sending messages responsibly',
    body: (
      <>
        <p>You are the sender of every email and WhatsApp message that goes out from your account, so you agree to:</p>
        <ul>
          <li>message only people who gave you their details and agreed to hear from you, or who are your customers. Never use bought or scraped lists;</li>
          <li>follow the laws that apply to your messages, and the rules of the services you send through, including Google’s, Amazon’s and WhatsApp’s;</li>
          <li>never send anything misleading, fraudulent, abusive or illegal, or pretend to be someone else;</li>
          <li>respect unsubscribes. {BRAND.name} stops marketing messages to people who unsubscribe or reply STOP, and you mustn’t work around that.</li>
        </ul>
        <p>
          To protect everyone’s ability to deliver email, {BRAND.name} automatically pauses sending if too many of an account’s emails bounce or are marked as spam. We may also pause or close an account that breaks these rules.
        </p>
      </>
    ),
  },
  {
    id: 'your-data',
    title: 'Your data and your customers’ data',
    body: (
      <ul>
        <li>Everything you put into {BRAND.name} stays yours. You let us store and process it only to provide {BRAND.name} to you.</li>
        <li>
          You’re responsible for having the right to use your customers’ personal data, including giving them any notice and getting any consent the law requires. Under India’s Digital Personal Data Protection Act, 2023, you are
          the Data Fiduciary for that data and we process it on your behalf.
        </li>
        <li>You can ask us for a copy of your data at any time, and when you leave.</li>
      </ul>
    ),
  },
  {
    id: 'other-services',
    title: 'Other services you connect',
    body: (
      <>
        <p>
          Gmail, Amazon SES, WhatsApp and Razorpay are run by other companies under their own terms, and they can change or stop their services. Payments your customers make through Razorpay or UPI go straight to you;{' '}
          {BRAND.name} isn’t part of that payment.
        </p>
        <p>
          WhatsApp linking during the trial uses WhatsApp Web, which WhatsApp does not officially support for business messaging. WhatsApp may restrict a number that sends a lot of messages this way. Use a number you can afford to
          have restricted, and keep to the sending pace {BRAND.name} sets.
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI drafts',
    body: <p>“Draft with AI” writes a starting point for a quote from your trip details and price list. It can get things wrong, so check every draft before you send it. You’re responsible for what you send.</p>,
  },
  {
    id: 'availability',
    title: 'Keeping it running',
    body: (
      <p>
        We work to keep {BRAND.name} available and your data safe, and we back it up every night, but we can’t promise it will never be interrupted or error-free. We may improve or change features over time. If we remove
        something important to you, we’ll tell you first.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limits of our responsibility',
    body: (
      <ul>
        <li>{BRAND.name} is provided as it is. As far as the law allows, we are not responsible for indirect losses such as lost profits, lost bookings or damage to reputation.</li>
        <li>Our total responsibility for any claim is limited to what you paid us for {BRAND.name} in the three months before the claim.</li>
        <li>Nothing in these terms limits responsibility that the law doesn’t allow to be limited.</li>
      </ul>
    ),
  },
  {
    id: 'ending',
    title: 'Ending the agreement',
    body: (
      <p>
        You can stop using {BRAND.name} at any time and ask us to close your account at {mail}. We may suspend or close an account that breaks these terms or doesn’t pay. After an account closes, we delete its data as described in
        the <Link to="/privacy">Privacy Policy</Link>.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Law and disputes',
    body: (
      <p>
        These terms are governed by the laws of India. If a disagreement can’t be settled by talking to us first, the courts at {BRAND.courts} will decide it.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: <p>We may update these terms. We’ll change the date at the top, and tell account owners by email at least 15 days before a significant change takes effect.</p>,
  },
  {
    id: 'contact',
    title: 'Contact',
    body: <p>Questions about these terms: {mail}.</p>,
  },
];

export function TermsPage() {
  return <DocPage title="Terms of Service" intro={<p>The agreement between your business and {BRAND.operator} for using {BRAND.name}.</p>} sections={sections} />;
}
