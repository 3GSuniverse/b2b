import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, Minus, SendHorizontal, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

/**
 * Dhru: Dhrona's little helper. He floats in the corner of every page, blinks, follows the
 * pointer with his eyes, waves when you come close, naps when you're away, and thinks while
 * Drona AI works on your question. Click him to chat: he shows where things are, explains
 * features and drafts emails and WhatsApp messages.
 */

type Mood = 'idle' | 'wave' | 'thinking' | 'happy' | 'excited' | 'sorry' | 'sleep';
type Draft = { kind: 'email' | 'whatsapp'; subject: string | null; body: string };
type Msg = { from: 'user' | 'buddy'; text: string; links?: { label: string; to: string }[]; draft?: Draft | null };
type Answer = { reply: string; links: { label: string; to: string }[]; draft: Draft | null; mood: 'happy' | 'thinking' | 'excited' | 'sorry' };

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: fine */
    }
  },
};

/** Dhru himself. `look` is where his eyes point, -1..1 on each axis. */
export function DhruFigure({ mood, look = { x: 0, y: 0 }, blink, size = 76 }: { mood: Mood; look?: { x: number; y: number }; blink?: boolean; size?: number }) {
  const closed = blink || mood === 'sleep';
  const ex = mood === 'thinking' ? 0.4 : look.x;
  const ey = mood === 'thinking' ? -1 : mood === 'sorry' ? 0.6 : look.y;
  const px = ex * 2.6;
  const py = ey * 2.2;
  const happyEyes = mood === 'happy' || mood === 'excited';
  return (
    <svg width={size} height={size * 1.08} viewBox="0 0 100 108" aria-hidden className="overflow-visible">
      <defs>
        <radialGradient id="dhru-body" cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#8f86ff" />
          <stop offset="55%" stopColor="#5b4fe0" />
          <stop offset="100%" stopColor="#3b31b4" />
        </radialGradient>
        <radialGradient id="dhru-belly" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ecebfd" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      {/* The feather tuft: a nod to Drona, the archer's teacher */}
      <g className="dhru-tuft">
        <path d="M50 20 C46 10 48 3 55 0 C54 7 57 11 53 20 Z" fill="#ff8a1f" />
        <path d="M51 19 C49 12 50 7 54 3" stroke="#ffb067" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M49 21 C42 15 38 10 39 4 C44 8 47 12 50 19 Z" fill="#ffb067" />
      </g>
      {/* Arms */}
      <g style={{ transformOrigin: '22px 62px', animation: mood === 'wave' || mood === 'excited' ? 'dhru-wave 1.2s ease-in-out' : undefined }}>
        <path d="M24 60 C14 58 9 52 10 46" stroke="#4a3fd1" strokeWidth="7" strokeLinecap="round" fill="none" />
        <circle cx="10" cy="45" r="4.6" fill="#5b4fe0" />
      </g>
      <path d="M76 62 C85 64 89 70 88 76" stroke="#4a3fd1" strokeWidth="7" strokeLinecap="round" fill="none" />
      <circle cx="88" cy="77" r="4.6" fill="#5b4fe0" />
      {/* Feet */}
      <ellipse cx="38" cy="99" rx="9" ry="5" fill="#3b31b4" />
      <ellipse cx="62" cy="99" rx="9" ry="5" fill="#3b31b4" />
      {/* Body */}
      <path d="M50 18 C76 18 88 38 88 60 C88 84 72 99 50 99 C28 99 12 84 12 60 C12 38 24 18 50 18 Z" fill="url(#dhru-body)" />
      <ellipse cx="50" cy="74" rx="22" ry="18" fill="url(#dhru-belly)" />
      <ellipse cx="34" cy="32" rx="9" ry="5" fill="#fff" opacity="0.22" transform="rotate(-25 34 32)" />
      {/* Saffron scarf */}
      <path d="M24 74 C36 82 64 82 76 74 L74 80 C62 87 38 87 26 80 Z" fill="#ff8a1f" />
      <path d="M64 81 L70 94 L62 92 Z" fill="#e2731a" />
      {/* Face */}
      {closed ? (
        <g stroke="#17153b" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M33 51 Q38 55 43 51" />
          <path d="M57 51 Q62 55 67 51" />
        </g>
      ) : happyEyes ? (
        <g stroke="#17153b" strokeWidth="2.8" strokeLinecap="round" fill="none">
          <path d="M33 53 Q38 46 43 53" />
          <path d="M57 53 Q62 46 67 53" />
        </g>
      ) : (
        <g>
          <ellipse cx="38" cy="51" rx="7.5" ry="8.5" fill="#fff" />
          <ellipse cx="62" cy="51" rx="7.5" ry="8.5" fill="#fff" />
          <circle cx={38 + px} cy={52 + py} r="4.6" fill="#17153b" />
          <circle cx={62 + px} cy={52 + py} r="4.6" fill="#17153b" />
          <circle cx={39.6 + px} cy={50.2 + py} r="1.6" fill="#fff" />
          <circle cx={63.6 + px} cy={50.2 + py} r="1.6" fill="#fff" />
          {mood === 'sorry' && (
            <g stroke="#17153b" strokeWidth="2" strokeLinecap="round">
              <path d="M31 41 L42 44" />
              <path d="M69 41 L58 44" />
            </g>
          )}
        </g>
      )}
      <ellipse cx="29" cy="62" rx="5" ry="3" fill="#ff8aa8" opacity="0.65" />
      <ellipse cx="71" cy="62" rx="5" ry="3" fill="#ff8aa8" opacity="0.65" />
      {mood === 'excited' || mood === 'happy' ? (
        <path d="M43 61 Q50 70 57 61 Q50 64 43 61 Z" fill="#17153b" />
      ) : mood === 'sorry' ? (
        <path d="M45 65 Q50 61 55 65" stroke="#17153b" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      ) : mood === 'thinking' ? (
        <circle cx="53" cy="64" r="2.2" fill="#17153b" />
      ) : mood === 'sleep' ? (
        <ellipse cx="50" cy="64" rx="2.4" ry="1.6" fill="#17153b" />
      ) : (
        <path d="M44 62 Q50 67 56 62" stroke="#17153b" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

const CHIPS: { when: RegExp; ask: string[] }[] = [
  { when: /^\/whatsapp/, ask: ['How does Autopilot work?', 'Write a WhatsApp offer for Goa', 'Where do I link my number?'] },
  { when: /^\/email|^\/campaigns/, ask: ['Write a Diwali wishes email', 'How do I send to one list?', 'Why aren’t my emails opening?'] },
  { when: /^\/trips/, ask: ['How do I make a quote?', 'Where do I add a package?', 'Remind a customer about the balance'] },
  { when: /^\/contacts/, ask: ['How do I import from Excel?', 'Write a welcome message for new customers'] },
  { when: /^\/calls/, ask: ['How do I forward my calls?', 'What does the AI Caller say?'] },
  { when: /.*/, ask: ['What can you do?', 'Write a festive offer email', 'Where is the WhatsApp inbox?'] },
];

export function Dhru() {
  const { user } = useSession();
  const loc = useLocation();
  const navigate = useNavigate();
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api.get<{ enabled: boolean; configured?: boolean; inPlan?: boolean }>('/api/ai'), staleTime: 300_000 });
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => store.get('dhru.hidden') === '1');
  const [mood, setMood] = useState<Mood>('idle');
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [hello, setHello] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const me = useRef<HTMLButtonElement>(null);
  const lastMove = useRef(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = user.name?.split(' ')[0] ?? 'there';

  const feel = useCallback((m: Mood, ms = 1600) => {
    clearTimeout(moodTimer.current);
    setMood(m);
    if (m !== 'thinking' && m !== 'sleep') moodTimer.current = setTimeout(() => setMood('idle'), ms);
  }, []);

  // Blinks now and then
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, 2500 + Math.random() * 3500);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // Eyes follow the pointer; naps after two quiet minutes
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastMove.current = Date.now();
      if (mood === 'sleep') feel('wave', 1400);
      const r = me.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.max(1, Math.hypot(dx, dy));
      setLook({ x: dx / d, y: dy / d });
    };
    const nap = setInterval(() => {
      if (!open && Date.now() - lastMove.current > 120_000) setMood((m) => (m === 'idle' ? 'sleep' : m));
    }, 10_000);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      clearInterval(nap);
    };
  }, [mood, open, feel]);

  // Says hello once a day
  useEffect(() => {
    const today = new Date().toDateString();
    if (store.get('dhru.hello') === today) return;
    const t = setTimeout(() => {
      setHello(true);
      feel('wave', 1600);
      store.set('dhru.hello', today);
      setTimeout(() => setHello(false), 7000);
    }, 2500);
    return () => clearTimeout(t);
  }, [feel]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length]);

  const ask = useMutation({
    mutationFn: (message: string) => api.post<Answer>('/api/ai/buddy', { message, page: loc.pathname + loc.search, history: msgs.slice(-10).map((m) => ({ from: m.from, text: m.text })) }),
    onMutate: (message) => {
      setMsgs((m) => [...m, { from: 'user', text: message }]);
      setText('');
      feel('thinking');
    },
    onSuccess: (a) => {
      setMsgs((m) => [...m, { from: 'buddy', text: a.reply, links: a.links, draft: a.draft }]);
      feel(a.mood === 'sorry' ? 'sorry' : a.draft || a.mood === 'excited' ? 'excited' : 'happy', 2200);
    },
    onError: (e) => {
      setMsgs((m) => [...m, { from: 'buddy', text: e instanceof ApiError ? e.message : 'I couldn’t reach Drona AI just now. Try again in a moment?' }]);
      feel('sorry', 2200);
    },
  });
  const send = (q?: string) => {
    const message = (q ?? text).trim();
    if (message && !ask.isPending) ask.mutate(message);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  if (!ai.data?.configured) return null;
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => {
          setHidden(false);
          store.set('dhru.hidden', '0');
          feel('wave', 1600);
        }}
        className="fixed bottom-4 right-0 z-40 flex items-center gap-1 rounded-l-full bg-accent py-2 pl-3 pr-2 text-[12px] font-semibold text-white shadow-lg transition-transform hover:-translate-x-1"
        aria-label="Bring Dhru back"
      >
        <Sparkles className="h-3.5 w-3.5" /> Dhru
      </button>
    );
  }
  const chips = CHIPS.find((c) => c.when.test(loc.pathname))!.ask;
  const locked = ai.data.inPlan === false;

  return (
    <div className={cn('pointer-events-none fixed right-3 z-40 flex flex-col items-end gap-2 sm:right-5', /^\/whatsapp\/inbox/.test(loc.pathname) ? 'bottom-28' : 'bottom-3 sm:bottom-5')}>
      {open && (
        <section
          role="dialog"
          aria-label="Chat with Dhru"
          className="pointer-events-auto flex h-[min(560px,calc(100dvh-140px))] w-[min(380px,calc(100vw-24px))] origin-bottom-right animate-pop flex-col overflow-hidden rounded-[24px] border border-line bg-surface shadow-[0_30px_80px_-24px_rgb(29_26_77/0.55)]"
        >
          <header className="relative flex items-center gap-3 overflow-hidden bg-[linear-gradient(120deg,#1d1a4d,#4a3fd1_60%,#a2348f)] px-4 py-3.5 text-white">
            <div aria-hidden className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-highlight/40 blur-2xl" />
            <span className="relative -my-2 shrink-0">
              <DhruFigure mood={ask.isPending ? 'thinking' : 'happy'} size={44} />
            </span>
            <div className="relative flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-extrabold">Dhru</span>
              <span className="text-[12px] text-white/75">{ask.isPending ? 'Thinking…' : 'Your Dhrona helper'}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-white/15" aria-label="Close chat">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scroller} className="flex flex-1 flex-col gap-3 overflow-y-auto bg-sunken px-3.5 py-4">
            <Bubble from="buddy">
              Hi {first}! 👋 I’m Dhru. I can show you where things are, explain any feature, or write an email or WhatsApp message for your customers.
            </Bubble>
            {locked && (
              <Bubble from="buddy">
                I need Drona AI to answer. It comes with the Professional plan.{' '}
                <Link to="/agency/billing" onClick={() => setOpen(false)} className="font-semibold text-accent underline underline-offset-4">
                  See plans
                </Link>
              </Bubble>
            )}
            {msgs.map((m, i) => (
              <div key={i} className="flex flex-col gap-2 animate-[rise-in_350ms_both]">
                <Bubble from={m.from}>{m.text}</Bubble>
                {m.draft && <DraftCard d={m.draft} onOpen={(to) => { navigate(to); setOpen(false); }} />}
                {!!m.links?.length && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {m.links.map((l) => (
                      <button
                        key={l.to + l.label}
                        type="button"
                        onClick={() => {
                          navigate(l.to);
                          feel('happy');
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
                      >
                        {l.label} <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {ask.isPending && (
              <div className="flex w-fit gap-1 rounded-[18px] rounded-bl-md bg-surface px-4 py-3 shadow-sm">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-accent/60" style={{ animationDelay: `${i * 140}ms` }} />
                ))}
              </div>
            )}
            {!msgs.length && !locked && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <button key={c} type="button" onClick={() => send(c)} className="rounded-full bg-accent-soft px-3 py-1.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent hover:text-white">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <footer className="border-t border-line-soft bg-surface p-2.5">
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                maxLength={1500}
                disabled={locked}
                placeholder={locked ? 'Available with Drona AI' : 'Ask Dhru anything…'}
                aria-label="Message Dhru"
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-[21px] border border-line bg-sunken px-4 py-[10px] text-[13.5px] outline-none [field-sizing:content] focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!text.trim() || ask.isPending || locked}
                className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-accent text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                aria-label="Send"
              >
                <SendHorizontal className="h-[18px] w-[18px]" />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between px-2 text-[11px] text-faint">
              <span>Dhru can make mistakes. Check drafts before sending.</span>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 hover:text-ink"
                onClick={() => {
                  setOpen(false);
                  setHidden(true);
                  store.set('dhru.hidden', '1');
                }}
              >
                <Minus className="h-3 w-3" /> Hide Dhru
              </button>
            </div>
          </footer>
        </section>
      )}

      <div className="pointer-events-auto relative flex items-end gap-2">
        {hello && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mb-10 max-w-[200px] origin-bottom-right animate-pop rounded-[18px] rounded-br-md bg-surface px-3.5 py-2.5 text-left text-[13px] font-medium shadow-[0_12px_30px_-12px_rgb(29_26_77/0.45)] ring-1 ring-line"
          >
            Hi {first}! I’m Dhru 👋 Ask me anything about Dhrona.
          </button>
        )}
        <button
          ref={me}
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setHello(false);
            feel(open ? 'idle' : 'excited', 1200);
          }}
          onPointerEnter={() => mood !== 'thinking' && feel('wave', 1300)}
          aria-label={open ? 'Close Dhru' : 'Open Dhru, your Dhrona helper'}
          aria-expanded={open}
          className="group relative grid place-items-center outline-none focus-visible:ring-4 focus-visible:ring-accent/30 rounded-full"
        >
          <span aria-hidden className="dhru-shadow absolute bottom-0 h-3 w-14 rounded-full bg-[#1d1a4d] blur-[3px]" />
          <span
            className={cn('dhru-float relative block', mood === 'sleep' && '[animation-duration:5s]')}
            style={mood === 'excited' || mood === 'happy' ? { animation: 'dhru-bounce 700ms cubic-bezier(0.22,1.2,0.36,1)' } : undefined}
          >
            <span className="block transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
              <DhruFigure mood={ask.isPending ? 'thinking' : mood} look={look} blink={blink} size={68} />
            </span>
            {(ask.isPending || mood === 'thinking') && (
              <span aria-hidden className="absolute -right-1 -top-1 h-6 w-6" style={{ animation: 'dhru-orbit 1.4s linear infinite' }}>
                <Sparkles className="h-4 w-4 text-highlight" />
              </span>
            )}
            {mood === 'sleep' && (
              <span aria-hidden className="absolute -top-2 right-1 text-[13px] font-extrabold text-accent" style={{ animation: 'dhru-zzz 2.2s ease-out infinite' }}>
                z
              </span>
            )}
            {mood === 'excited' && <Sparkles aria-hidden className="absolute -left-2 top-2 h-4 w-4 animate-ping text-highlight" />}
          </span>
        </button>
      </div>
    </div>
  );
}

function Bubble({ from, children }: { from: 'user' | 'buddy'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'max-w-[88%] whitespace-pre-wrap px-3.5 py-2.5 text-[13.5px] leading-relaxed',
        from === 'user' ? 'self-end rounded-[18px] rounded-br-md bg-accent text-white' : 'self-start rounded-[18px] rounded-bl-md bg-surface text-ink shadow-sm',
      )}
    >
      {children}
    </p>
  );
}

function DraftCard({ d, onOpen }: { d: Draft; onOpen: (to: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.subject ? `${d.subject}\n\n${d.body}` : d.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className={cn('flex flex-col gap-2 rounded-[16px] border p-3', d.kind === 'whatsapp' ? 'border-success/30 bg-success-soft/60' : 'border-accent/25 bg-accent-soft/60')}>
      <span className={cn('text-[11px] font-bold uppercase tracking-wide', d.kind === 'whatsapp' ? 'text-success-strong' : 'text-accent')}>{d.kind === 'whatsapp' ? 'WhatsApp draft' : 'Email draft'}</span>
      {d.subject && <p className="text-[13px] font-semibold">{d.subject}</p>}
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[12px] bg-white/80 px-3 py-2 text-[13px] leading-relaxed">{d.body}</p>
      <div className="flex gap-1.5">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-line hover:bg-hover">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => onOpen(`/campaigns/new?channel=${d.kind === 'whatsapp' ? 'WHATSAPP' : 'EMAIL'}`)}
          className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-white', d.kind === 'whatsapp' ? 'bg-success' : 'bg-accent')}
        >
          Use in a broadcast <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
