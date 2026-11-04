import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { EmailThumbnail } from '@/components/email/thumbnail';
import { Skeleton } from '@/components/ui/display';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago } from '@/lib/format';
import type { Starter, Template } from '@/lib/types';

export interface Design {
  key: string; // "starter:offer-spotlight" or "template:<id>"
  name: string;
  description?: string;
  subject: string | null;
  previewText: string | null;
  html: string | null;
  templateId?: string;
}

export function useDesigns() {
  const starters = useQuery({ queryKey: ['starters'], queryFn: () => api.get<{ starters: Starter[] }>('/api/templates/starters'), staleTime: Infinity });
  const templates = useQuery({ queryKey: ['templates', 'html'], queryFn: () => api.get<{ templates: Template[] }>('/api/templates?include=html') });
  const yours: Design[] = (templates.data?.templates ?? []).map((t) => ({
    key: `template:${t.id}`,
    name: t.name,
    description: `Edited ${ago(t.updatedAt)}`,
    subject: t.subject,
    previewText: t.previewText,
    html: t.html ?? null,
    templateId: t.id,
  }));
  const ready: Design[] = (starters.data?.starters ?? []).map((s) => ({
    key: `starter:${s.id}`,
    name: s.name,
    description: s.description,
    subject: s.subject,
    previewText: s.previewText,
    html: s.html,
  }));
  return { yours, ready, loading: starters.isPending || templates.isPending };
}

function Card({ d, selected, onPick, busy }: { d: Design; selected?: boolean; onPick: (d: Design) => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onPick(d)}
      disabled={busy}
      aria-pressed={selected}
      className={cn(
        'group flex flex-col overflow-hidden rounded-[14px] border bg-surface text-left transition-[border,box-shadow] disabled:opacity-60',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-[#c3c1e0] hover:shadow-[var(--shadow-lift)]',
      )}
    >
      <div className="relative">
        <EmailThumbnail html={d.html} height={200} />
        {selected && (
          <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-accent text-white">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-line-soft px-4 py-3">
        <span className="text-sm font-semibold">{d.name}</span>
        {d.description && <span className="line-clamp-2 text-xs leading-relaxed text-muted">{d.description}</span>}
      </div>
    </button>
  );
}

export function DesignGallery({ onPick, selectedKey, busy }: { onPick: (d: Design) => void; selectedKey?: string; busy?: boolean }) {
  const { yours, ready, loading } = useDesigns();
  if (loading) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[264px] rounded-[14px]" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {yours.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Your templates</h2>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {yours.map((d) => (
              <Card key={d.key} d={d} selected={selectedKey === d.key} onPick={onPick} busy={busy} />
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Ready-made designs</h2>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ready.map((d) => (
            <Card key={d.key} d={d} selected={selectedKey === d.key} onPick={onPick} busy={busy} />
          ))}
        </div>
      </section>
    </div>
  );
}
