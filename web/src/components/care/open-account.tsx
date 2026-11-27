import { useMutation } from '@tanstack/react-query';
import { DoorOpen, Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';

const LENGTHS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
];

/**
 * "Open account": care works inside the agency's own dashboard (as the owner) while on the phone with
 * them: add or remove customers, employees, trips, fix WhatsApp… Opens in a new tab.
 */
export function OpenAccount({ agencyId, agencyName, allowed, ticketNumber }: { agencyId: string; agencyName: string; allowed: boolean; ticketNumber?: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(ticketNumber ? `Request #${ticketNumber}: ` : '');
  const [minutes, setMinutes] = useState('60');
  const go = useMutation({
    mutationFn: () => api.post<{ ok: true }>(`/api/care/agencies/${agencyId}/open`, { reason, minutes: Number(minutes) }),
    onSuccess: () => {
      setOpen(false);
      window.open('/', '_blank', 'noopener');
      toast.success(`${agencyName}'s account opened in a new tab`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Couldn’t open the account'),
  });

  if (!allowed)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white/75" title="The owner switched off support access in Settings → Company">
        <Lock className="h-3.5 w-3.5" /> Support access is off
      </span>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-bold text-[#2e2580] shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <DoorOpen className="h-4 w-4" /> Open account
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Work inside ${agencyName}'s account`}
        description="You'll see their dashboard as the owner: add or remove customers, employees, trips, fix WhatsApp and more. The owner gets a notification, every change is saved with your name, and payments stay locked."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={go.isPending} disabled={reason.trim().length < 5} onClick={() => go.mutate()}>
              <DoorOpen className="h-4 w-4" /> Open in a new tab
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Why are you opening it?" hint="The agency owner sees this.">
            {(p) => <Input {...p} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Add the 12 customers they read out on the call" />}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-medium text-ink-2">Access for</span>
            <Segmented label="How long" value={minutes} onChange={setMinutes} options={LENGTHS} />
          </div>
        </div>
      </Dialog>
    </>
  );
}
