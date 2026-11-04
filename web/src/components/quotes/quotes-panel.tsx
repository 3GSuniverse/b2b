import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { QUOTE_STATUS } from '@/pages/quote-editor';
import { api } from '@/lib/api';
import { ago, inr } from '@/lib/format';
import type { Quote, TripDetail } from '@/lib/types';

/** The trip's quotes, newest first, with what the customer did with each. */
export function QuotesPanel({ trip }: { trip: TripDetail }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['quotes', trip.id], queryFn: () => api.get<{ quotes: Quote[] }>(`/api/trips/${trip.id}/quotes`).then((r) => r.quotes) });
  const create = useMutation({
    mutationFn: () => api.post<{ quote: Quote }>(`/api/trips/${trip.id}/quotes`),
    onSuccess: ({ quote }) => {
      qc.invalidateQueries({ queryKey: ['quotes', trip.id] });
      nav(`/trips/${trip.id}/quotes/${quote.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const quotes = q.data ?? [];
  if (q.isPending) return <Skeleton className="h-28 rounded-[var(--radius-panel)]" />;
  // A booked or finished trip without quotes doesn't need this panel
  if (!quotes.length && !['ENQUIRY', 'QUOTED'].includes(trip.status)) return null;

  return (
    <Panel className="flex flex-col">
      <div className="p-5 sm:p-6">
        <PanelHeader
          title="Quotes"
          description={!quotes.length ? 'A day-by-day plan with your prices, which the customer can open and accept from their phone.' : undefined}
          action={
            <Button size="sm" variant={quotes.length ? 'secondary' : 'primary'} loading={create.isPending} onClick={() => create.mutate()}>
              <Plus className="h-4 w-4" />
              {quotes.length ? 'New version' : 'Make a quote'}
            </Button>
          }
        />
      </div>
      {quotes.length > 0 && (
        <ul className="border-t border-line-soft">
          {quotes.map((x) => {
            const st = QUOTE_STATUS[x.status];
            return (
              <li key={x.id} className="relative grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line-soft px-5 py-3 first:border-0 hover:bg-sunken sm:px-6">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-sunken text-muted">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col">
                  <Link to={`/trips/${trip.id}/quotes/${x.id}`} className="truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
                    Quote{x.version > 1 ? ` v${x.version}` : ''} · {inr(x.totals.total)}
                  </Link>
                  <span className="flex flex-wrap items-center gap-x-2 truncate text-xs text-muted">
                    {x.status === 'DRAFT' && `Edited ${ago(x.updatedAt)}`}
                    {x.status !== 'DRAFT' && x.sentAt && `Sent ${ago(x.sentAt)}`}
                    {x.status === 'SENT' && (
                      <span className="inline-flex items-center gap-1">
                        · <Eye className="h-3 w-3" aria-hidden />
                        {x.viewedAt ? `opened ${ago(x.viewedAt)}` : 'not opened yet'}
                      </span>
                    )}
                    {x.status === 'DECLINED' && x.responseNote && <span className="truncate">· “{x.responseNote}”</span>}
                  </span>
                </span>
                <Badge tone={st.tone}>{st.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
