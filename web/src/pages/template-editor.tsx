import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useFields } from '@/components/contacts/contact-sheet';
import { DeviceToggle, EmailPreview, type Device } from '@/components/email/email-frame';
import { VisualEditor } from '@/components/email/visual-editor';
import { Button } from '@/components/ui/button';
import { Panel, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Rendered, Template } from '@/lib/types';

interface Draft {
  name: string;
  subject: string;
  previewText: string;
  html: string;
}
const toDraft = (t: Template): Draft => ({ name: t.name, subject: t.subject ?? '', previewText: t.previewText ?? '', html: t.html ?? '' });

export function TemplateEditorPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { tenant } = useSession();
  const fields = useFields();
  const q = useQuery({ queryKey: ['template', id], queryFn: () => api.get<{ template: Template }>(`/api/templates/${id}`) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const saved = useRef<Draft | null>(null);
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [previewing, setPreviewing] = useState(false);
  const [device, setDevice] = useState<Device>('mobile');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (q.data && !draft) {
      const d = toDraft(q.data.template);
      saved.current = d;
      setDraft(d);
    }
  }, [q.data, draft]);

  const save = useCallback(async () => {
    if (!draft || !saved.current) return;
    const diff = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== saved.current![k as keyof Draft]));
    if (!Object.keys(diff).length) return;
    setState('saving');
    try {
      const body: Record<string, unknown> = { ...diff };
      if ('name' in body) body.name = draft.name.trim() || 'Untitled template';
      if ('subject' in body) body.subject = draft.subject || null;
      if ('previewText' in body) body.previewText = draft.previewText || null;
      await api.patch(`/api/templates/${id}`, body);
      saved.current = { ...saved.current, ...diff } as Draft;
      setState('saved');
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template', id], refetchType: 'none' });
    } catch (e) {
      setState('error');
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t save. Check your connection.');
    }
  }, [draft, id, qc]);

  useEffect(() => {
    if (!draft) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
    return () => clearTimeout(timer.current);
  }, [draft, save]);

  const preview = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ rendered: Rendered | null }>(`/api/templates/${id}/preview`);
    },
  });

  if (q.error) return <Navigate to="/templates" replace />;
  if (!draft) return <Skeleton className="h-[640px] rounded-[var(--radius-panel)]" />;
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to="/templates" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Templates
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <input
              aria-label="Template name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              className="-ml-1 w-full max-w-xl rounded-lg bg-transparent px-1 py-0.5 text-[26px] font-semibold tracking-[-0.025em] outline-none hover:bg-hover focus:bg-surface focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
            <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted sm:inline-flex" aria-live="polite">
              {state === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : state === 'saved' ? <Check className="h-3 w-3" /> : null}
              {state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : <span className="text-danger">Not saved</span>}
            </span>
          </div>
          <Button
            onClick={() => {
              setPreviewing(true);
              preview.mutate();
            }}
          >
            <Eye className="h-4 w-4" />
            Preview
          </Button>
        </div>
      </header>

      <Panel className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Subject line" aside={`${draft.subject.length} / 60`}>
          {(p) => <Input {...p} value={draft.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="{first_name|Hello}, your trip is almost here" />}
        </Field>
        <Field label="Preview text" aside={`${draft.previewText.length} / 90`}>
          {(p) => <Input {...p} value={draft.previewText} onChange={(e) => set({ previewText: e.target.value })} placeholder="Everything you need for the journey" />}
        </Field>
      </Panel>

      <Panel className="flex h-[min(78vh,880px)] min-h-[560px] flex-col overflow-hidden">
        <VisualEditor html={draft.html} onChange={(html) => set({ html })} fields={fields.data?.fields ?? []} />
      </Panel>

      <Sheet open={previewing} onOpenChange={setPreviewing} title="Preview" description="With sample details filled in, and the footer added when sending." width="max-w-[720px]">
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <DeviceToggle value={device} onChange={setDevice} />
          </div>
          {preview.isPending ? (
            <Skeleton className="h-[560px]" />
          ) : (
            <EmailPreview html={preview.data?.rendered?.html ?? null} device={device} fromName={tenant.name} subject={preview.data?.rendered?.subject ?? draft.subject} previewText={draft.previewText} />
          )}
        </div>
      </Sheet>
    </>
  );
}
