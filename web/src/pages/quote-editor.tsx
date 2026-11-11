import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, ExternalLink, Mail, MessageCircle, Plus, Search, Send, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Dialog, Menu, MenuItem } from '@/components/ui/overlay';
import { KINDS, QTY_LABEL, UNITS } from '@/components/quotes/shared';
import { waShare } from '@/components/trips/payments';
import { sanitizeRupees } from '@/components/trips/shared';
import { useRates } from '@/pages/prices';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago, dateRange, inr, rupeesInput, shortDate } from '@/lib/format';
import type { Quote, QuoteLine, RateItem, RateKind, RateUnit, TripDetail } from '@/lib/types';
import { takeoff } from '@/lib/celebrate';
import { tx } from '../lib/words';

type Draft = Pick<Quote, 'intro' | 'days' | 'lines' | 'inclusions' | 'exclusions' | 'terms' | 'validUntil'> & { discount: number };
const toDraft = (q: Quote): Draft => ({ intro: q.intro, days: q.days, lines: q.lines.map(({ total: _t, needsPrice: _n, ...l }) => l), inclusions: q.inclusions, exclusions: q.exclusions, terms: q.terms, validUntil: q.validUntil, discount: q.totals.discount });
const toPaise = (v: string) => {
  const c = v.replace(/[,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(c) ? Math.round(Number(c) * 100) : 0;
};
const lineTotal = (l: QuoteLine) => Math.round(l.quantity * l.times * l.unitPrice);

export const QUOTE_STATUS = { DRAFT: { label: 'Draft', tone: 'grey' }, SENT: { label: 'Sent', tone: 'blue' }, ACCEPTED: { label: 'Accepted', tone: 'green' }, DECLINED: { label: 'Changes asked', tone: 'orange' } } as const;

/** Picks prices from the price list; sensible quantities for this trip. */
function RatePicker({ open, onClose, onPick, destination, nights, travellers, adults }: { open: boolean; onClose: () => void; onPick: (l: QuoteLine) => void; destination: string | null; nights: number; travellers: number; adults: number }) {
  const rates = useRates(destination ?? undefined);
  const [term, setTerm] = useState('');
  const shown = (rates.data ?? []).filter((r) => !term || tx(`${r.name} ${r.destination ?? ''}`).toLowerCase().includes(term.toLowerCase()));
  const pick = (r: RateItem) => {
    const qty = r.unit === 'PER_NIGHT' ? Math.max(1, Math.ceil(adults / 2)) : r.unit === 'PER_PERSON' ? travellers : 1;
    const times = r.unit === 'PER_NIGHT' ? Math.max(1, nights) : r.unit === 'PER_DAY' ? Math.max(1, nights + 1) : 1;
    onPick({ label: r.name, kind: r.kind, unit: r.unit, quantity: qty, times, unitPrice: r.price, unitCost: r.cost, rateItemId: r.id });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add from your price list" description={destination ? tx(`Prices for ${destination} first.`) : undefined}>
      <div className="flex flex-col gap-3">
        <Input autoFocus aria-label="Search prices" leading={<Search className="h-4 w-4" />} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Houseboat, Innova…" />
        {rates.isPending && <Skeleton className="h-24" />}
        {!rates.isPending && !shown.length && (
          <p className="py-6 text-center text-[13px] text-muted">
            {rates.data?.length ? 'Nothing matches.' : 'Your price list is empty.'}{' '}
            <Link to="/trips/prices" className="font-semibold text-accent hover:underline">
              Add prices
            </Link>
          </p>
        )}
        <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => pick(r)} className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-hover">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="truncate text-xs text-muted">
                    {KINDS[r.kind]}
                    {r.destination ? tx(` · ${r.destination}`) : ''} · {UNITS[r.unit].label}
                  </span>
                </span>
                <span className="tnum shrink-0 text-sm font-semibold">{inr(r.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function AiDialog({ quoteId, open, onClose, onDraft }: { quoteId: string; open: boolean; onClose: () => void; onDraft: (d: Partial<Draft>) => void }) {
  const [language, setLanguage] = useState<'en' | 'te' | 'hi'>('en');
  const [instructions, setInstructions] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ draft: Partial<Draft> & { lines: (QuoteLine & { needsPrice: boolean })[] } }>(`/api/quotes/${quoteId}/draft`, { language, instructions: instructions || undefined }),
    onSuccess: ({ draft }) => {
      onDraft(draft);
      const unpriced = draft.lines.filter((l) => l.needsPrice).length;
      toast.success('Draft ready. Read it through before sending.', { description: unpriced ? `${unpriced} item${unpriced > 1 ? 's aren’t' : ' isn’t'} on your price list: add the price.` : undefined });
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !m.isPending && onClose()}
      title="Draft with AI"
      description={tx("Writes the day-by-day plan from the trip details and picks items from your price list. It replaces what’s in the quote now. Prices always come from your list.")}
      footer={
        <>
          <Button onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            <Sparkles className="h-4 w-4" />
            {m.isPending ? 'Writing…' : 'Write the draft'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Language for the customer">
          {(p) => (
            <NativeSelect {...p} value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
              <option value="en">English</option>
              <option value="te">Telugu</option>
              <option value="hi">Hindi</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="Anything it should know?" hint="Optional. E.g. “houseboat on the last night, no early starts, vegetarian food”.">
          {(p) => <Textarea {...p} rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
        </Field>
        {m.error && <p className="text-[13px] text-danger">{m.error.message}</p>}
      </div>
    </Dialog>
  );
}

export function QuoteEditorPage() {
  const { tripId, quoteId } = useParams<{ tripId: string; quoteId: string }>();
  const qc = useQueryClient();
  const nav = useNavigate();
  const tq = useQuery({ queryKey: ['trip', tripId], queryFn: () => api.get<{ trip: TripDetail }>(`/api/trips/${tripId}`).then((r) => r.trip) });
  const qq = useQuery({ queryKey: ['quote', quoteId], queryFn: () => api.get<{ quote: Quote }>(`/api/quotes/${quoteId}`).then((r) => r.quote) });
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api.get<{ enabled: boolean }>('/api/ai'), staleTime: 300_000 });
  const [d, setD] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [picking, setPicking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (qq.data && loaded.current !== qq.data.id) {
      loaded.current = qq.data.id;
      setD(toDraft(qq.data));
    }
  }, [qq.data]);

  const quote = qq.data;
  const editable = quote?.status === 'DRAFT';

  // Saves a moment after the last change
  const save = useMutation({
    // Half-typed rows (an empty line, an item with no name yet) wait until they're filled in
    mutationFn: (draft: Draft) =>
      api.patch<{ quote: Quote }>(`/api/quotes/${quoteId}`, {
        ...draft,
        lines: draft.lines.filter((l) => l.label.trim()),
        inclusions: draft.inclusions.map((x) => x.trim()).filter(Boolean),
        exclusions: draft.exclusions.map((x) => x.trim()).filter(Boolean),
      }),
    onSuccess: ({ quote: q }) => {
      qc.setQueryData(['quote', quoteId], q);
      setSaveState('saved');
    },
    onError: () => setSaveState('error'),
  });
  useEffect(() => {
    if (!d || !editable || saveState !== 'dirty') return;
    const t = setTimeout(() => {
      setSaveState('saving');
      save.mutate(d);
    }, 700);
    return () => clearTimeout(t);
  }, [d, editable, saveState]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (patch: Partial<Draft>) => {
    setD((cur) => (cur ? { ...cur, ...patch } : cur));
    setSaveState('dirty');
  };

  const send = useMutation({
    mutationFn: (via: 'EMAIL' | 'MANUAL') => api.post<{ quote: Quote }>(`/api/quotes/${quoteId}/send`, { via }),
    onSuccess: ({ quote: q }, via) => {
      if (via === 'EMAIL') takeoff();
      qc.setQueryData(['quote', quoteId], q);
      qc.invalidateQueries({ queryKey: ['trip', tripId] });
      qc.invalidateQueries({ queryKey: ['quotes', tripId] });
      qc.invalidateQueries({ queryKey: ['trips'] });
      toast.success(via === 'EMAIL' ? 'Quote emailed' : 'Quote marked as sent');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const newVersion = useMutation({
    mutationFn: () => api.post<{ quote: Quote }>(`/api/trips/${tripId}/quotes`),
    onSuccess: ({ quote: q }) => {
      qc.invalidateQueries({ queryKey: ['quotes', tripId] });
      nav(`/trips/${tripId}/quotes/${q.id}`);
    },
  });

  const trip = tq.data;
  const totals = useMemo(() => {
    if (!d || !trip) return null;
    const subtotal = d.lines.reduce((a, l) => a + lineTotal(l), 0);
    const total = Math.max(0, subtotal - d.discount);
    const costKnown = d.lines.length > 0 && d.lines.every((l) => l.unitCost !== null && l.unitCost !== undefined);
    const cost = d.lines.reduce((a, l) => a + Math.round(l.quantity * l.times * (l.unitCost ?? 0)), 0);
    const people = trip.adults + trip.children;
    return { subtotal, total, perPerson: people ? Math.round(total / people) : null, margin: costKnown ? total - cost : null, people };
  }, [d, trip]);

  if (!quote || !trip || !d || !totals) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 w-96" />
        <Skeleton className="h-[480px] rounded-[var(--radius-panel)]" />
      </div>
    );
  }

  const nights = trip.startDate && trip.endDate ? Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86_400_000) : 0;
  const dayDate = (i: number) => (trip.startDate ? shortDate(new Date(Date.parse(`${trip.startDate}T00:00:00`) + i * 86_400_000).toISOString().slice(0, 10)) : null);
  const setLine = (i: number, patch: Partial<QuoteLine>) => change({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const moveDay = (i: number, by: number) => {
    const days = [...d.days];
    const [x] = days.splice(i, 1);
    days.splice(i + by, 0, x!);
    change({ days });
  };
  const first = trip.customer.name.split(' ')[0];
  const shareText = tx(`Hi ${first}, here is the plan and price for your ${trip.title}: ${quote.url}`);
  const st = QUOTE_STATUS[quote.status];

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to={`/trips/${tripId}`} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />#{trip.number} {trip.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">
              Quote{quote.version > 1 ? ` v${quote.version}` : ''}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
              {[trip.customer.name, dateRange(trip.startDate, trip.endDate), tx(`${totals.people} traveller${totals.people === 1 ? '' : 's'}`)].filter(Boolean).join(' · ')}
              {editable && <span aria-live="polite">· {saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved' : saveState === 'error' ? 'Couldn’t save' : 'Saved'}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable && ai.data?.enabled && (
              <Button onClick={() => setDrafting(true)}>
                <Sparkles className="h-4 w-4" />
                Draft with AI
              </Button>
            )}
            <a className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold hover:bg-hover" href={`${quote.url}?preview=1`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Preview
            </a>
            {quote.status === 'DRAFT' || quote.status === 'SENT' ? (
              <Menu
                trigger={
                  <Button variant="primary" loading={send.isPending}>
                    <Send className="h-4 w-4" />
                    {quote.status === 'SENT' ? 'Send again' : 'Send'}
                  </Button>
                }
              >
                <MenuItem
                  icon={<MessageCircle />}
                  onSelect={() => {
                    window.open(waShare(trip.customer.phone, shareText), '_blank', 'noopener');
                    send.mutate('MANUAL');
                  }}
                >
                  On WhatsApp, from my phone
                </MenuItem>
                <MenuItem icon={<Mail />} onSelect={() => send.mutate('EMAIL')}>
                  By email{trip.customer.email ? tx(` to ${trip.customer.email}`) : ''}
                </MenuItem>
                <MenuItem
                  icon={<Copy />}
                  onSelect={() => {
                    navigator.clipboard?.writeText(quote.url).then(() => toast.success('Link copied'));
                    send.mutate('MANUAL');
                  }}
                >
                  Copy the link
                </MenuItem>
              </Menu>
            ) : null}
          </div>
        </div>
      </header>

      {!editable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-[13px]">
          <span>
            {quote.status === 'SENT' && `Sent ${ago(quote.sentAt)}${quote.viewedAt ? `, opened ${ago(quote.viewedAt)}` : ', not opened yet'}. A sent quote stays as it is.`}
            {quote.status === 'ACCEPTED' && tx(`Accepted ${ago(quote.respondedAt)}. The advance and balance are on the trip.`)}
            {quote.status === 'DECLINED' && `The customer asked for changes ${ago(quote.respondedAt)}${quote.responseNote ? `: “${quote.responseNote}”` : '.'}`}
          </span>
          <Button size="sm" loading={newVersion.isPending} onClick={() => newVersion.mutate()}>
            Make a new version
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-6">
          <Panel className="flex flex-col gap-4 p-5 sm:p-6">
            <Field label="A note to the customer">
              {(p) => <Textarea {...p} rows={3} value={d.intro ?? ''} onChange={(e) => change({ intro: e.target.value })} />}
            </Field>
          </Panel>

          <Panel className="flex flex-col gap-4 p-5 sm:p-6">
            <PanelHeader title="Day by day" description={nights ? `${nights} nights, ${nights + 1} days.` : tx('Add a day for each day of the trip.')} />
            <ol className="flex flex-col gap-3">
              {d.days.map((day, i) => (
                <li key={i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 rounded-[14px] border border-line-soft p-3">
                  <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-accent-soft text-center text-[11px] font-bold leading-tight text-accent-strong">
                    Day
                    <br />
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Input aria-label={`Day ${i + 1} title`} value={day.title} onChange={(e) => change({ days: d.days.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder={dayDate(i) ? `${dayDate(i)}: where to?` : 'Title'} className="font-medium" />
                      {editable && (
                        <span className="flex shrink-0">
                          <button type="button" className="grid h-9 w-8 place-items-center rounded-lg text-muted hover:bg-hover disabled:opacity-30" disabled={i === 0} onClick={() => moveDay(i, -1)} aria-label={`Move day ${i + 1} up`}>
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-8 place-items-center rounded-lg text-muted hover:bg-hover disabled:opacity-30" disabled={i === d.days.length - 1} onClick={() => moveDay(i, 1)} aria-label={`Move day ${i + 1} down`}>
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger" onClick={() => change({ days: d.days.filter((_, j) => j !== i) })} aria-label={`Remove day ${i + 1}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      )}
                    </div>
                    <Textarea aria-label={`Day ${i + 1} plan`} rows={2} value={day.description} onChange={(e) => change({ days: d.days.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder="Pickup, sightseeing, where they stay tonight" />
                  </div>
                </li>
              ))}
            </ol>
            {editable && (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => change({ days: [...d.days, { title: '', description: '' }] })}>
                <Plus className="h-4 w-4" />
                Add a day
              </Button>
            )}
          </Panel>

          <Panel className="flex flex-col gap-4 p-5 sm:p-6">
            <PanelHeader title={tx("What’s in the package")} description="The customer sees the items and the total, not the price of each item." />
            {d.lines.length > 0 && (
              <ul className="flex flex-col gap-3">
                {d.lines.map((l, i) => {
                  const unpriced = l.unitPrice === 0;
                  return (
                    <li key={i} className={cn('grid grid-cols-2 items-end gap-2 rounded-[14px] border p-3 sm:grid-cols-[minmax(0,1.3fr)_70px_70px_minmax(0,1fr)_90px]', unpriced ? 'border-warm bg-warm-soft/40' : 'border-line-soft')}>
                      <div className="col-span-2 flex items-end gap-2 sm:col-span-5">
                        <div className="min-w-0 flex-1">
                          <span className="mb-1 block text-xs text-muted">{KINDS[l.kind]}</span>
                          <Input aria-label="Item" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="What it is" />
                        </div>
                        {editable && (
                          <button type="button" className="grid h-10 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger" onClick={() => change({ lines: d.lines.filter((_, j) => j !== i) })} aria-label={`Remove ${l.label || 'item'}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <span className="mb-1 block text-xs text-muted">Charged</span>
                        <NativeSelect aria-label="Charged" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as RateUnit, times: e.target.value === 'PER_PERSON' || e.target.value === 'PER_GROUP' ? 1 : l.times })}>
                          {Object.entries(UNITS).map(([k, u]) => (
                            <option key={k} value={k}>
                              {u.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div>
                        <span className="mb-1 block text-xs text-muted">{QTY_LABEL[l.unit]}</span>
                        <Input aria-label={QTY_LABEL[l.unit]} type="number" min={0} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                      </div>
                      <div>
                        <span className="mb-1 block text-xs text-muted">{UNITS[l.unit].times ?? ' '}</span>
                        {UNITS[l.unit].times ? <Input aria-label={UNITS[l.unit].times} type="number" min={1} value={l.times} onChange={(e) => setLine(i, { times: Math.max(1, Number(e.target.value)) })} /> : <span className="hidden h-10 sm:block" />}
                      </div>
                      <div>
                        <span className={cn('mb-1 block text-xs', unpriced ? 'font-semibold text-warm-strong' : 'text-muted')}>{unpriced ? 'Add the price' : `Price per ${UNITS[l.unit].per}`}</span>
                        <Input aria-label="Price" inputMode="decimal" leading={<span className="text-sm">₹</span>} value={rupeesInput(l.unitPrice)} onChange={(e) => setLine(i, { unitPrice: toPaise(sanitizeRupees(e.target.value)), rateItemId: null })} />
                      </div>
                      <div className="flex h-10 items-center justify-end">
                        <span className="tnum text-sm font-semibold">{inr(lineTotal(l))}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPicking(true)}>
                  <Plus className="h-4 w-4" />
                  From price list
                </Button>
                <Button size="sm" variant="ghost" onClick={() => change({ lines: [...d.lines, { label: '', kind: 'OTHER' as RateKind, unit: 'PER_GROUP', quantity: 1, times: 1, unitPrice: 0, unitCost: null, rateItemId: null }] })}>
                  Custom item
                </Button>
              </div>
            )}
          </Panel>

          <div className="grid gap-6 md:grid-cols-2">
            <Panel className="p-5 sm:p-6">
              <Field label="Included" hint="One per line.">
                {(p) => <Textarea {...p} rows={6} value={d.inclusions.join('\n')} onChange={(e) => change({ inclusions: e.target.value.split('\n').map((x) => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) })} />}
              </Field>
            </Panel>
            <Panel className="p-5 sm:p-6">
              <Field label="Not included" hint="One per line.">
                {(p) => <Textarea {...p} rows={6} value={d.exclusions.join('\n')} onChange={(e) => change({ exclusions: e.target.value.split('\n').map((x) => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) })} />}
              </Field>
            </Panel>
          </div>
          <Panel className="p-5 sm:p-6">
            <Field label="Good to know" hint="Payment terms, cancellation, anything they should read.">
              {(p) => <Textarea {...p} rows={3} value={d.terms ?? ''} onChange={(e) => change({ terms: e.target.value })} />}
            </Field>
          </Panel>
        </fieldset>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Panel className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-muted">Total</span>
              <span className="tnum text-[32px] font-semibold leading-none tracking-[-0.03em]">{inr(totals.total)}</span>
              {totals.perPerson !== null && totals.people > 1 && <span className="tnum text-[13px] text-muted">{inr(totals.perPerson)} per person</span>}
            </div>
            {trip.budget ? (
              <p className={cn('rounded-[10px] px-3 py-2 text-xs', totals.total > trip.budget ? 'bg-warm-soft text-warm-strong' : 'bg-accent-soft text-accent-strong')}>
                {totals.total > trip.budget ? tx(`${inr(totals.total - trip.budget)} over their budget of ${inr(trip.budget)}`) : tx(`Within their budget of ${inr(trip.budget)}`)}
              </p>
            ) : null}
            <fieldset disabled={!editable} className="flex flex-col gap-3 border-t border-line-soft pt-4">
              <Field label="Discount">
                {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={rupeesInput(d.discount)} onChange={(e) => change({ discount: toPaise(sanitizeRupees(e.target.value)) })} placeholder="0" />}
              </Field>
              <Field label="Valid until">
                {(p) => <Input {...p} type="date" value={d.validUntil ?? ''} onChange={(e) => change({ validUntil: e.target.value || null })} />}
              </Field>
            </fieldset>
            {totals.margin !== null && (
              <div className="flex items-baseline justify-between border-t border-line-soft pt-4 text-[13px]">
                <span className="text-muted">Your margin · only you see this</span>
                <span className={cn('tnum font-semibold', totals.margin < 0 ? 'text-danger' : 'text-accent-strong')}>{inr(totals.margin)}</span>
              </div>
            )}
            {d.lines.some((l) => l.unitPrice === 0) && (
              <p className="flex items-start gap-2 text-xs text-warm-strong">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Some items have no price yet.
              </p>
            )}
          </Panel>
        </aside>
      </div>

      <RatePicker
        open={picking}
        onClose={() => setPicking(false)}
        destination={trip.destination}
        nights={nights}
        travellers={totals.people}
        adults={trip.adults}
        onPick={(l) => {
          change({ lines: [...d.lines, l] });
          setPicking(false);
        }}
      />
      <AiDialog quoteId={quote.id} open={drafting} onClose={() => setDrafting(false)} onDraft={(draft) => change({ intro: draft.intro ?? d.intro, days: draft.days ?? d.days, lines: (draft.lines ?? d.lines).map(({ needsPrice: _n, ...l }) => l), inclusions: draft.inclusions ?? d.inclusions, exclusions: draft.exclusions ?? d.exclusions })} />
    </>
  );
}
