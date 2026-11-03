import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListPlus, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState, Panel, ProgressBar, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { date, n } from '@/lib/format';
import type { ContactList } from '@/lib/types';

export function ListsView({ lists, onOpen }: { lists?: ContactList[]; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [deleting, setDeleting] = useState<ContactList | null>(null);

  const save = useMutation({
    mutationFn: (l: { id?: string; name: string; description: string }) =>
      l.id ? api.patch(`/api/lists/${l.id}`, { name: l.name, description: l.description }) : api.post('/api/lists', { name: l.name, description: l.description || undefined }),
    onSuccess: (_r, l) => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      toast.success(l.id ? 'List saved' : 'List created');
      setEditing(null);
    },
  });
  const del = useMutation({
    mutationFn: (l: ContactList) => api.del(`/api/lists/${l.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('List deleted. The contacts in it were kept.');
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e instanceof ApiError && e.status === 403 ? 'Only admins can delete lists.' : e.message),
  });

  if (!lists) return <Skeleton className="h-48 rounded-[var(--radius-panel)]" />;

  return (
    <>
      {lists.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ListPlus />}
            title="Group people into lists"
            action={
              <Button variant="primary" onClick={() => setEditing({ name: '', description: '' })}>
                Create a list
              </Button>
            }
          >
            For example “Past travellers” or “Pilgrimage interest”. A campaign can go to one list or several.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lists.map((l) => (
            <Panel key={l.id} className="group relative flex flex-col gap-4 p-5 transition-shadow hover:shadow-[var(--shadow-lift)]">
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={() => onOpen(l.id)} className="flex min-w-0 flex-col gap-1 text-left after:absolute after:inset-0 after:content-['']">
                  <span className="truncate text-[15px] font-semibold">{l.name}</span>
                  <span className="line-clamp-2 text-[13px] leading-relaxed text-muted">{l.description || `Created ${date(l.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}`}</span>
                </button>
                <Menu
                  trigger={
                    <button type="button" className="relative z-10 -mr-2 -mt-1 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for ${l.name}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
                >
                  <MenuItem icon={<Users />} onSelect={() => onOpen(l.id)}>
                    View people
                  </MenuItem>
                  <MenuItem icon={<Pencil />} onSelect={() => setEditing({ id: l.id, name: l.name, description: l.description ?? '' })}>
                    Rename
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(l)}>
                    Delete list
                  </MenuItem>
                </Menu>
              </div>
              <div className="mt-auto flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span>
                    <span className="tnum text-xl font-semibold tracking-tight">{n(l.members)}</span> <span className="text-muted">people</span>
                  </span>
                  <span className="tnum text-muted">{n(l.subscribed)} can receive email</span>
                </div>
                <ProgressBar value={l.subscribed} max={Math.max(l.members, 1)} label={`${l.name}: subscribed share`} />
              </div>
            </Panel>
          ))}
          <button
            type="button"
            onClick={() => setEditing({ name: '', description: '' })}
            className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-[#cfd5d1] text-sm font-semibold text-ink-2 hover:border-accent hover:bg-accent-soft/40 hover:text-accent-strong"
          >
            <ListPlus className="h-5 w-5" />
            New list
          </button>
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.id ? 'Rename list' : 'New list'}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => editing && save.mutate(editing)}>
              {editing?.id ? 'Save' : 'Create list'}
            </Button>
          </>
        }
      >
        {editing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
          >
            <Field label="Name" error={save.error instanceof ApiError ? save.error.field('name') : undefined}>
              {(p) => <Input {...p} autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Past travellers" />}
            </Field>
            <Field label="Description" hint="Optional. Helps your team pick the right list.">
              {(p) => <Input {...p} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />}
            </Field>
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Only the list is removed. The people in it stay in your contacts."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep list</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              Delete list
            </Button>
          </>
        }
      />
    </>
  );
}
