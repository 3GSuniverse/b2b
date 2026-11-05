import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LayoutTemplate, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DesignGallery } from '@/components/campaigns/design-picker';
import { EmailThumbnail } from '@/components/email/thumbnail';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { PrettyTags } from '@/lib/tags';
import type { Template } from '@/lib/types';

export function TemplatesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const q = useQuery({ queryKey: ['templates', 'html'], queryFn: () => api.get<{ templates: Template[] }>('/api/templates?include=html') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });

  const create = useMutation({
    mutationFn: (d: { key: string; name: string; subject: string | null; previewText: string | null; html: string | null }) =>
      d.key.startsWith('starter:')
        ? api.post<{ template: Template }>('/api/templates/from-starter', { starterId: d.key.slice(8) })
        : api.post<{ template: Template }>('/api/templates', { name: `Copy of ${d.name}`.slice(0, 120), subject: d.subject, previewText: d.previewText, html: d.html }),
    onSuccess: ({ template }) => {
      refresh();
      nav(`/templates/${template.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const duplicate = useMutation({
    mutationFn: (t: Template) => api.post<{ template: Template }>(`/api/templates/${t.id}/duplicate`),
    onSuccess: () => {
      refresh();
      toast.success('Template duplicated');
    },
  });
  const del = useMutation({
    mutationFn: (t: Template) => api.del(`/api/templates/${t.id}`),
    onSuccess: () => {
      refresh();
      setDeleting(null);
      toast.success('Template deleted');
    },
    onError: (e: Error) => {
      setDeleting(null);
      toast.error(e.message);
    },
  });

  const list = q.data?.templates ?? [];

  return (
    <>
      <PageHeader
        title="Templates"
        description="Designs you reuse. Broadcasts copy a template when they start, so editing one never changes what was already sent."
        actions={
          <Button variant="primary" onClick={() => setPicking(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            New template
          </Button>
        }
      />
      {q.isPending ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[300px] rounded-[var(--radius-panel)]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState icon={<LayoutTemplate />} title="No templates yet" action={<Button variant="primary" onClick={() => setPicking(true)}>Start from a design</Button>}>
            Save designs you use often, like your monthly offers email or the trip reminder.
          </EmptyState>
        </Panel>
      ) : (
        <div className="stagger grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <Panel key={t.id} className="group relative flex flex-col overflow-hidden lift">
              <EmailThumbnail html={t.html} height={210} />
              <div className="flex items-start gap-3 border-t border-line-soft px-4 py-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link to={`/templates/${t.id}`} className="truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
                    {t.name}
                  </Link>
                  <span className="truncate text-xs text-muted">{t.subject ? <PrettyTags text={t.subject} /> : 'No subject'}</span>
                  <span className="text-[11px] text-faint">Edited {ago(t.updatedAt)}</span>
                </div>
                <div className="relative z-10">
                  <Menu
                    trigger={
                      <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for ${t.name}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    }
                  >
                    <MenuItem icon={<Pencil />} onSelect={() => nav(`/templates/${t.id}`)}>
                      Edit
                    </MenuItem>
                    <MenuItem icon={<Copy />} onSelect={() => duplicate.mutate(t)}>
                      Duplicate
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(t)}>
                      Delete
                    </MenuItem>
                  </Menu>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Dialog open={picking} onOpenChange={setPicking} title="New template" description="Start from a ready-made design or one of yours." className="max-w-5xl">
        <DesignGallery busy={create.isPending} onPick={(d) => create.mutate(d)} />
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Broadcasts already sent with it aren’t affected."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              Delete template
            </Button>
          </>
        }
      />
    </>
  );
}
