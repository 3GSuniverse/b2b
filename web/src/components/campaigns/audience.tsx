import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Filter, ListPlus, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { AddContactSheet } from '@/components/contacts/add-contact';
import { useEffect, useState } from 'react';
import { useFields } from '@/components/contacts/contact-sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import { Input, NativeSelect } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/display';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { n } from '@/lib/format';
import type { Audience, AudienceFilter, Contact, ContactList } from '@/lib/types';

const CORE_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
];
const OPS: { value: AudienceFilter['op']; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'is filled in' },
];

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: () => api.get<{ lists: ContactList[] }>('/api/lists') });
}

/** Live "how many people is this" for an audience, debounced. */
export function useAudienceCount(audience: Audience | null, channel: 'EMAIL' | 'WHATSAPP' = 'EMAIL') {
  const [key, setKey] = useState(JSON.stringify({ ...(audience ?? {}), channel }));
  useEffect(() => {
    const t = setTimeout(() => setKey(JSON.stringify({ ...(audience ?? {}), channel })), 300);
    return () => clearTimeout(t);
  }, [audience, channel]);
  return useQuery({
    queryKey: ['audience-count', key],
    queryFn: () => api.post<{ count: number }>('/api/audience/count', JSON.parse(key)),
    placeholderData: (prev) => prev,
  });
}

/** One line in plain words: "Past travellers and Newsletter, where City is Hyderabad" */
export function audienceMode(a: Audience | null): 'everyone' | 'lists' | 'people' {
  return a?.mode ?? (a?.contactIds?.length ? 'people' : a?.listIds?.length ? 'lists' : 'everyone');
}

export function describeAudience(a: Audience | null, lists: ContactList[], labelOf: (key: string) => string) {
  const mode = audienceMode(a);
  const ids = mode === 'lists' ? (a?.listIds ?? []) : [];
  const people = mode === 'people' ? (a?.contactIds?.length ?? 0) : 0;
  const names = ids.map((id) => lists.find((l) => l.id === id)?.name ?? 'a deleted list');
  const who =
    mode === 'people'
      ? people
        ? `${people} hand-picked ${people === 1 ? 'person' : 'people'}`
        : 'Nobody picked yet'
      : mode === 'lists' && names.length === 0
        ? 'No list ticked yet'
        : names.length === 0
          ? 'Everyone who’s subscribed'
          : names.length === 1
            ? names[0]!
            : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const f = (a?.filters ?? []).map((x) => `${labelOf(x.field)} ${OPS.find((o) => o.value === x.op)!.label}${x.op === 'exists' ? '' : ` “${x.value ?? ''}”`}`);
  return f.length ? `${who}, where ${f.join(' and ')}` : who;
}

export function useFieldLabel() {
  const fields = useFields();
  return (key: string) => CORE_FIELDS.find((f) => f.key === key)?.label ?? fields.data?.fields.find((f) => f.key === key)?.label ?? key;
}

