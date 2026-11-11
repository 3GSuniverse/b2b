import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell';
import { RequireSession } from './lib/session';
import { AuthShell, SignInPage, SignUpPage } from './pages/auth';
import { NotFoundPage } from './pages/not-found';

const HomePage = lazy(() => import('./pages/public/home').then((m) => ({ default: m.HomePage })));
const PrivacyPage = lazy(() => import('./pages/public/privacy').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/public/terms').then((m) => ({ default: m.TermsPage })));
const PricingPage = lazy(() => import('./pages/public/pricing').then((m) => ({ default: m.PricingPage })));
const RefundsPage = lazy(() => import('./pages/public/policies').then((m) => ({ default: m.RefundsPage })));
const DeliveryPage = lazy(() => import('./pages/public/policies').then((m) => ({ default: m.DeliveryPage })));
const ContactPage = lazy(() => import('./pages/public/policies').then((m) => ({ default: m.ContactPage })));
const AboutPage = lazy(() => import('./pages/public/policies').then((m) => ({ default: m.AboutPage })));

const OverviewPage = lazy(() => import('./pages/overview').then((m) => ({ default: m.OverviewPage })));
const ContactsPage = lazy(() => import('./pages/contacts').then((m) => ({ default: m.ContactsPage })));
const ComposerPage = lazy(() => import('./pages/composer').then((m) => ({ default: m.ComposerPage })));
const ReportPage = lazy(() => import('./pages/report').then((m) => ({ default: m.ReportPage })));
const CallsPage = lazy(() => import('./pages/calls').then((m) => ({ default: m.CallsPage })));
const AutomationEditorPage = lazy(() => import('./pages/automation-editor').then((m) => ({ default: m.AutomationEditorPage })));
const TemplateEditorPage = lazy(() => import('./pages/template-editor').then((m) => ({ default: m.TemplateEditorPage })));
const TripsPage = lazy(() => import('./pages/trips').then((m) => ({ default: m.TripsPage })));
const PackagesPage = lazy(() => import('./pages/packages').then((m) => ({ default: m.PackagesPage })));
const PackagePage = lazy(() => import('./pages/packages').then((m) => ({ default: m.PackagePage })));
const PricesPage = lazy(() => import('./pages/prices').then((m) => ({ default: m.PricesPage })));
const QuoteEditorPage = lazy(() => import('./pages/quote-editor').then((m) => ({ default: m.QuoteEditorPage })));
const GroupPage = lazy(() => import('./pages/group').then((m) => ({ default: m.GroupPage })));
const ManifestPage = lazy(() => import('./pages/manifest').then((m) => ({ default: m.ManifestPage })));
const TripPage = lazy(() => import('./pages/trip').then((m) => ({ default: m.TripPage })));
const EmailHubPage = lazy(() => import('./pages/channel').then((m) => ({ default: m.EmailHubPage })));
const WhatsAppHubPage = lazy(() => import('./pages/channel').then((m) => ({ default: m.WhatsAppHubPage })));
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })));
const AgencyPage = lazy(() => import('./pages/agency').then((m) => ({ default: m.AgencyPage })));
const HelpPage = lazy(() => import('./pages/help').then((m) => ({ default: m.HelpPage })));
const NewRequestPage = lazy(() => import('./pages/help').then((m) => ({ default: m.NewRequestPage })));
const RequestPage = lazy(() => import('./pages/help').then((m) => ({ default: m.RequestPage })));
const CareApp = lazy(() => import('./pages/care/app').then((m) => ({ default: m.CareApp })));
const AgencyBillingPage = lazy(() => import('./pages/agency').then((m) => ({ default: m.AgencyBillingPage })));

