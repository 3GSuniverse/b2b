import { ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * After a WhatsApp broadcast takes off: a few seconds of advice on keeping the number safe.
 * Two tips always show (the daily limit and old chats); the third changes each time.
 */

const ALWAYS = [
  'Stay within the daily limit Dhrona sets. Sending too many in one day is the main reason numbers get blocked.',
  'Delete old broadcast chats on your phone now and then. Thousands of chats fill its storage and slow WhatsApp down.',
];
const ROTATING = [
  'Send only to people who know your agency. Many “block” or “report” taps can get your number banned.',
  'Keep the phone charged and online, and open WhatsApp on it at least once every two weeks, or the link to Dhrona stops.',
  'Don’t send the same offer to the same people again and again. Change the words and leave a few days between offers.',
  'Reply when customers write back. Numbers that have real conversations are trusted more by WhatsApp.',
  'A number that’s new to WhatsApp gets blocked fastest. Use one your agency has used for a while.',
  'If people reply STOP, Dhrona stops messaging them automatically. Never add them back.',
];

const SHOW_MS = 12_000;

function nextRotating() {
  let i = 0;
  try {
    i = Number(localStorage.getItem('dhrona.waTip') ?? '0') || 0;
    localStorage.setItem('dhrona.waTip', String(i + 1));
  } catch {
    i = Math.floor(Math.random() * ROTATING.length);
  }
  return ROTATING[i % ROTATING.length]!;
}

function Tips({ id, tips }: { id: string | number; tips: string[] }) {
  return (
    <div className="relative w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-[16px] border border-[#bfe8d4] bg-surface shadow-[var(--shadow-pop)]">
      <div className="flex items-center gap-3 bg-[linear-gradient(120deg,#07603f,#0e9466_55%,#25c48a)] px-4 py-3 text-white">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white/15 ring-1 ring-white/25">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-bold">Keep your WhatsApp number safe</span>
        <button type="button" onClick={() => toast.dismiss(id)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="flex flex-col gap-2.5 px-4 py-3.5">
        {tips.map((t, i) => (
          <li key={t} className="tip-in flex gap-2.5 text-[13px] leading-snug text-ink-2" style={{ animationDelay: `${150 + i * 140}ms` }}>
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
            {t}
          </li>
        ))}
      </ul>
      <span className="tip-timer absolute bottom-0 left-0 h-[3px] w-full origin-left bg-success" style={{ animationDuration: `${SHOW_MS}ms` }} aria-hidden />
    </div>
  );
}

/** Call right after the send animation. Shows once the plane has flown off. */
export function showWhatsAppSafetyTips(delay = 1400) {
  const tips = [...ALWAYS, nextRotating()];
  window.setTimeout(() => toast.custom((id) => <Tips id={id} tips={tips} />, { duration: SHOW_MS }), delay);
}