export function AudienceEditor({ value, onChange, channel = 'EMAIL' }: { value: Audience | null; onChange: (a: Audience) => void; channel?: 'EMAIL' | 'WHATSAPP' }) {
  const lists = useLists();
  const fields = useFields();
  const count = useAudienceCount(value, channel);
  const a: Audience = value ?? {};
  const mode = audienceMode(value);
  const listIds = mode === 'lists' ? (a.listIds ?? []) : [];
  const contactIds = mode === 'people' ? (a.contactIds ?? []) : [];
  const filters = a.filters ?? [];
  const setMode = (m: 'everyone' | 'lists' | 'people') =>
    onChange({
      ...a,
      mode: m,
      listIds: m === 'lists' ? (a.listIds?.length ? a.listIds : lists.data?.lists.length === 1 ? [lists.data.lists[0]!.id] : []) : [],
      contactIds: m === 'people' ? (a.contactIds ?? []) : [],
    });
  const allFields = [...CORE_FIELDS, ...(fields.data?.fields.map((f) => ({ key: f.key, label: f.label })) ?? [])];

  const setFilters = (next: AudienceFilter[]) => onChange({ ...a, filters: next });

  // Add a customer without leaving the broadcast
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [bump, setBump] = useState(0);
  const added = (c: Contact) => {
    setAdding(false);
    qc.invalidateQueries({ queryKey: ['audience-count'] });
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['contacts'] });
    setBump((b) => b + 1);
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'They';
    const reachable = channel === 'WHATSAPP' ? !!c.phone && c.whatsappStatus === 'SUBSCRIBED' : !!c.email && c.emailStatus === 'SUBSCRIBED';
    // Hand-picking: the new customer is picked straight away
    if (mode === 'people') onChange({ ...a, mode: 'people', contactIds: [...contactIds, c.id] });
    const inLists = mode !== 'lists' || c.lists.some((l) => listIds.includes(l.id));
    if (reachable && inLists) toast.success(`${name} is in this broadcast`, { description: filters.length ? 'As long as they match your conditions.' : undefined });
    else
      toast.message(`${name} was added to Customers`, {
        description: !reachable
          ? channel === 'WHATSAPP'
            ? 'They won’t get this one: they need a phone number and to have agreed to WhatsApp messages.'
            : 'They won’t get this one: they need an email address.'
          : 'They aren’t in the lists this goes to. Add them to one of those lists to include them.',
      });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who gets this">
        {(
          [
            ['everyone', 'Everyone', channel === 'WHATSAPP' ? 'All who agreed to WhatsApp messages' : 'All customers who can receive email'],
            ['lists', 'People in lists', 'Tick one or more lists'],
            ['people', 'Pick people', 'Search and choose customers one by one'],
          ] as const
        ).map(([m, title, sub]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'flex items-start gap-3 rounded-[12px] border p-3.5 text-left transition-[border-color,background,box-shadow] duration-200 active:scale-[0.99]',
              mode === m ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-[#cfcde6]',
            )}
          >
            <span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2', mode === m ? 'border-accent' : 'border-[#c2c8c4]')}>
              {mode === m && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-xs text-muted">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      {mode === 'lists' && (
        <ListPicker
          channel={channel}
          lists={lists.data?.lists}
          selected={listIds}
          onChange={(ids) => onChange({ ...a, mode: 'lists', listIds: ids, contactIds: [] })}
        />
      )}

      {mode === 'people' && <PeoplePicker channel={channel} selected={contactIds} onChange={(ids) => onChange({ ...a, mode: 'people', contactIds: ids, listIds: [] })} onAddNew={() => setAdding(true)} />}

      <div className="flex flex-col gap-2.5">
        {filters.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-[12px] bg-sunken p-2 sm:grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_auto]">
            <NativeSelect
              aria-label="Field"
              className="h-10"
              value={f.field}
              onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
            >
              {allFields.map((fd) => (
                <option key={fd.key} value={fd.key}>
                  {fd.label}
                </option>
              ))}
            </NativeSelect>
            <button type="button" onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink sm:order-last" aria-label="Remove condition">
              <X className="h-4 w-4" />
            </button>
            <NativeSelect
              aria-label="Condition"
              className="h-10"
              value={f.op}
              onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, op: e.target.value as AudienceFilter['op'] } : x)))}
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            {f.op !== 'exists' ? (
              <Input
                aria-label="Value"
                className="h-10"
                placeholder="Hyderabad"
                value={f.value ?? ''}
                onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
            ) : (
              <span />
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setFilters([...filters, { field: allFields[4]?.key ?? 'first_name', op: 'eq', value: '' }])}>
              {filters.length ? <Plus className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
              {filters.length ? 'Add another condition' : 'Only people where…'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)} className="text-accent">
              <UserPlus className="h-4 w-4" />
              Add a customer
            </Button>
          </span>
          <span key={bump} className={cn('inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-strong', bump > 0 && 'add-burst')} aria-live="polite">
            <Users className="h-4 w-4" />
            <span className="tnum">{count.data ? n(count.data.count) : '…'}</span> {count.data?.count === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>
      <AddContactSheet open={adding} onClose={() => setAdding(false)} lists={lists.data?.lists ?? []} defaultListIds={mode === 'lists' ? listIds : []} forChannel={channel} onCreated={added} />
    </div>
  );
}

