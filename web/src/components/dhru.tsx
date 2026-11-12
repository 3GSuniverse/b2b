import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, Minus, SendHorizontal, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

/**
 * Dhru: Dhrona's little robot helper. He hovers in the corner of every page, blinks, follows the
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

/** Dhru himself: a small hovering robot. `look` is where his eyes point, -1..1 on each axis. */
export function DhruFigure({ mood, look = { x: 0, y: 0 }, blink, size = 76 }: { mood: Mood; look?: { x: number; y: number }; blink?: boolean; size?: number }) {
  const E = '#5ff2c2';
  const lx = mood === 'thinking' ? 3 : mood === 'sorry' ? 0 : look.x * 3.2;
  const ly = mood === 'thinking' ? -3 : mood === 'sorry' ? 2 : look.y * 2.6;
  const closed = mood === 'sleep' || (blink && mood !== 'happy' && mood !== 'excited');
  const waving = mood === 'wave' || mood === 'excited';
  const line = { stroke: E, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <svg width={size} height={size * 1.12} viewBox="-6 -10 112 122" aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id="dhru-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e9e7fc" />
        </linearGradient>
        <linearGradient id="dhru-visor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2a2670" />
          <stop offset="100%" stopColor="#15123a" />
        </linearGradient>
        <linearGradient id="dhru-suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b4fe0" />
          <stop offset="100%" stopColor="#3b31b4" />
        </linearGradient>
      </defs>
      {/* Antenna with an arrow tip: a nod to Drona, the archer's teacher */}
      <g className="dhru-tuft" style={{ transformOrigin: '50px 16px', transformBox: 'view-box' }}>
        <path d="M50 16 L50 6" stroke="#8f86ff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M50 -2 L55 5 L50 3.5 L45 5 Z" fill="#ff8a1f" />
      </g>
      {/* Ear pods */}
      <rect x="9" y="28" width="9" height="18" rx="4.5" fill="#4a3fd1" />
      <rect x="82" y="28" width="9" height="18" rx="4.5" fill="#4a3fd1" />
      {/* Head and visor */}
      <rect x="15" y="14" width="70" height="50" rx="22" fill="url(#dhru-head)" />
      <rect x="23" y="21" width="54" height="36" rx="16" fill="url(#dhru-visor)" />
      <rect x="28" y="24" width="18" height="4" rx="2" fill="#fff" opacity="0.14" />
      <g opacity={mood === 'sleep' ? 0.65 : 1}>
        {closed ? (
          <g {...line} strokeWidth="2.6">
            <path d="M34 37 Q39 41 44 37" />
            <path d="M56 37 Q61 41 66 37" />
          </g>
        ) : mood === 'happy' || mood === 'excited' ? (
          <g {...line} strokeWidth="3.4">
            <path d="M34 39 Q39 30 44 39" />
            <path d="M56 39 Q61 30 66 39" />
          </g>
        ) : (
          <g>
            <rect x={35 + lx} y={30 + ly} width="8" height={mood === 'sorry' ? 9 : 12} rx="4" fill={E} />
            <rect x={57 + lx} y={30 + ly} width="8" height={mood === 'sorry' ? 9 : 12} rx="4" fill={E} />
            <rect x={37 + lx} y={32 + ly} width="2.5" height="3.5" rx="1.2" fill="#fff" />
            <rect x={59 + lx} y={32 + ly} width="2.5" height="3.5" rx="1.2" fill="#fff" />
            {mood === 'sorry' && (
              <g {...line} strokeWidth="2">
                <path d="M33 27 L42 29" />
                <path d="M67 27 L58 29" />
              </g>
            )}
          </g>
        )}
        {mood === 'happy' || mood === 'excited' ? (
          <path d="M43 45 Q50 54 57 45 Z" fill={E} />
        ) : mood === 'thinking' ? (
          <g fill={E}>
            <circle cx="44" cy="48" r="1.8" className="animate-pulse" />
            <circle cx="50" cy="48" r="1.8" opacity="0.6" className="animate-pulse [animation-delay:150ms]" />
            <circle cx="56" cy="48" r="1.8" opacity="0.3" className="animate-pulse [animation-delay:300ms]" />
          </g>
        ) : mood === 'sleep' ? (
          <ellipse cx="50" cy="48" rx="2.4" ry="1.6" fill={E} />
        ) : mood === 'sorry' ? (
          <path d="M45 49 Q50 45 55 49" {...line} strokeWidth="2.4" />
        ) : (
          <path d="M45 47 Q50 51 55 47" {...line} strokeWidth="2.4" />
        )}
      </g>
      <ellipse cx="29" cy="47" rx="3.6" ry="2.2" fill="#ff8aa8" opacity="0.55" />
      <ellipse cx="71" cy="47" rx="3.6" ry="2.2" fill="#ff8aa8" opacity="0.55" />
      {/* Body with the Dhrona dot */}
      <path d="M36 66 H64 Q66 66 65.5 68 L62 84 Q61 87 58 87 H42 Q39 87 38 84 L34.5 68 Q34 66 36 66 Z" fill="url(#dhru-suit)" />
      <circle cx="50" cy="75" r="4.2" fill="#ff8a1f" />
      <circle cx="50" cy="75" r="1.6" fill="#fff" />
      {/* Floating hands */}
      <g style={{ transformOrigin: '20px 72px', transformBox: 'view-box', animation: waving ? 'dhru-wave-hand 1.3s ease-in-out' : undefined }}>
        <ellipse cx="20" cy="73" rx="6" ry="7" fill="#f7f6ff" stroke="#dcd9f6" strokeWidth="1.2" />
      </g>
      <ellipse cx="80" cy="73" rx="6" ry="7" fill="#f7f6ff" stroke="#dcd9f6" strokeWidth="1.2" />
      {/* Jet */}
      <g className="dhru-jet" style={{ transformOrigin: '50px 89px', transformBox: 'view-box' }}>
        <path d="M44 89 Q50 104 56 89 Z" fill="#ff8a1f" />
        <path d="M47 89 Q50 97 53 89 Z" fill="#ffd28a" />
      </g>
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
                I need Drona AI to answer. It comes with every paid plan.{' '}
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
