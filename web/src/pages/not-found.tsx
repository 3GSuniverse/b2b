import { Compass } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { EmptyState, Panel } from '@/components/ui/display';

export function NotFoundPage() {
  return (
    <Panel>
      <EmptyState icon={<Compass />} title="This page doesn't exist" action={<LinkButton to="/" variant="primary">Go to Overview</LinkButton>}>
        The link may be old, or the item was deleted.
      </EmptyState>
    </Panel>
  );
}
