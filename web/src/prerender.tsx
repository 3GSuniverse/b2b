import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { BRAND } from './lib/brand';
import { HomePage } from './pages/public/home';
import { PricingPage } from './pages/public/pricing';
import { AboutPage, ContactPage, DeliveryPage, RefundsPage } from './pages/public/policies';
import { PrivacyPage } from './pages/public/privacy';
import { TermsPage } from './pages/public/terms';
import { TooltipProvider } from './components/ui/overlay';

/**
 * The public pages as plain HTML, made at build time. Payment providers, Google's reviewers and
 * search engines read the page without running JavaScript; this way they see the real text.
 * The app takes over in the browser exactly as before.
 */
export const PAGES = [
  { path: '/', title: `${BRAND.name}: everyday software for small travel agencies`, description: `${BRAND.name} keeps a travel agency's enquiries, quotes, bookings, payments and customer messages together, and follows up on time.`, page: <HomePage /> },
  { path: '/pricing', title: `Pricing · ${BRAND.name}`, description: `${BRAND.name} plans and prices in Indian rupees, with a free trial.`, page: <PricingPage /> },
  { path: '/about', title: `About · ${BRAND.name}`, description: `Who runs ${BRAND.name} and why.`, page: <AboutPage /> },
  { path: '/contact', title: `Contact us · ${BRAND.name}`, description: `How to reach the ${BRAND.name} team.`, page: <ContactPage /> },
  { path: '/privacy', title: `Privacy Policy · ${BRAND.name}`, description: `How ${BRAND.name} handles personal data.`, page: <PrivacyPage /> },
  { path: '/terms', title: `Terms of Service · ${BRAND.name}`, description: `The terms for using ${BRAND.name}.`, page: <TermsPage /> },
  { path: '/refunds', title: `Cancellation and refunds · ${BRAND.name}`, description: `How to cancel a ${BRAND.name} plan and when payments are refunded.`, page: <RefundsPage /> },
  { path: '/delivery', title: `Delivery · ${BRAND.name}`, description: `How you get access to ${BRAND.name} after signing up or paying.`, page: <DeliveryPage /> },
];

export function render(path: string) {
  const p = PAGES.find((x) => x.path === path)!;
  return renderToString(
    <StaticRouter location={path}>
      <TooltipProvider>{p.page}</TooltipProvider>
    </StaticRouter>,
  );
}
