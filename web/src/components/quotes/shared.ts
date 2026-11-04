import type { RateKind, RateUnit } from '@/lib/types';

export const KINDS: Record<RateKind, string> = { HOTEL: 'Stay', TRANSPORT: 'Transport', ACTIVITY: 'Activity', TRAVEL: 'Travel', OTHER: 'Other' };
export const UNITS: Record<RateUnit, { label: string; per: string; times?: string }> = {
  PER_NIGHT: { label: 'per room, per night', per: 'night', times: 'Nights' },
  PER_DAY: { label: 'per vehicle, per day', per: 'day', times: 'Days' },
  PER_PERSON: { label: 'per person', per: 'person' },
  PER_GROUP: { label: 'per group', per: 'group' },
};
export const QTY_LABEL: Record<RateUnit, string> = { PER_NIGHT: 'Rooms', PER_DAY: 'Vehicles', PER_PERSON: 'People', PER_GROUP: 'Groups' };
