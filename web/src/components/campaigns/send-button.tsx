import { AlertCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/overlay';
import type { Check } from '@/lib/types';

/**
 * "Send now". When something must be fixed first, the button still answers a click: it opens the
 * list of what's left, so it never just sits there greyed out.
 */
export function SendNowButton({ canSend, checks, loading, onSend }: { canSend: boolean; checks?: Check[]; loading?: boolean; onSend: () => void }) {
  const errors = (checks ?? []).filter((c) => c.level === 'error');
  if (canSend || !checks) {
    return (
      <Button variant="primary" disabled={!canSend} loading={loading} onClick={onSend}>
        <Send className="h-4 w-4" />
        Send now
      </Button>
    );
  }
  return (
    <Popover
      align="end"
      className="w-[min(380px,calc(100vw-32px))] p-4"
      trigger={
        <Button variant="primary" className="opacity-80">
          <Send className="h-4 w-4" />
          Send now
          <span className="tnum ml-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-danger">{errors.length}</span>
        </Button>
      }
    >
      <FixList errors={errors} />
    </Popover>
  );
}

function FixList({ errors }: { errors: Check[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] font-semibold">
        Fix {errors.length === 1 ? 'this' : `these ${errors.length}`} first, then it sends
      </p>
      <ul className="flex flex-col gap-2.5">
        {errors.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium leading-snug">{c.title}</span>
              {c.note && <span className="text-xs leading-relaxed text-muted">{c.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
