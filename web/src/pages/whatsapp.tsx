import { MessageCircle } from 'lucide-react';
import { EmptyState, PageHeader, Panel } from '@/components/ui/display';
import { WhatsAppSettings } from '@/components/whatsapp/settings';
import { BRAND } from '@/lib/brand';
import { useSession } from '@/lib/session';

/** WhatsApp has its own place in the sidebar, so it gets its own page, not a corner of Settings. */
export function WhatsAppPage() {
  const { tenant } = useSession();
  return (
    <>
      <PageHeader title="WhatsApp" description="Link your agency’s WhatsApp number to send reminders, quotes and broadcasts from it. Messages appear in its chats like any you send from the phone." />
      {tenant.features?.whatsapp ? (
        <WhatsAppSettings heading={false} />
      ) : (
        <Panel>
          <EmptyState
            icon={<MessageCircle />}
            title="WhatsApp isn’t switched on for your account"
            action={
              <a href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent('WhatsApp for my agency')}`} className="font-semibold text-accent hover:text-accent-strong">
                Ask us to switch it on
              </a>
            }
          >
            It’s included in the free trial. After the trial, we switch it on for your agency on request.
          </EmptyState>
        </Panel>
      )}
    </>
  );
}
