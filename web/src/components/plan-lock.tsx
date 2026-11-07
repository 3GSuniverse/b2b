import { Crown, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import type { Entitlements } from '@/lib/types';

export type PlanFeature = 'automations' | 'groups' | 'ai' | 'leadApi';

const NEEDS: Record<PlanFeature, { plan: string; what: string }> = {
  automations: { plan: 'Professional', what: 'Automatic messages' },
  groups: { plan: 'Professional', what: 'Group departures' },
  ai: { plan: 'Professional', what: 'Drona AI' },
  leadApi: { plan: 'Ultra Premium', what: 'The leads API' },
};

/** Whether the agency's plan has this feature (true when the server doesn't say, so nothing is hidden by mistake). */
export function usePlanAllows(f: PlanFeature) {
  const e: Entitlements | undefined = useSession().tenant.plan?.entitlements;
  return e ? e[f] : true;
}

/** A band saying which plan a feature comes with, linking to Plan & billing. Renders nothing when the plan has it. */
export function PlanLock({ feature, className }: { feature: PlanFeature; className?: string }) {
  const allowed = usePlanAllows(feature);
  const { user } = useSession();
  if (allowed) return null;
  const n = NEEDS[feature];
  const ultra = n.plan === 'Ultra Premium';
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-[16px] px-4 py-3.5 text-[13.5px]',
        ultra ? 'bg-nav text-nav-ink' : 'bg-[linear-gradient(120deg,#ecebfd,#f3e9ff)] text-ink',
        className,
      )}
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', ultra ? 'bg-white/10 text-highlight' : 'bg-accent text-white')}>
        {ultra ? <Crown className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </span>
      <p className="min-w-0 flex-1">
        <b className="font-semibold">
          {n.what} come{n.what.endsWith('s') && !n.what.startsWith('The') ? '' : 's'} with the {n.plan} plan.
        </b>{' '}
        <span className={ultra ? 'text-nav-muted' : 'text-ink-2'}>
          {user.role === 'OWNER' ? 'Choose it when you pay for your next billing cycle.' : 'Ask your agency owner to choose it for the next billing cycle.'} What you’ve already made stays saved.
        </span>
      </p>
      {user.role === 'OWNER' && (
        <Link
          to="/agency/billing"
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
            ultra ? 'bg-highlight text-white hover:bg-highlight/90' : 'bg-accent text-white hover:bg-accent-strong',
          )}
        >
          See plans
        </Link>
      )}
    </div>
  );
}
