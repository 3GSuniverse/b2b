import { Badge, type Tone } from '@/components/ui/display';
import type { CampaignStatus, SubscriptionStatus } from './types';

const CAMPAIGN: Record<CampaignStatus, [string, Tone]> = {
  DRAFT: ['Draft', 'grey'],
  SCHEDULED: ['Scheduled', 'blue'],
  SENDING: ['Sending', 'green'],
  PAUSED: ['Paused', 'orange'],
  SENT: ['Sent', 'green'],
  CANCELLED: ['Cancelled', 'grey'],
  FAILED: ['Failed', 'red'],
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const [label, tone] = CAMPAIGN[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

const SUB: Record<SubscriptionStatus, [string, Tone]> = {
  SUBSCRIBED: ['Subscribed', 'green'],
  UNSUBSCRIBED: ['Unsubscribed', 'grey'],
  BOUNCED: ['Bounced', 'orange'],
  COMPLAINED: ['Marked as spam', 'red'],
};

export function SubscriptionBadge({ status }: { status: SubscriptionStatus }) {
  const [label, tone] = SUB[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/** Where clicking a campaign should take you. */
export const campaignHref = (c: { id: string; status: CampaignStatus }) =>
  c.status === 'DRAFT' || c.status === 'SCHEDULED' ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`;