/** Tick lists; make a new one right here when there are none (or none fit). */
function ListPicker({ channel, lists, selected, onChange }: { channel: 'EMAIL' | 'WHATSAPP'; lists: ContactList[] | undefined; selected: string[]; onChange: (ids: string[]) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ list: ContactList }>('/api/lists', { name: name.trim() }),
    onSuccess: ({ list }) => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      onChange([...selected, list.id]);
      setName('');
      toast.success(`List “${list.name}” made and ticked`, { description: 'Add customers to it with “Add a customer” below, or from Customers.' });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border border-line">
      {!lists ? (
        <Skeleton className="m-3 h-10" />
      ) : lists.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-2">You don’t have any lists yet. Make one below, for example “Past travellers” or “Char Dham enquiries”.</p>
      ) : (
        <div className="flex max-h-72 flex-col divide-y divide-line-soft overflow-y-auto">
          {lists.map((l) => {
            const on = selected.includes(l.id);
            return (
              <label key={l.id} className={cn('flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken', on && 'bg-accent-soft/30')}>
                <Checkbox label={l.name} checked={on} onCheckedChange={(v) => onChange(v ? [...selected, l.id] : selected.filter((x) => x !== l.id))} />
                <span className="flex-1 text-sm font-medium">{l.name}</span>
                <span className="tnum text-[13px] text-muted">{channel === 'WHATSAPP' ? `${n(l.members)} people` : `${n(l.subscribed)} subscribed`}</span>
              </label>
            );
          })}
        </div>
      )}
      {lists && lists.length > 0 && selected.length === 0 && <p className="border-t border-line-soft bg-warm-soft px-4 py-2 text-[13px] text-warm-strong">Tick at least one list. Nobody gets it until you do.</p>}
      <form
        className="flex items-center gap-2 border-t border-line-soft bg-sunken px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <ListPlus className="h-4 w-4 shrink-0 text-muted" />
        <Input aria-label="New list name" className="h-9 flex-1 bg-surface" placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" disabled={!name.trim()} loading={create.isPending}>
          Make list
        </Button>
      </form>
    </div>
  );
}

/** Search customers and pick them one by one. */
function PeoplePicker({ channel, selected, onChange, onAddNew }: { channel: 'EMAIL' | 'WHATSAPP'; selected: string[]; onChange: (ids: string[]) => void; onAddNew: () => void }) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const results = useQuery({
    queryKey: ['contacts', 'pick', term],
    queryFn: () => api.get<{ contacts: Contact[]; total: number }>(`/api/contacts?${new URLSearchParams({ pageSize: '8', ...(term && { search: term }) })}`),
    placeholderData: (p) => p,
  });
  const picked = useQuery({
    queryKey: ['contacts', 'picked', selected.join(',')],
    queryFn: () => api.get<{ contacts: Contact[] }>(`/api/contacts?ids=${selected.join(',')}&pageSize=100`),
    enabled: selected.length > 0,
    placeholderData: (p) => p,
  });
  const nameOf = (c: Contact) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'No name';
  const why = (c: Contact) =>
    channel === 'WHATSAPP'
      ? !c.phone
        ? 'No phone number'
        : c.whatsappStatus !== 'SUBSCRIBED'
          ? 'Hasn’t agreed to WhatsApp'
          : null
      : !c.email
        ? 'No email address'
        : c.emailStatus !== 'SUBSCRIBED'
          ? 'Can’t receive email'
          : null;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const chosen = (picked.data?.contacts ?? []).filter((c) => selected.includes(c.id));

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line p-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((c) => (
            <span key={c.id} className="add-burst inline-flex items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-[13px] font-semibold text-accent-strong">
              {nameOf(c)}
              <button type="button" onClick={() => toggle(c.id)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/70" aria-label={`Remove ${nameOf(c)}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {selected.length > chosen.length && <span className="px-1 py-1 text-[13px] text-muted">and {selected.length - chosen.length} more</span>}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input aria-label="Search customers" className="pl-9" placeholder="Search by name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ul className="flex max-h-72 flex-col overflow-y-auto">
        {results.data?.contacts.map((c) => {
          const on = selected.includes(c.id);
          const block = why(c);
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={!!block && !on}
                onClick={() => toggle(c.id)}
                className={cn('flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-55', on && 'bg-accent-soft/40')}
              >
                <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors', on ? 'border-accent bg-accent text-white' : 'border-[#c2c8c4]')}>{on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{nameOf(c)}</span>
                  <span className="truncate text-xs text-muted">{block ?? (channel === 'WHATSAPP' ? c.phone : c.email)}</span>
                </span>
              </button>
            </li>
          );
        })}
        {results.data && results.data.contacts.length === 0 && <li className="px-2.5 py-3 text-sm text-muted">{term ? `Nobody matches “${term}”.` : 'No customers yet.'}</li>}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2.5 text-[13px]">
        <span className="text-muted">{selected.length ? `${selected.length} picked` : 'Nobody picked yet. Nobody gets it until you pick someone.'}</span>
        <span className="flex gap-1">
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>
              Clear
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-accent" onClick={onAddNew}>
            <UserPlus className="h-4 w-4" /> New customer
          </Button>
        </span>
      </div>
    </div>
  );
}
