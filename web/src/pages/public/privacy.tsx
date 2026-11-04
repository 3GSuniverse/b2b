import { BRAND } from '@/lib/brand';
import { DocPage, type DocSection } from './layout';

const mail = <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>;
const GOOGLE_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';

const sections: DocSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          {BRAND.name} is software that travel agencies use to manage enquiries, quotes, trips and payments, and to message their customers by email and WhatsApp. It is run by {BRAND.operator}, India (“we”, “us”).
        </p>
        <p>Questions about this policy or your data: {mail}.</p>
      </>
    ),
  },
  {
    id: 'roles',
    title: 'Whose data this is',
    body: (
      <>
        <p>{BRAND.name} handles two kinds of personal data, and our role is different for each.</p>
        <ul>
          <li>
            <strong>About the agencies and their staff who use {BRAND.name}:</strong> name, work email, company name, password (stored only as a one-way hash), sign-in sessions and a log of important actions. We decide how this is
            used, so we are responsible for it.
          </li>
          <li>
            <strong>About an agency’s own customers:</strong> the contacts, trips, travellers, quotes, payments and messages an agency puts into {BRAND.name}. The agency decides what to collect and why, and is responsible for it
            (under India’s Digital Personal Data Protection Act, 2023, the agency is the Data Fiduciary). We process it only to provide {BRAND.name} to that agency, following its instructions.
          </li>
        </ul>
        <p>If you are a traveller and want to know what an agency holds about you, ask the agency first. We will help them answer you.</p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect and why',
    body: (
      <ul>
        <li>
          <strong>Account details</strong>, to let you sign in, keep your company’s data separate from everyone else’s, and contact you about your account.
        </li>
        <li>
          <strong>What your agency adds</strong>: contacts and lists, trips and enquiries, traveller details for group departures, quotes, price lists, packages, payment records, email templates, campaigns and automations. We store
          them to show them to your team and to send the messages you ask for. Traveller ID numbers are encrypted, and only their last four digits are ever shown.
        </li>
        <li>
          <strong>Message activity</strong>: whether each email or WhatsApp message was delivered, bounced, opened, clicked or marked as spam, and who unsubscribed. We use this to show reports, to stop messaging people who
          unsubscribed or whose address bounced, and to pause sending if an account’s bounce or spam-report rate gets too high.
        </li>
        <li>
          <strong>Technical data</strong>: IP address, browser and the time of requests, kept in server logs to keep {BRAND.name} secure and working.
        </li>
      </ul>
    ),
  },
  {
    id: 'google',
    title: 'Gmail and Google user data',
    body: (
      <>
        <p>An agency can connect a Gmail or Google Workspace account so that its emails are sent from that address. When you click “Connect with Google”, Google asks you to allow:</p>
        <ul>
          <li>your Google account’s email address, so we know which address you connected; and</li>
          <li>permission to send email on your behalf (the Gmail “send” permission).</li>
        </ul>
        <p>
          <strong>How we use it.</strong> We use this permission only to send the emails you create and send from {BRAND.name}: campaigns, automated messages such as trip and payment reminders, and quotes. Nothing is sent from your
          account unless someone in your agency has set it up in {BRAND.name}.
        </p>
        <p>
          <strong>What we don’t do.</strong> {BRAND.name} cannot read, search or list the emails in your mailbox. The permission we ask for doesn’t allow it, and we never request it. We don’t sell Google user data, use it for
          advertising, use it to train AI models, or share it with anyone except as needed to send your emails. Nobody at {BRAND.name} reads it unless you ask us to for support, it’s needed for security, or the law requires it.
        </p>
        <p>
          <strong>How we store it.</strong> The access Google gives us (a token) is encrypted with AES-256-GCM before it is saved, and is only decrypted at the moment an email is sent.
        </p>
        <p>
          <strong>How to remove it.</strong> In {BRAND.name}, go to Settings, then Sending addresses, and remove the Gmail address. We tell Google to cancel our access and delete the token straight away. You can also remove {BRAND.name}{' '}
          at any time from your Google Account, under Security, then “Your connections to third-party apps and services”.
        </p>
        <p>
          {BRAND.name}’s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
          <a href={GOOGLE_POLICY} target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </>
    ),
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    body: (
      <p>
        If an agency links a WhatsApp number to {BRAND.name}, we keep that link’s login keys, encrypted, on our server so we can send the messages the agency asks for and receive replies such as STOP. The agency can unlink the number
        at any time in Settings, which deletes them.
      </p>
    ),
  },
  {
    id: 'email-tracking',
    title: 'Email opens and clicks',
    body: (
      <p>
        Emails sent from an agency’s own domain can include a tiny image and tracked links, so the agency can see whether an email was opened and which links were clicked. Emails sent through a connected Gmail account don’t include
        these. Marketing emails always include an unsubscribe link, and we honour it for every future message from that agency.
      </p>
    ),
  },
  {
    id: 'sharing',
    title: 'Who we share data with',
    body: (
      <>
        <p>We don’t sell personal data. We use these services to run {BRAND.name}, and they only get what they need for their part:</p>
        <ul>
          <li>
            <strong>Google Cloud</strong>: the servers {BRAND.name} and its database run on.
          </li>
          <li>
            <strong>Cloudflare</strong>: the secure connection between your browser and our servers.
          </li>
          <li>
            <strong>Amazon Web Services (Amazon SES)</strong>: delivers emails sent from an agency’s own domain.
          </li>
          <li>
            <strong>Google (Gmail)</strong>: delivers emails sent from a connected Gmail account.
          </li>
          <li>
            <strong>WhatsApp</strong>: delivers WhatsApp messages, if the agency linked a number.
          </li>
          <li>
            <strong>Razorpay</strong>: if an agency connects its Razorpay account, its customers’ online payments are handled by Razorpay. Card and bank details go to Razorpay, not to us; we only receive a payment confirmation.
          </li>
          <li>
            <strong>Anthropic</strong>: when someone uses “Draft with AI” on a quote, we send the trip details (destination, dates, number of travellers, budget, the agent’s notes) and the agency’s price list to Anthropic’s Claude to
            write a draft. We don’t send the customer’s name, phone number or email address.
          </li>
        </ul>
        <p>We may also disclose data if Indian law requires it, or to protect people from harm or fraud.</p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: <p>We use a single cookie to keep you signed in. It can’t be read by scripts on the page. We don’t use advertising or analytics cookies.</p>,
  },
  {
    id: 'security',
    title: 'How we keep it safe',
    body: (
      <ul>
        <li>All traffic to {BRAND.name} is encrypted (HTTPS).</li>
        <li>Passwords are stored only as one-way hashes. Connected-account tokens, payment keys and traveller ID numbers are encrypted.</li>
        <li>Each agency can only ever see its own data.</li>
        <li>The database is backed up every night.</li>
      </ul>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <p>
        We keep an agency’s data while its account is open. If an agency asks us to close its account, we delete its data within 30 days, and it disappears from our backups within the following 14 days. An agency can delete
        individual contacts, trips and other records itself at any time.
      </p>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <p>
          You can ask to see the personal data we hold about you, have it corrected or deleted, or raise a complaint about how it’s handled. Write to {mail} and we will reply within 30 days. If your data was added by a travel
          agency, we will pass your request to them, since they decide what is kept.
        </p>
        <p>If you’re not satisfied with our answer, you can complain to the Data Protection Board of India.</p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>{BRAND.name} is for businesses. Accounts are only for people aged 18 or over.</p>,
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: <p>If we change how we use personal data, we will update this page and its date. If the change is significant, we will tell account owners by email before it takes effect.</p>,
  },
  {
    id: 'contact',
    title: 'Contact and grievances',
    body: (
      <p>
        For privacy questions, requests or complaints, email {mail}. {BRAND.operator}, India.
      </p>
    ),
  },
];

export function PrivacyPage() {
  return (
    <DocPage
      title="Privacy Policy"
      intro={<p>This explains what personal data {BRAND.name} handles, why, who it’s shared with, and the choices you have.</p>}
      summary={
        <ul>
          <li>Your agency’s data is yours. We use it only to run {BRAND.name} for you, and we never sell it.</li>
          <li>If you connect Gmail, we can only send the emails you create. We can’t read your inbox.</li>
          <li>Secrets such as connected-account tokens are encrypted, and each agency sees only its own data.</li>
        </ul>
      }
      sections={sections}
    />
  );
}
