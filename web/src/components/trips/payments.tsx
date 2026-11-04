import { useMutation } from '@tanstack/react-query';
import { Ban, CalendarClock, MoreHorizontal, Plus, ReceiptText, Trash2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Panel, PanelHeader } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Dialog, Menu, MenuItem } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, inr, rupeesInput, shortDate, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PaymentMethod, TripDetail } from '@/lib/types';
import { DUE_STATE, METHODS, sanitizeRupees } from './shared';

const toPaise = (v: string) => {
  const clean = v.replace(/[,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : null;
};

// ---------------------------------------------------------------- Schedule editor

type Row = { key: number; label: string; amount: string; dueDate: string };
let rowKey = 0;

export function ScheduleDialog({ trip, open, onClose, onSaved }: { trip: TripDetail; open: boolean; onClose: () => void; onSaved: (t: TripDetail) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!open) return;
    const from = trip.money.dues.length ? trip.money.dues : (trip.suggestedSchedule ?? []);
    setRows(from.map((d) => ({ key: ++rowKey, label: d.label, amount: rupeesInput(d.amount), dueDate: d.dueDate })));
  }, [open, trip]);
  const m = useMutation({
    mutationFn: () => api.put<{ trip: TripDetail }>(`/api/trips/${trip.id}/dues`, { dues: rows.map(({ label, amount, dueDate }) => ({ label, amount: amount || '0', dueDate })) }),
    onSuccess: ({ trip: t }) => {
      toast.success('Payment schedule saved');
      onSaved(t);
    },
  });
  const err = (i: number, k: string) => (m.error instanceof ApiError ? m.error.field(`dues.${i}.${k}`) : undefined);
  const total = rows.reduce((a, r) => a + (toPaise(r.amount) ?? 0), 0);
  const diff = trip.money.price - total;
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Payment schedule"
      description="When the customer pays what. Reminders go out before each date, and payments are counted against these in order."
      className="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!trip.money.dues.length && trip.suggestedSchedule?.length ? (
          <p className="rounded-[12px] bg-accent-soft px-4 py-3 text-[13px] text-accent-strong">We’ve suggested a 25% advance now and the balance 15 days before departure. Change anything you like.</p>
        ) : null}
        <div className="hidden grid-cols-[minmax(0,1fr)_150px_160px_36px] gap-3 px-1 text-xs font-semibold text-muted sm:grid">
          <span>Payment</span>
          <span>Amount</span>
          <span>Due on</span>
          <span />
        </div>
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_36px] gap-x-3 gap-y-2 rounded-[12px] border border-line-soft p-3 sm:grid-cols-[minmax(0,1fr)_150px_160px_36px] sm:border-0 sm:p-0">
              <div className="col-span-1">
                <Input aria-label={`Name of payment ${i + 1}`} aria-invalid={!!err(i, 'label')} value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} placeholder="Advance" />
              </div>
              <div className="col-start-1 sm:col-start-auto">
                <Input aria-label={`Amount of payment ${i + 1}`} aria-invalid={!!err(i, 'amount')} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={r.amount} onChange={(e) => set(r.key, { amount: sanitizeRupees(e.target.value) })} placeholder="20,000" />
              </div>
              <div className="col-start-1 sm:col-start-auto">
                <Input aria-label={`Due date of payment ${i + 1}`} aria-invalid={!!err(i, 'dueDate')} type="date" value={r.dueDate} onChange={(e) => set(r.key, { dueDate: e.target.value })} />
              </div>
              <button
                type="button"
                className="col-start-2 row-start-1 grid h-10 w-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger sm:col-start-auto sm:row-start-auto"
                aria-label={`Remove payment ${i + 1}`}
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              {(err(i, 'label') || err(i, 'amount') || err(i, 'dueDate')) && <p className="col-span-full text-[13px] text-danger">{err(i, 'label') ?? err(i, 'amount') ?? err(i, 'dueDate')}</p>}
            </li>
          ))}
        </ol>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() =>
            setRows([
              ...rows,
              { key: ++rowKey, label: rows.length === 0 ? 'Advance' : rows.length === 1 ? 'Balance' : `Instalment ${rows.length}`, amount: diff > 0 ? rupeesInput(diff) : '', dueDate: rows.at(-1)?.dueDate ?? todayIso() },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Add a payment
        </Button>
        <div className={cn('flex flex-wrap items-baseline justify-between gap-2 rounded-[12px] px-4 py-3 text-[13px]', trip.money.price === 0 || diff === 0 ? 'bg-sunken' : 'bg-warm-soft text-warm-strong')}>
          <span>
            Total <span className="tnum font-semibold">{inr(total)}</span>
            {trip.money.price > 0 && <> of the agreed {inr(trip.money.price)}</>}
          </span>
          <span className="font-medium">
            {trip.money.price === 0
              ? total > 0
                ? 'This will become the agreed price.'
                : ''
              : diff === 0
                ? 'Adds up to the price.'
                : diff > 0
                  ? `${inr(diff)} isn’t scheduled yet.`
                  : `${inr(-diff)} more than the price.`}
          </span>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Record a payment

const METHOD_OPTIONS: PaymentMethod[] = ['UPI', 'CASH', 'BANK', 'CARD', 'OTHER'];
const REFERENCE_LABEL: Record<PaymentMethod, string> = {
  UPI: 'UPI reference (UTR)',
  CASH: 'Note (optional)',
  BANK: 'Transaction or cheque number',
  CARD: 'Card slip or approval code',
  ONLINE: 'Payment ID',
  OTHER: 'Reference',
};

export function RecordPaymentDialog({ trip, open, onClose, onSaved }: { trip: TripDetail; open: boolean; onClose: () => void; onSaved: (t: TripDetail, receipt: number) => void }) {
  const [f, setF] = useState({ amount: '', method: 'UPI' as PaymentMethod, reference: '', date: todayIso() });
  useEffect(() => {
    if (!open) return;
    const suggested = trip.money.nextDue?.amount ?? (trip.money.balance > 0 ? trip.money.balance : 0);
    setF({ amount: rupeesInput(suggested), method: 'UPI', reference: '', date: todayIso() });
  }, [open, trip]);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ trip: TripDetail; receiptNumber: number }>(`/api/trips/${trip.id}/payments`, {
        amount: f.amount || '0',
        method: f.method,
        reference: f.method === 'CASH' ? undefined : f.reference || undefined,
        note: f.method === 'CASH' ? f.reference || undefined : undefined,
        // Noon local time on the chosen day, so the date never shifts across time zones
        paidAt: f.date === todayIso() ? undefined : new Date(`${f.date}T12:00:00`).toISOString(),
      }),
    onSuccess: ({ trip: t, receiptNumber }) => {
      toast.success(`Payment recorded · receipt #${receiptNumber}`, { description: trip.status === 'BOOKED' || trip.status === 'COMPLETED' ? undefined : 'The trip is now marked as booked.' });
      onSaved(t, receiptNumber);
    },
  });
  const err = (k: string) => (m.error instanceof ApiError ? m.error.field(k) : undefined);
  const general = m.error && !(m.error instanceof ApiError && m.error.details?.fields) ? m.error.message : null;
  const amount = toPaise(f.amount) ?? 0;
  const after = trip.money.balance - amount;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Record a payment"
      description={`From ${trip.customer.name}, for #${trip.number} ${trip.title}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Record {amount ? inr(amount) : 'payment'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {general && (
          <div role="alert" className="rounded-[12px] border border-[#f4c7c2] bg-danger-soft px-4 py-3 text-sm text-danger">
            {general}
          </div>
        )}
        <Field
          label="Amount received"
          error={err('amount')}
          hint={trip.money.price > 0 ? (after > 0 ? `${inr(after)} will still be due after this.` : after === 0 ? 'This clears the balance.' : `${inr(-after)} more than the balance.`) : undefined}
        >
          {(p) => <Input {...p} autoFocus inputMode="decimal" className="tnum text-lg font-semibold" leading={<span className="text-base">₹</span>} value={f.amount} onChange={(e) => setF({ ...f, amount: sanitizeRupees(e.target.value) })} />}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold">Paid by</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {METHOD_OPTIONS.map((method) => (
              <label
                key={method}
                className={cn(
                  'flex h-10 cursor-pointer items-center justify-center rounded-[10px] border text-[13px] font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                  f.method === method ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line hover:bg-hover',
                )}
              >
                <input type="radio" name="method" className="sr-only" checked={f.method === method} onChange={() => setF({ ...f, method })} />
                {method === 'BANK' ? 'Bank' : METHODS[method]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
          <Field label={REFERENCE_LABEL[f.method]} error={err('reference') ?? err('note')}>
            {(p) => <Input {...p} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={f.method === 'UPI' ? '4321 0987 6543' : ''} />}
          </Field>
          <Field label="Received on" error={err('paidAt')}>
            {(p) => <Input {...p} type="date" max={todayIso()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Cancel a payment

function VoidDialog({ trip, paymentId, onClose, onSaved }: { trip: TripDetail; paymentId: string | null; onClose: () => void; onSaved: (t: TripDetail) => void }) {
  const [reason, setReason] = useState('');
  const p = trip.payments.find((x) => x.id === paymentId);
  useEffect(() => setReason(''), [paymentId]);
  const m = useMutation({
    mutationFn: () => api.post<{ trip: TripDetail }>(`/api/trips/${trip.id}/payments/${paymentId}/void`, { reason }),
    onSuccess: ({ trip: t }) => {
      toast.success(`Receipt #${p?.receiptNumber} cancelled`);
      onSaved(t);
    },
  });
  const err = m.error instanceof ApiError ? m.error.field('reason') : m.error?.message;
  return (
    <Dialog
      open={!!p}
      onOpenChange={(o) => !o && onClose()}
      title={p ? `Cancel receipt #${p.receiptNumber}?` : ''}
      description={p ? `${inr(p.amount)} by ${METHODS[p.method]} on ${shortDate(p.paidAt)}. It stays on record, marked as cancelled, and stops counting towards what’s been paid.` : ''}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>
            Cancel receipt
          </Button>
        </>
      }
    >
      <Field label="Why?" hint="For example “Entered twice” or “Cheque bounced”." error={err}>
        {(fp) => <Input {...fp} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Panel

export function PaymentsPanel({ trip, onChange, onSetPrice }: { trip: TripDetail; onChange: (t: TripDetail) => void; onSetPrice: () => void }) {
  const { user } = useSession();
  const canVoid = user.role !== 'MEMBER';
  const [scheduling, setScheduling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const { money } = trip;
  const pct = money.price > 0 ? Math.min(100, (money.paid / money.price) * 100) : 0;
  const closed = trip.status === 'LOST';

  return (
    <Panel className="flex flex-col">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <PanelHeader
          title="Payments"
          action={
            !closed && (
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                <Button size="sm" onClick={() => setScheduling(true)}>
                  <CalendarClock className="h-4 w-4" />
                  {money.dues.length ? 'Edit schedule' : 'Set schedule'}
                </Button>
                <Button size="sm" variant="primary" onClick={() => setRecording(true)}>
                  <Wallet className="h-4 w-4" />
                  Record payment
                </Button>
              </div>
            )
          }
        />
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Agreed price', value: money.price ? inr(money.price) : null },
            { label: 'Received', value: inr(money.paid), tone: money.paid > 0 ? 'text-accent-strong' : undefined },
            { label: money.balance < 0 ? 'Overpaid' : 'Balance', value: inr(Math.abs(money.balance)), tone: money.overdue > 0 ? 'text-danger' : undefined },
          ].map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] text-muted">{s.label}</span>
              {s.value === null ? (
                <button type="button" className="self-start text-sm font-semibold text-accent hover:underline" onClick={onSetPrice}>
                  Set the price
                </button>
              ) : (
                <span className={cn('tnum truncate text-xl font-semibold tracking-[-0.02em] sm:text-2xl', s.tone)}>{s.value}</span>
              )}
            </div>
          ))}
        </div>
        {money.price > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the price received">
              <div className={cn('h-full rounded-full transition-[width] duration-500', money.overdue > 0 ? 'bg-warm' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted">
              {Math.round(pct)}% received
              {money.overdue > 0 && <span className="font-medium text-danger"> · {inr(money.overdue)} overdue</span>}
            </span>
          </div>
        )}
      </div>

      {money.dues.length > 0 && (
        <div className="border-t border-line-soft">
          <h3 className="px-5 pb-1 pt-4 text-[13px] font-semibold sm:px-6">Schedule</h3>
          <ol className="flex flex-col">
            {money.dues.map((d) => {
              const st = DUE_STATE[d.state];
              return (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_120px_120px_100px] sm:px-6">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{d.label}</span>
                    <span className="text-xs text-muted sm:hidden">
                      Due {shortDate(d.dueDate)} · {inr(d.amount)}
                    </span>
                  </span>
                  <span className="tnum hidden text-[13px] text-ink-2 sm:block">{shortDate(d.dueDate)}</span>
                  <span className="tnum hidden text-right text-[13px] font-medium sm:block">{inr(d.amount)}</span>
                  <span className="flex flex-col items-end gap-0.5">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {d.state !== 'PAID' && d.paid > 0 && <span className="tnum text-[11px] text-muted">{inr(d.remaining)} left</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {money.unscheduled > 0 && (
            <p className="mx-5 mb-4 rounded-[10px] bg-warm-soft px-3 py-2 text-xs text-warm-strong sm:mx-6">
              {inr(money.unscheduled)} of the price isn’t in the schedule.{' '}
              <button type="button" className="font-semibold underline" onClick={() => setScheduling(true)}>
                Add it
              </button>
            </p>
          )}
        </div>
      )}

      <div className="border-t border-line-soft">
        <h3 className="px-5 pb-1 pt-4 text-[13px] font-semibold sm:px-6">Received</h3>
        {!trip.payments.length ? (
          <p className="px-5 pb-5 pt-1 text-[13px] text-muted sm:px-6">
            {money.dues.length ? 'No payments yet.' : 'No payments yet. Set a schedule so reminders go out on time, or record a payment straight away.'}
          </p>
        ) : (
          <ul className="flex flex-col pb-2">
            {trip.payments.map((p) => (
              <li key={p.id} className={cn('grid grid-cols-[36px_minmax(0,1fr)_auto_32px] items-center gap-x-3 px-5 py-2.5 sm:px-6', p.voidedAt && 'text-faint')}>
                <span className={cn('grid h-9 w-9 place-items-center rounded-[10px]', p.voidedAt ? 'bg-line-soft' : 'bg-accent-soft text-accent-strong')}>
                  {p.voidedAt ? <Ban className="h-4 w-4" aria-hidden /> : <ReceiptText className="h-4 w-4" aria-hidden />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    Receipt #{p.receiptNumber} · {METHODS[p.method]}
                    {p.reference ? <span className="font-normal text-muted"> · {p.reference}</span> : null}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {p.voidedAt ? `Cancelled: ${p.voidReason}` : `${dateTime(p.paidAt)}${p.recordedBy ? ` · by ${p.recordedBy}` : ''}${p.note ? ` · ${p.note}` : ''}`}
                  </span>
                </span>
                <span className={cn('tnum text-sm font-semibold', p.voidedAt && 'line-through')}>{inr(p.amount)}</span>
                {!p.voidedAt && canVoid ? (
                  <Menu
                    trigger={
                      <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for receipt ${p.receiptNumber}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    }
                  >
                    <MenuItem danger icon={<Ban />} onSelect={() => setVoiding(p.id)}>
                      Cancel this receipt
                    </MenuItem>
                  </Menu>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ScheduleDialog
        trip={trip}
        open={scheduling}
        onClose={() => setScheduling(false)}
        onSaved={(t) => {
          setScheduling(false);
          onChange(t);
        }}
      />
      <RecordPaymentDialog
        trip={trip}
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={(t) => {
          setRecording(false);
          onChange(t);
        }}
      />
      <VoidDialog
        trip={trip}
        paymentId={voiding}
        onClose={() => setVoiding(null)}
        onSaved={(t) => {
          setVoiding(null);
          onChange(t);
        }}
      />
    </Panel>
  );
}