function PageFallback() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="skeleton h-9 w-56 rounded-lg" />
      <div className="skeleton h-64 rounded-[var(--radius-panel)]" />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/privacy" element={<Suspense fallback={null}><PrivacyPage /></Suspense>} />
      <Route path="/terms" element={<Suspense fallback={null}><TermsPage /></Suspense>} />
      <Route path="/pricing" element={<Suspense fallback={null}><PricingPage /></Suspense>} />
      <Route path="/refunds" element={<Suspense fallback={null}><RefundsPage /></Suspense>} />
      <Route path="/delivery" element={<Suspense fallback={null}><DeliveryPage /></Suspense>} />
      <Route path="/contact" element={<Suspense fallback={null}><ContactPage /></Suspense>} />
      <Route path="/about" element={<Suspense fallback={null}><AboutPage /></Suspense>} />
      {/* Dhrona's own customer care team: a separate app with its own sign-in */}
      <Route path="/care/*" element={<Suspense fallback={null}><CareApp /></Suspense>} />
      <Route element={<AuthShell />}>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signin/:agency" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
      </Route>
      <Route path="groups/:id/manifest" element={<RequireSession><Suspense fallback={<PageFallback />}><ManifestPage /></Suspense></RequireSession>} />
      <Route
        element={
          // Signed out at the site's address: the public home page instead of the sign-in screen
          <RequireSession signedOut={{ '/': <Suspense fallback={null}><HomePage /></Suspense> }}>
            <AppShell />
          </RequireSession>
        }
      >
        <Route index element={<Suspense fallback={<PageFallback />}><OverviewPage /></Suspense>} />
        <Route path="trips" element={<Suspense fallback={<PageFallback />}><TripsPage /></Suspense>} />
        <Route path="trips/packages" element={<Suspense fallback={<PageFallback />}><PackagesPage /></Suspense>} />
        <Route path="trips/packages/:id" element={<Suspense fallback={<PageFallback />}><PackagePage /></Suspense>} />
        <Route path="trips/prices" element={<Suspense fallback={<PageFallback />}><PricesPage /></Suspense>} />
        <Route path="trips/:tripId/quotes/:quoteId" element={<Suspense fallback={<PageFallback />}><QuoteEditorPage /></Suspense>} />
        <Route path="groups/:id" element={<Suspense fallback={<PageFallback />}><GroupPage /></Suspense>} />
        <Route path="trips/:id" element={<Suspense fallback={<PageFallback />}><TripPage /></Suspense>} />
        <Route path="campaigns" element={<Navigate to="/email/broadcasts" replace />} />
        <Route path="campaigns/new" element={<Suspense fallback={<PageFallback />}><ComposerPage /></Suspense>} />
        <Route path="campaigns/:id/edit" element={<Suspense fallback={<PageFallback />}><ComposerPage /></Suspense>} />
        <Route path="campaigns/:id" element={<Suspense fallback={<PageFallback />}><ReportPage /></Suspense>} />
        <Route path="automations" element={<Navigate to="/email/automatic" replace />} />
        <Route path="automations/new" element={<Suspense fallback={<PageFallback />}><AutomationEditorPage /></Suspense>} />
        <Route path="automations/:id" element={<Suspense fallback={<PageFallback />}><AutomationEditorPage /></Suspense>} />
        <Route path="contacts" element={<Suspense fallback={<PageFallback />}><ContactsPage /></Suspense>} />
        <Route path="templates" element={<Navigate to="/email/templates" replace />} />
        <Route path="templates/:id" element={<Suspense fallback={<PageFallback />}><TemplateEditorPage /></Suspense>} />
        <Route path="email/:tab?" element={<Suspense fallback={<PageFallback />}><EmailHubPage /></Suspense>} />
        <Route path="calls" element={<Suspense fallback={<PageFallback />}><CallsPage /></Suspense>} />
        <Route path="whatsapp/:tab?" element={<Suspense fallback={<PageFallback />}><WhatsAppHubPage /></Suspense>} />
        <Route path="agency" element={<Suspense fallback={<PageFallback />}><AgencyPage /></Suspense>} />
        <Route path="agency/billing" element={<Suspense fallback={<PageFallback />}><AgencyBillingPage /></Suspense>} />
        <Route path="settings/billing" element={<Navigate to="/agency/billing" replace />} />
        <Route path="settings" element={<Navigate to="/settings/company" replace />} />
        <Route path="help" element={<Suspense fallback={<PageFallback />}><HelpPage /></Suspense>} />
        <Route path="help/new" element={<Suspense fallback={<PageFallback />}><NewRequestPage /></Suspense>} />
        <Route path="help/:id" element={<Suspense fallback={<PageFallback />}><RequestPage /></Suspense>} />
        <Route path="settings/:section" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
