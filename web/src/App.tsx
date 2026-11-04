import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell';
import { RequireSession } from './lib/session';
import { SignInPage, SignUpPage } from './pages/auth';
import { NotFoundPage } from './pages/not-found';

const OverviewPage = lazy(() => import('./pages/overview').then((m) => ({ default: m.OverviewPage })));
const ContactsPage = lazy(() => import('./pages/contacts').then((m) => ({ default: m.ContactsPage })));
const CampaignsPage = lazy(() => import('./pages/campaigns').then((m) => ({ default: m.CampaignsPage })));
const ComposerPage = lazy(() => import('./pages/composer').then((m) => ({ default: m.ComposerPage })));
const ReportPage = lazy(() => import('./pages/report').then((m) => ({ default: m.ReportPage })));
const AutomationsPage = lazy(() => import('./pages/automations').then((m) => ({ default: m.AutomationsPage })));
const AutomationEditorPage = lazy(() => import('./pages/automation-editor').then((m) => ({ default: m.AutomationEditorPage })));
const TemplatesPage = lazy(() => import('./pages/templates').then((m) => ({ default: m.TemplatesPage })));
const TemplateEditorPage = lazy(() => import('./pages/template-editor').then((m) => ({ default: m.TemplateEditorPage })));
const TripsPage = lazy(() => import('./pages/trips').then((m) => ({ default: m.TripsPage })));
const PricesPage = lazy(() => import('./pages/prices').then((m) => ({ default: m.PricesPage })));
const QuoteEditorPage = lazy(() => import('./pages/quote-editor').then((m) => ({ default: m.QuoteEditorPage })));
const GroupPage = lazy(() => import('./pages/group').then((m) => ({ default: m.GroupPage })));
const ManifestPage = lazy(() => import('./pages/manifest').then((m) => ({ default: m.ManifestPage })));
const TripPage = lazy(() => import('./pages/trip').then((m) => ({ default: m.TripPage })));
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })));

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
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="groups/:id/manifest" element={<RequireSession><Suspense fallback={<PageFallback />}><ManifestPage /></Suspense></RequireSession>} />
      <Route
        element={
          <RequireSession>
            <AppShell />
          </RequireSession>
        }
      >
        <Route index element={<Suspense fallback={<PageFallback />}><OverviewPage /></Suspense>} />
        <Route path="trips" element={<Suspense fallback={<PageFallback />}><TripsPage /></Suspense>} />
        <Route path="trips/prices" element={<Suspense fallback={<PageFallback />}><PricesPage /></Suspense>} />
        <Route path="trips/:tripId/quotes/:quoteId" element={<Suspense fallback={<PageFallback />}><QuoteEditorPage /></Suspense>} />
        <Route path="groups/:id" element={<Suspense fallback={<PageFallback />}><GroupPage /></Suspense>} />
        <Route path="trips/:id" element={<Suspense fallback={<PageFallback />}><TripPage /></Suspense>} />
        <Route path="campaigns" element={<Suspense fallback={<PageFallback />}><CampaignsPage /></Suspense>} />
        <Route path="campaigns/new" element={<Suspense fallback={<PageFallback />}><ComposerPage /></Suspense>} />
        <Route path="campaigns/:id/edit" element={<Suspense fallback={<PageFallback />}><ComposerPage /></Suspense>} />
        <Route path="campaigns/:id" element={<Suspense fallback={<PageFallback />}><ReportPage /></Suspense>} />
        <Route path="automations" element={<Suspense fallback={<PageFallback />}><AutomationsPage /></Suspense>} />
        <Route path="automations/new" element={<Suspense fallback={<PageFallback />}><AutomationEditorPage /></Suspense>} />
        <Route path="automations/:id" element={<Suspense fallback={<PageFallback />}><AutomationEditorPage /></Suspense>} />
        <Route path="contacts" element={<Suspense fallback={<PageFallback />}><ContactsPage /></Suspense>} />
        <Route path="templates" element={<Suspense fallback={<PageFallback />}><TemplatesPage /></Suspense>} />
        <Route path="templates/:id" element={<Suspense fallback={<PageFallback />}><TemplateEditorPage /></Suspense>} />
        <Route path="settings" element={<Navigate to="/settings/senders" replace />} />
        <Route path="settings/:section" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
