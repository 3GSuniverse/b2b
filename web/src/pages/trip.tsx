import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Package as PackageIcon, CalendarDays, Check, ChevronDown, Mail, MapPin, MessageCircle, MoreHorizontal, Pencil, Phone, RotateCcw, Trash2, Users, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Avatar, Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { PaymentsPanel } from '@/components/trips/payments';
import { QuotesPanel } from '@/components/quotes/quotes-panel';
import { TravellersPanel } from '@/components/groups/travellers';
import { METHODS, SOURCES, STATUS, travellers, TripStatusBadge } from '@/components/trips/shared';
import { EditTripSheet } from '@/components/trips/trip-form';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago, dateRange, dateTime, inr, phone as fmtPhone, tripLength } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PaymentMethod, TripDetail, TripStatus } from '@/lib/types';

// ---------------------------------------------------------------- Status changes

const LOST_REASONS = ['Price too high', 'Booked with another agency', 'Plans changed', 'Stopped replying'];
const CANCEL_REASONS = ['Family emergency', 'Health reasons', 'Dates changed', 'Travel advisory'];

function ReasonDialog({ trip, to, onClose, onDone }: { trip: TripDetail; to: 'LOST' | 'CANCELLED' | null; onClose: () => void; onDone: (t: TripDetail) => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.patch<{ trip: TripDetail }>(`/api/trips/${trip.id}`, { status: to, lostReason: reason.trim() || null }),
    onSuccess: ({ trip: t }) => {
      toast.success(to === 'LOST' ? 'Marked as lost' : 'Trip cancelled');
      setReason('');
      onDone(t);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const chips = to === 'LOST' ? LOST_REASONS : CANCEL_REASONS;
  return (
    <Dialog
      open={!!to}
      onOpenChange={(o) => !o && onClose()}
      title={to === 'LOST' ? 'Mark this enquiry as lost?' : 'Cancel this trip?'}
      description={
        to === 'LOST'
          ? 'It leaves the board. You can reopen it any time.'
          : `Reminders for this trip stop.${trip.money.paid > 0 ? ` ${inr(trip.money.paid)} has been received; settle any refund with the customer and record it in the notes.` : ''}`
      }
      footer={
        <>
          <Button onClick={onClose}>Go back</Button>
          <Button variant={to === 'CANCELLED' ? 'danger' : 'primary'} loading={m.isPending} onClick={() => m.mutate()}>
            {to === 'LOST' ? 'Mark as lost' : 'Cancel trip'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Reason" hint="Optional. Helps you see why trips are lost.">
          {(p) => <Input {...p} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setReason(c)}
              className={cn('rounded-full border px-3 py-1 text-[13px] transition-colors', reason === c ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line hover:bg-hover')}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** The one obvious next step for where the trip is, plus everything else in a menu. */
function StatusActions({ trip, onChange, onAsk }: { trip: TripDetail; onChange: (s: TripStatus) => void; onAsk: (to: 'LOST' | 'CANCELLED') => void }) {
  const next: Partial<Record<TripStatus, { to: TripStatus; label: string }>> = {
    ENQUIRY: { to: 'QUOTED', label: 'Mark as quoted' },
    QUOTED: { to: 'BOOKED', label: 'Mark as booked' },
    LOST: { to: 'ENQUIRY', label: 'Reopen' },
    CANCELLED: { to: 'BOOKED', label: 'Restore booking' },
    COMPLETED: undefined,
    BOOKED: undefined,
  };
  const primary = next[trip.status];
  const others: { to: TripStatus; label: string }[] = (
    {
      ENQUIRY: [{ to: 'BOOKED', label: 'Mark as booked' }],
      QUOTED: [{ to: 'ENQUIRY', label: 'Back to enquiry' }],
      BOOKED: [
        { to: 'COMPLETED', label: 'Mark as completed' },
        { to: 'QUOTED', label: 'Back to quoted' },
      ],
      COMPLETED: [{ to: 'BOOKED', label: 'Reopen as booked' }],
      LOST: [],
      CANCELLED: [],
    } as Record<TripStatus, { to: TripStatus; label: string }[]>
  )[trip.status];
  const canLose = trip.status === 'ENQUIRY' || trip.status === 'QUOTED';
  const canCancel = trip.status === 'BOOKED';
  return (
    <div className="flex items-center gap-2">
      {primary && (
        <Button variant={trip.status === 'LOST' || trip.status === 'CANCELLED' ? 'secondary' : 'primary'} onClick={() => onChange(primary.to)}>
          {trip.status === 'LOST' || trip.status === 'CANCELLED' ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {primary.label}
        </Button>
      )}
      {(others.length > 0 || canLose || canCancel) && (
        <Menu
          trigger={
            <Button aria-label="More status options">
              {primary ? <ChevronDown className="h-4 w-4" /> : <>Status <ChevronDown className="h-4 w-4" /></>}
            </Button>
          }
        >
          {others.map((o) => (
            <MenuItem key={o.to} onSelect={() => onChange(o.to)}>
              {o.label}
            </MenuItem>
          ))}
          {(canLose || canCancel) && others.length > 0 && <MenuSeparator />}
          {canLose && (
            <MenuItem icon={<X />} onSelect={() => onAsk('LOST')}>
              Mark as lost…
            </MenuItem>
          )}
          {canCancel && (
            <MenuItem danger icon={<X />} onSelect={() => onAsk('CANCELLED')}>
              Cancel trip…
            </MenuItem>
          )}
        </Menu>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Side panels

function CustomerPanel({ trip }: { trip: TripDetail }) {
  const c = trip.customer;
  const waDigits = c.phone?.replace(/\D/g, '');
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <Avatar name={c.name} email={c.email} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{c.name}</span>
          {c.id ? (
            <Link to={`/contacts?contact=${c.id}`} className="text-xs text-muted hover:text-ink hover:underline">
              Open contact
            </Link>
          ) : (
            <span className="text-xs text-muted">Contact removed</span>
          )}
        </div>
      </div>
      {(c.phone || c.email) && (
        <ul className="flex flex-col gap-2 text-[13px]">
          {c.phone && (
            <li className="flex items-center gap-2.5">
              <Phone className="h-4 w-4 text-muted" aria-hidden />
              <a href={`tel:${c.phone}`} className="tnum hover:underline">
                {fmtPhone(c.phone)}
              </a>
            </li>
          )}
          {c.email && (
            <li className="flex min-w-0 items-center gap-2.5">
              <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <a href={`mailto:${c.email}`} className="truncate hover:underline">
                {c.email}
              </a>
            </li>
          )}
        </ul>
      )}
      {waDigits && (
        <a
          href={`https://wa.me/${waDigits}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 items-center justify-center gap-2 rounded-[10px] border border-line text-[13px] font-medium hover:bg-hover"
        >
          <MessageCircle className="h-4 w-4 text-[#128c4a]" aria-hidden />
          Chat on WhatsApp
        </a>
      )}
    </Panel>
  );
}

function DetailsPanel({ trip, onEdit }: { trip: TripDetail; onEdit: () => void }) {
  const rows = [
    { icon: MapPin, label: 'Destination', value: trip.destination, empty: 'Destination not set' },
    { icon: CalendarDays, label: 'Dates', value: dateRange(trip.startDate, trip.endDate) && `${dateRange(trip.startDate, trip.endDate)}${tripLength(trip.startDate, trip.endDate) ? ` · ${tripLength(trip.startDate, trip.endDate)}` : ''}`, empty: 'Dates not set' },
    { icon: Users, label: 'Travellers', value: travellers(trip), empty: '' },
    { icon: Wallet, label: 'Their budget', value: trip.budget ? `Budget ${inr(trip.budget)}` : null, empty: 'Budget not given' },
  ];
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <PanelHeader
        title="Trip"
        action={
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        }
      />
      <dl className="flex flex-col gap-3 text-[13px]">
        {rows.map(({ icon: Icon, label, value, empty }) => (
          <div key={label} className="flex items-start gap-2.5">
            <Icon className="mt-px h-4 w-4 shrink-0 text-muted" aria-hidden />
            <dt className="sr-only">{label}</dt>
            <dd className={cn('min-w-0', !value && 'text-faint')}>{value || empty}</dd>
          </div>
        ))}
      </dl>
      {trip.package && (
        <Link to={`/trips/packages/${trip.package.id}`} className="flex items-center gap-2.5 rounded-[12px] bg-accent-soft px-3 py-2.5 text-[13px] text-accent-strong hover:underline">
          <PackageIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Package: <span className="font-semibold">{trip.package.name}</span>
          </span>
        </Link>
      )}
      <dl className="grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-[13px]">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Came through</dt>
          <dd>{trip.source ? SOURCES[trip.source] : <span className="text-faint">Not recorded</span>}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Handled by</dt>
          <dd className="truncate">{trip.assignedTo?.name ?? <span className="text-faint">Nobody</span>}</dd>
        </div>
      </dl>
      {trip.notes && <p className="whitespace-pre-wrap rounded-[12px] bg-sunken px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">{trip.notes}</p>}
    </Panel>
  );
}

function describe(a: TripDetail['activity'][number]) {
  const m = (a.meta ?? {}) as Record<string, string | number | string[] | undefined>;
  switch (a.action) {
    case 'trip.create':
      return 'Enquiry added';
    case 'trip.status': {
      const to = STATUS[m.to as TripStatus]?.label ?? m.to;
      const why = m.reason ? ` · ${m.reason}` : '';
      return `Moved to ${to}${why}`;
    }
    case 'trip.update':
      return 'Details edited';
    case 'trip.schedule':
      return m.count ? `Payment schedule set: ${m.count} payment${m.count === 1 ? '' : 's'}, ${m.total}` : 'Payment schedule removed';
    case 'trip.payment':
      return `${m.amount} received by ${METHODS[m.method as PaymentMethod] ?? m.method} · receipt #${m.receipt}`;
    case 'trip.payment_void':
      return `Receipt #${m.receipt} (${m.amount}) cancelled · ${m.reason}`;
    case 'trip.quote': {
      const v = Number(m.version) > 1 ? ` v${m.version}` : '';
      return { created: `Quote${v} started`, sent: `Quote${v} sent${m.via === 'EMAIL' ? ' by email' : ''} · ${m.total}`, accepted: `Customer accepted quote${v} · ${m.total}`, declined: `Customer asked for changes to quote${v}${m.note ? `: “${m.note}”` : ''}` }[m.step as string] ?? 'Quote updated';
    }
    case 'trip.followup':
      return `${{ PRE_TRIP: '“Trip starts soon” message', REVIEW: 'Review request', WHERE_NEXT: '“Where next?” message', QUOTE_FOLLOWUP: 'Quote follow-up' }[m.kind as string] ?? 'Message'} sent by ${m.channel === 'WHATSAPP' ? 'WhatsApp' : 'email'}`;
    case 'trip.reminder':
      return `Payment reminder sent for ${m.label} by ${m.channel === 'WHATSAPP' ? 'WhatsApp' : 'email'}`;
    default:
      return a.action;
  }
}

function ActivityPanel({ trip }: { trip: TripDetail }) {
  return (
    <Panel className="flex flex-col gap-4 p-5 sm:p-6">
      <PanelHeader title="History" />
      <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
        {trip.activity.map((a) => (
          <li key={a.id} className="relative flex gap-3 pl-6">
            <span aria-hidden className={cn('absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-surface', a.action === 'trip.payment' ? 'bg-accent' : a.action === 'trip.payment_void' ? 'bg-danger' : 'bg-faint')} />
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px]">{describe(a)}</span>
              <span className="text-xs text-muted" title={dateTime(a.createdAt)}>
                {ago(a.createdAt)}
                {a.by ? ` · ${a.by}` : ''}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ---------------------------------------------------------------- Page

export function TripPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<'LOST' | 'CANCELLED' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const q = useQuery({ queryKey: ['trip', id], queryFn: () => api.get<{ trip: TripDetail }>(`/api/trips/${id}`).then((r) => r.trip) });

  const update = (t: TripDetail) => {
    qc.setQueryData(['trip', id], t);
    qc.invalidateQueries({ queryKey: ['trips'] });
  };
  const status = useMutation({
    mutationFn: (to: TripStatus) => api.patch<{ trip: TripDetail }>(`/api/trips/${id}`, { status: to }),
    onSuccess: ({ trip }) => {
      update(trip);
      toast.success(`Marked as ${STATUS[trip.status].label.toLowerCase()}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/trips/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      toast.success('Trip deleted');
      nav('/trips');
    },
    onError: (e: Error) => {
      setDeleting(false);
      toast.error(e.message);
    },
  });

  if (q.isError) {
    return (
      <Panel className="p-10 text-center">
        <p className="text-sm text-muted">This trip doesn’t exist, or it belongs to another company.</p>
        <Link to="/trips" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
          Back to trips
        </Link>
      </Panel>
    );
  }
  const trip = q.data;
  if (!trip) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton className="h-16 w-80" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-96 rounded-[var(--radius-panel)]" />
          <Skeleton className="h-96 rounded-[var(--radius-panel)]" />
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to="/trips" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Trips
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">
              {trip.title}
              <span className="tnum ml-2.5 text-xl font-medium text-faint">#{trip.number}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
              <TripStatusBadge status={trip.status} />
              {[trip.customer.name, dateRange(trip.startDate, trip.endDate), trip.statusChangedAt && `${STATUS[trip.status].label} ${ago(trip.statusChangedAt)}`]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {trip.lostReason && (trip.status === 'LOST' || trip.status === 'CANCELLED') && <p className="text-[13px] text-muted">Reason: {trip.lostReason}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusActions trip={trip} onChange={(to) => status.mutate(to)} onAsk={setAsking} />
            <Menu
              trigger={
                <Button aria-label="More options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              }
            >
              <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                Edit details
              </MenuItem>
              {user.role !== 'MEMBER' && (
                <MenuItem danger icon={<Trash2 />} onSelect={() => setDeleting(true)}>
                  Delete trip
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {(trip.status === 'ENQUIRY' || trip.status === 'QUOTED') && <QuotesPanel trip={trip} />}
          <PaymentsPanel trip={trip} onChange={update} onSetPrice={() => setEditing(true)} />
          {!(trip.status === 'ENQUIRY' || trip.status === 'QUOTED') && <QuotesPanel trip={trip} />}
          <ActivityPanel trip={trip} />
        </div>
        <aside className="order-first flex flex-col gap-6 lg:sticky lg:top-6 lg:order-none">
          {trip.group && (
            <Link to={`/groups/${trip.group.id}`} className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px] hover:bg-sunken">
              <Users className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0">
                Part of <span className="font-semibold">{trip.group.title}</span>
              </span>
            </Link>
          )}
          <CustomerPanel trip={trip} />
          <DetailsPanel trip={trip} onEdit={() => setEditing(true)} />
          {trip.status !== 'LOST' && <TravellersPanel trip={trip} />}
        </aside>
      </div>

      <EditTripSheet
        trip={trip}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={(t) => {
          setEditing(false);
          update(t);
        }}
      />
      <ReasonDialog
        trip={trip}
        to={asking}
        onClose={() => setAsking(null)}
        onDone={(t) => {
          setAsking(null);
          update(t);
        }}
      />
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete #${trip.number} ${trip.title}?`}
        description={trip.payments.length ? 'This trip has payments recorded, so it can’t be deleted. Cancel it instead.' : 'The enquiry and its schedule are removed for good. The customer stays in your contacts.'}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Keep it</Button>
            {!trip.payments.length && (
              <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
                Delete trip
              </Button>
            )}
          </>
        }
      />
    </>
  );
}
