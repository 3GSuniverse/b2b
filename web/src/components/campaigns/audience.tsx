import { useQuery } from '@tanstack/react-query';
import { Filter, Plus, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFields } from '@/components/contacts/contact-sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import { Input, NativeSelect } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { n } from '@/lib/format';
import type { Audience, AudienceFilter, ContactList } from '@/lib/types';

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
export function describeAudience(a: Audience | null, lists: ContactList[], labelOf: (key: string) => string) {
  const ids = a?.listIds ?? [];
  const names = ids.map((id) => lists.find((l) => l.id === id)?.name ?? 'a deleted list');
  const who = names.length === 0 ? 'Everyone who’s subscribed' : names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
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
  const listIds = a.listIds ?? [];
  const filters = a.filters ?? [];
  const mode = listIds.length ? 'lists' : 'everyone';
  const allFields = [...CORE_FIELDS, ...(fields.data?.fields.map((f) => ({ key: f.key, label: f.label })) ?? [])];

  const setFilters = (next: AudienceFilter[]) => onChange({ ...a, filters: next });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Who gets this">
        {(
          [
            ['everyone', 'Everyone who’s subscribed', channel === 'WHATSAPP' ? 'Everyone who agreed to WhatsApp messages' : 'All contacts who can receive email'],
            ['lists', 'People in lists', 'Pick one or more lists'],
          ] as const
        ).map(([m, title, sub]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => onChange({ ...a, listIds: m === 'everyone' ? [] : listIds.length ? listIds : lists.data?.lists[0] ? [lists.data.lists[0].id] : [] })}
            className={cn(
              'flex items-start gap-3 rounded-[12px] border p-3.5 text-left transition-colors',
              mode === m ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-[#cfd5d1]',
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
        <div className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-line">
          {lists.data?.lists.length === 0 && <p className="px-4 py-3 text-sm text-muted">You don’t have any lists yet. Create one in Contacts.</p>}
          {lists.data?.lists.map((l) => {
            const on = listIds.includes(l.id);
            return (
              <label key={l.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-sunken">
                <Checkbox label={l.name} checked={on} onCheckedChange={(v) => onChange({ ...a, listIds: v ? [...listIds, l.id] : listIds.filter((x) => x !== l.id) })} />
                <span className="flex-1 text-sm font-medium">{l.name}</span>
                <span className="tnum text-[13px] text-muted">{channel === 'WHATSAPP' ? `${n(l.members)} people` : `${n(l.subscribed)} subscribed`}</span>
              </label>
            );
          })}
        </div>
      )}

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
          <Button size="sm" variant="ghost" onClick={() => setFilters([...filters, { field: allFields[4]?.key ?? 'first_name', op: 'eq', value: '' }])}>
            {filters.length ? <Plus className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
            {filters.length ? 'Add another condition' : 'Only people where…'}
          </Button>
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-strong" aria-live="polite">
            <Users className="h-4 w-4" />
            <span className="tnum">{count.data ? n(count.data.count) : '…'}</span> {count.data?.count === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>
    </div>
  );
}
