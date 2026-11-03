import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ListPlus, ListX, MessageCircle, Search, Trash2, Upload, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AddContactSheet } from '@/components/contacts/add-contact';
import { ContactSheet } from '@/components/contacts/contact-sheet';
import { ImportWizard } from '@/components/contacts/import-wizard';
import { ListsView } from '@/components/contacts/lists-view';
import { Button } from '@/components/ui/button';
import { Checkbox, Segmented, Tabs } from '@/components/ui/controls';
import { Avatar, EmptyState, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Input, NativeSelect } from '@/components/ui/field';
import { Dialog, Menu, MenuItem } from '@/components/ui/overlay';
import { api, ApiError, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, n, phone } from '@/lib/format';
import { SubscriptionBadge } from '@/lib/status';
import type { Contact, ContactList, SubscriptionStatus } from '@/lib/types';

type StatusTab = 'ALL' | SubscriptionStatus;
interface Stats {
  all: number;
  subscribed: number;
  unsubscribed: number;
  bounced: number;
  complained: number;
}
interface Page {
  contacts: Contact[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

const PAGE_SIZE = 25;
export const fullName = (c: Pick<Contact, 'firstName' | 'lastName'>) => [c.firstName, c.lastName].filter(Boolean).join(' ');

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const view = params.get('view') === 'lists' ? 'lists' : 'people';
  const status = (params.get('status') as StatusTab | null) ?? 'ALL';
  const listId = params.get('list') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounced(search.trim());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) setParam({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setSelected(new Set()), [status, listId, debounced, page]);

  const stats = useQuery({ queryKey: ['contact-stats'], queryFn: () => api.get<{ stats: Stats }>('/api/contacts/stats') });
  const lists = useQuery({ queryKey: ['lists'], queryFn: () => api.get<{ lists: ContactList[] }>('/api/lists') });
  const q = useQuery({
    queryKey: ['contacts', { status, listId, search: debounced, page }],
    queryFn: () =>
      api.get<Page>(`/api/contacts${qs({ status: status === 'ALL' ? undefined : status, listId, search: debounced, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contacts'] });
    qc.invalidateQueries({ queryKey: ['contact-stats'] });
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const ids = [...selected];
  const addToList = useMutation({
    mutationFn: (l: ContactList) => api.post<{ added: number }>(`/api/lists/${l.id}/members`, { contactIds: ids }).then((r) => ({ ...r, l })),
    onSuccess: ({ added, l }) => {
      toast.success(`Added ${n(added)} to ${l.name}`);
      setSelected(new Set());
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeFromList = useMutation({
    mutationFn: () => api.post<{ removed: number }>(`/api/lists/${listId}/members/remove`, { contactIds: ids }),
    onSuccess: ({ removed }) => {
      toast.success(`Removed ${n(removed)} from the list`);
      setSelected(new Set());
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => api.post<{ deleted: number }>('/api/contacts/delete', { contactIds: ids }),
    onSuccess: ({ deleted }) => {
      toast.success(`Deleted ${n(deleted)} contact${deleted === 1 ? '' : 's'}`);
      setSelected(new Set());
      setConfirmDelete(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e instanceof ApiError && e.status === 403 ? 'Only admins can delete contacts.' : e.message),
  });

  const s = stats.data?.stats;
  const rows = q.data?.contacts ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id));
  const activeList = lists.data?.lists.find((l) => l.id === listId);
  const filtered = status !== 'ALL' || !!listId || !!debounced;

  const tabs = useMemo(
    () =>
      [
        { value: 'ALL', label: 'All', count: s && n(s.all) },
        { value: 'SUBSCRIBED', label: 'Subscribed', count: s && n(s.subscribed) },
        { value: 'UNSUBSCRIBED', label: 'Unsubscribed', count: s && n(s.unsubscribed) },
        { value: 'BOUNCED', label: 'Bounced', count: s && n(s.bounced) },
        { value: 'COMPLAINED', label: 'Marked as spam', count: s && n(s.complained) },
      ] as { value: StatusTab; label: string; count?: string }[],
    [s],
  );

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone you can email. Unsubscribes, bounces and spam reports are kept here so they're never emailed again."
        actions={
          <>
            <Button onClick={() => setParam({ import: '1' })}>
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button variant="primary" onClick={() => setParam({ add: '1' })}>
              <UserPlus className="h-4 w-4" />
              Add contact
            </Button>
          </>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <Segmented
          label="View"
          value={view}
          onChange={(v) => setParam({ view: v === 'lists' ? 'lists' : null })}
          options={[
            { value: 'people', label: 'People' },
            { value: 'lists', label: `Lists${lists.data ? ` (${lists.data.lists.length})` : ''}` },
          ]}
        />
      </div>

      {view === 'lists' ? (
        <ListsView lists={lists.data?.lists} onOpen={(id) => setParam({ view: null, list: id, page: null })} />
      ) : s && s.all === 0 ? (
        <Panel>
          <EmptyState
            icon={<Users />}
            title="No contacts yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setParam({ import: '1' })}>
                  <Upload className="h-4 w-4" />
                  Import a CSV
                </Button>
                <Button onClick={() => setParam({ add: '1' })}>Add one by hand</Button>
              </div>
            }
          >
            Export your customer list from Excel or your booking system as a CSV. Names, phone numbers, trip dates and birthdays all come along.
          </EmptyState>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="px-5 pt-2 sm:px-6">
            <Tabs label="Filter by status" value={status} onChange={(v) => setParam({ status: v === 'ALL' ? null : v, page: null })} tabs={tabs} />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-4 sm:px-6">
            <div className="w-full min-w-0 sm:w-auto sm:max-w-sm sm:flex-1">
              <Input
                leading={<Search className="h-4 w-4" />}
                placeholder="Search name, email or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search contacts"
                className="h-10"
              />
            </div>
            <NativeSelect value={listId} onChange={(e) => setParam({ list: e.target.value || null, page: null })} aria-label="Filter by list" className="h-10 min-w-0 flex-1 sm:w-auto sm:min-w-44 sm:flex-none">
              <option value="">All lists</option>
              {lists.data?.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({n(l.members)})
                </option>
              ))}
            </NativeSelect>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setParam({ status: null, list: null, q: null, page: null });
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
            <span className="tnum ml-auto text-[13px] text-muted">{q.data ? `${n(q.data.total)} ${q.data.total === 1 ? 'contact' : 'contacts'}` : ''}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-xs font-semibold text-muted">
                  <th className="w-12 py-3 pl-5 sm:pl-6">
                    <Checkbox
                      label="Select all on this page"
                      checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                      onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <th className="py-3 pr-4 font-semibold">Name</th>
                  <th className="py-3 pr-4 font-semibold">Phone</th>
                  <th className="py-3 pr-4 font-semibold">Lists</th>
                  <th className="py-3 pr-4 font-semibold">Email status</th>
                  <th className="py-3 pr-6 text-right font-semibold">Added</th>
                </tr>
              </thead>
              <tbody className={cn(q.isPlaceholderData && 'opacity-60 transition-opacity')}>
                {q.isPending
                  ? Array.from({ length: 8 }, (_, i) => (
                      <tr key={i} className="border-b border-line-soft">
                        <td className="py-3.5 pl-6" colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))
                  : rows.map((c) => {
                      const checked = selected.has(c.id);
                      const name = fullName(c);
                      return (
                        <tr
                          key={c.id}
                          onClick={() => setParam({ contact: c.id })}
                          className={cn('cursor-pointer border-b border-line-soft last:border-0 hover:bg-sunken', checked && 'bg-accent-soft/40 hover:bg-accent-soft/60')}
                        >
                          <td className="py-3 pl-5 sm:pl-6" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              label={`Select ${name || c.email}`}
                              checked={checked}
                              onCheckedChange={(v) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (v) next.add(c.id);
                                  else next.delete(c.id);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar name={name} email={c.email} size={34} />
                              <div className="flex min-w-0 flex-col">
                                <button
                                  type="button"
                                  className="truncate text-left font-semibold hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setParam({ contact: c.id });
                                  }}
                                >
                                  {name || c.email || c.phone}
                                </button>
                                <span className="truncate text-[13px] text-muted">{c.email ?? 'No email'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="tnum whitespace-nowrap py-3 pr-4 text-ink-2">
                            {c.phone ? (
                              <span className="inline-flex items-center gap-1.5">
                                {phone(c.phone)}
                                {c.whatsappStatus === 'SUBSCRIBED' && (
                                  <span title="Agreed to WhatsApp messages" className="grid h-4 w-4 place-items-center rounded-full bg-[#e7f8ee] text-[#128c4a]">
                                    <MessageCircle className="h-2.5 w-2.5" aria-label="Agreed to WhatsApp messages" />
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex flex-wrap gap-1">
                              {c.lists.slice(0, 2).map((l) => (
                                <span key={l.id} className="whitespace-nowrap rounded-md bg-line-soft px-2 py-0.5 text-xs font-medium text-ink-2">
                                  {l.name}
                                </span>
                              ))}
                              {c.lists.length > 2 && <span className="rounded-md px-1 py-0.5 text-xs font-medium text-muted">+{c.lists.length - 2}</span>}
                              {c.lists.length === 0 && <span className="text-faint">—</span>}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <SubscriptionBadge status={c.emailStatus} />
                          </td>
                          <td className="tnum whitespace-nowrap py-3 pr-6 text-right text-[13px] text-muted">{date(c.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
            {q.data && rows.length === 0 && (
              <EmptyState icon={<Search />} title="No contacts match">
                Try a different name, or clear the filters.
              </EmptyState>
            )}
          </div>

          {q.data && q.data.pages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-3 sm:px-6">
              <span className="tnum text-[13px] text-muted">
                {n((q.data.page - 1) * q.data.pageSize + 1)}–{n(Math.min(q.data.page * q.data.pageSize, q.data.total))} of {n(q.data.total)}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tnum px-2 text-[13px] text-ink-2">
                  Page {q.data.page} of {q.data.pages}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= q.data.pages} onClick={() => setParam({ page: String(page + 1) })}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* Floating bulk-action bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 animate-pop">
          <div role="toolbar" aria-label="Selected contacts" className="flex items-center gap-1 rounded-[14px] bg-ink p-1.5 pl-4 text-white shadow-[var(--shadow-pop)]">
            <span className="tnum mr-2 text-sm font-semibold">{n(selected.size)} selected</span>
            <Menu
              align="start"
              trigger={
                <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold hover:bg-white/10">
                  <ListPlus className="h-4 w-4" />
                  Add to list
                </button>
              }
            >
              {lists.data?.lists.length ? (
                lists.data.lists.map((l) => (
                  <MenuItem key={l.id} onSelect={() => addToList.mutate(l)}>
                    {l.name}
                  </MenuItem>
                ))
              ) : (
                <p className="px-2.5 py-2 text-[13px] text-muted">Create a list first, in the Lists view.</p>
              )}
            </Menu>
            {activeList && (
              <button type="button" onClick={() => removeFromList.mutate()} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold hover:bg-white/10">
                <ListX className="h-4 w-4" />
                Remove from {activeList.name}
              </button>
            )}
            <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold text-[#ffb4ab] hover:bg-white/10">
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10" aria-label="Clear selection">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${n(selected.size)} contact${selected.size === 1 ? '' : 's'}?`}
        description="Their details and history are erased. Anyone who unsubscribed or bounced stays blocked, so they can't be emailed by mistake if re-imported."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep them</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Delete permanently
            </Button>
          </>
        }
      />

      <ContactSheet id={params.get('contact')} onClose={() => setParam({ contact: null })} onChanged={refresh} lists={lists.data?.lists ?? []} />
      <AddContactSheet
        open={params.get('add') === '1'}
        onClose={() => setParam({ add: null })}
        lists={lists.data?.lists ?? []}
        onCreated={(c) => {
          refresh();
          setParam({ add: null, contact: c.id });
        }}
      />
      <ImportWizard open={params.get('import') === '1'} onClose={() => setParam({ import: null })} lists={lists.data?.lists ?? []} onDone={refresh} />
    </>
  );
}
