import { Bell, Check, CheckCheck, Eye, MessageCircle, Sparkles, Wallet } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';

/**
 * Illustrations for the public home page, drawn from what Drona really does.
 * They are pictures, not working screens: hidden from screen readers, and still when the
 * visitor prefers reduced motion.
 */

const PLANE = 'M4 12l16-8-6 16-3-7-7-1z';

// ------------------------------------------------------------------ The journey of one trip (hero)

type Stop = { key: string; card: ReactNode };

const STOPS: Stop[] = [
  {
    key: 'enquiry',
    card: (
      <div className="flex flex-col gap-2.5">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-[#128c4a]">
          <MessageCircle className="h-3.5 w-3.5" /> New enquiry on WhatsApp
        </span>
        <p className="rounded-[12px] rounded-tl-[4px] bg-[#e7f8ee] px-3 py-2 text-[13px] leading-snug text-ink">
          Hi! A Kerala trip for 2 adults, 12 to 16 December. Budget around ₹50,000.
        </p>
        <span className="text-[11px] text-muted">Nisha Das, 10:42 am</span>
      </div>
    ),
  },
  {
    key: 'quote',
    card: (
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-accent">Quote sent</span>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-bold">Kerala backwaters, 4N/5D</span>
          <span className="tnum text-[14px] font-bold">₹49,300</span>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] text-success-strong">
          <Eye className="h-3.5 w-3.5" /> Opened by Nisha, 11:05 am
        </span>
      </div>
    ),
  },
  {
    key: 'payment',
    card: (
      <div className="flex flex-col gap-2.5">
        <span className="flex items-center justify-between gap-2 text-[12px] font-semibold">
          <span className="flex items-center gap-1.5 text-success-strong">
            <Wallet className="h-3.5 w-3.5" /> Advance received by UPI
          </span>
          <span className="text-muted">Receipt #15</span>
        </span>
        <span className="tnum text-[20px] font-extrabold tracking-tight">₹12,500</span>
        <span className="h-1.5 overflow-hidden rounded-full bg-line-soft">
          <span className="block h-full w-1/4 rounded-full bg-success" />
        </span>
      </div>
    ),
  },
  {
    key: 'pass',
    card: (
      <div className="flex items-stretch">
        <div className="flex flex-1 flex-col gap-2 pr-4">
          <span className="text-[12px] font-semibold text-accent">Booked and ready</span>
          <span className="flex items-center gap-2 text-[18px] font-extrabold tracking-tight">
            Kochi
            <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-45 fill-none stroke-highlight" strokeWidth={2.2} strokeLinejoin="round">
              <path d={PLANE} />
            </svg>
            Munnar
          </span>
          <span className="text-[12px] text-muted">Nisha Das and 1 more, pickup 12 Dec, 9:00 am</span>
        </div>
        <div className="flex w-16 flex-col items-center justify-center gap-1 border-l-2 border-dashed border-line pl-3 text-center">
          <span className="text-[10px] font-semibold text-muted">Seat</span>
          <span className="text-[15px] font-extrabold text-highlight">2A</span>
        </div>
      </div>
    ),
  },
];

const TRAVEL_MS = 7000;
const HOLD_MS = 2600;

/** One trip's journey, from the first message to the boarding pass, with the plane flying it. */
export function JourneyHero() {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const route = useRef<SVGPathElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ d: string; w: number; h: number } | null>(null);
  const [reached, setReached] = useState(reduced ? STOPS.length : 0);

  // Draw the route through the middle of each card, so it winds left and right as they alternate
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const pts = cards.current.map((c) => {
        const b = c!.getBoundingClientRect();
        return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
      });
      if (pts.length < 2) return;
      const first = pts[0]!;
      let d = `M${first.x - 40} ${Math.max(4, first.y - 70)} Q${first.x - 40} ${first.y} ${first.x} ${first.y}`;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const dy = (b.y - a.y) * 0.55;
        d += ` C${a.x} ${a.y + dy} ${b.x} ${b.y - dy} ${b.x} ${b.y}`;
      }
      setGeo({ d, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fly the plane along the route; each card lights up as the plane reaches it
  useEffect(() => {
    const path = route.current;
    if (!geo || !path) return;
    const total = path.getTotalLength();
    // How far along the route each card's centre sits
    const stopsAt = cards.current.map((c) => {
      const b = c!.getBoundingClientRect();
      const r = box.current!.getBoundingClientRect();
      const target = { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
      let best = 0;
      let bestDist = Infinity;
      for (let l = 0; l <= total; l += 4) {
        const p = path.getPointAtLength(l);
        const dist = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = l;
        }
      }
      return best;
    });
    const place = (len: number) => {
      const p = path.getPointAtLength(len);
      const q = path.getPointAtLength(Math.min(total, len + 1));
      const angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI + 45;
      plane.current?.style.setProperty('transform', `translate(${p.x}px, ${p.y}px) rotate(${angle}deg)`);
      trail.current?.setAttribute('stroke-dasharray', `${len} ${total}`);
      setReached(stopsAt.filter((s) => s <= len + 2).length);
    };
    if (reduced) {
      place(total);
      return;
    }
    let raf = 0;
    let start = performance.now();
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const tick = (now: number) => {
      const t = now - start;
      if (t > TRAVEL_MS + HOLD_MS) start = now;
      place(total * ease(Math.min(1, t / TRAVEL_MS)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geo, reduced]);

  return (
    <div ref={box} aria-hidden className="relative mx-auto flex w-full max-w-[520px] flex-col gap-6 py-6">
      {geo && (
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={geo.w} height={geo.h}>
          <path ref={route} d={geo.d} fill="none" stroke="var(--color-accent)" strokeOpacity={0.25} strokeWidth={2} strokeDasharray="2 8" strokeLinecap="round" />
          <path ref={trail} d={geo.d} fill="none" stroke="var(--color-highlight)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="0 99999" />
        </svg>
      )}
      {STOPS.map((s, i) => (
        <div
          key={s.key}
          ref={(el) => {
            cards.current[i] = el;
          }}
          className={cn(
            'relative z-10 w-[86%] rounded-[16px] border bg-surface p-4 transition-[opacity,transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(0.22,1.2,0.36,1)] sm:w-[74%]',
            i % 2 ? 'self-end' : 'self-start',
            i < reached ? 'border-transparent opacity-100 shadow-[0_14px_36px_-14px_rgb(23_21_59/0.35)]' : 'translate-y-1 scale-[0.98] border-line opacity-45 shadow-none',
          )}
        >
          {s.card}
        </div>
      ))}
      <div ref={plane} className="pointer-events-none absolute left-0 top-0 z-20 -ml-[18px] -mt-[18px] grid h-9 w-9 place-items-center rounded-[11px] bg-primary shadow-[0_10px_24px_-8px_var(--color-primary)]" style={{ transform: 'translate(-100px,-100px)' }}>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] -rotate-45 fill-none stroke-highlight" strokeWidth={2.2} strokeLinejoin="round">
          <path d={PLANE} />
        </svg>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Enquiry board

const BOARD = [
  { title: 'Enquiry', tone: 'bg-blue-soft text-blue-ink', cards: ['Kashmir family trip', 'Goa with friends'] },
  { title: 'Quoted', tone: 'bg-warm-soft text-warm-strong', cards: ['Rajasthan forts'] },
  { title: 'Booked', tone: 'bg-success-soft text-success-strong', cards: ['Char Dham yatra', 'Goa beaches'] },
];

export function BoardGraphic() {
  // Fixed sizes (16px padding, 22px headings, 64px cards, 10px and 12px gaps) so the moving card
  // always lands in the free slot under Booked, at any width
  const card = 'flex h-16 flex-col justify-center gap-1.5 rounded-[12px] bg-surface px-2.5 shadow-[0_1px_2px_rgb(23_21_59/0.06)]';
  return (
    <div aria-hidden className="relative grid grid-cols-3 gap-x-3 rounded-[20px] bg-sunken p-4">
      {BOARD.map((col, ci) => (
        <div key={col.title} className="flex min-w-0 flex-col gap-2.5">
          <span className={cn('flex h-[22px] items-center self-start rounded-full px-2.5 text-[11px] font-bold', col.tone)}>{col.title}</span>
          {ci === 1 && <div className="h-16 rounded-[12px] border-2 border-dashed border-line" />}
          {col.cards.map((c) => (
            <div key={c} className={card}>
              <span className="truncate text-[12px] font-bold">{c}</span>
              <span className="h-1.5 w-2/3 rounded-full bg-line-soft" />
              <span className="h-1.5 w-1/3 rounded-full bg-line-soft" />
            </div>
          ))}
          {ci === 2 && <div className="h-16 rounded-[12px] border-2 border-dashed border-line" />}
        </div>
      ))}
      {/* The trip that gets booked, moving from Quoted to the free slot under Booked */}
      <div className="board-move pointer-events-none absolute top-[48px] w-[calc((100%-56px)/3)]" style={{ left: 'calc(16px + (100% - 56px) / 3 + 12px)' }}>
        <div className={cn(card, 'shadow-[0_12px_28px_-10px_rgb(23_21_59/0.35)] ring-2 ring-accent')}>
          <span className="truncate text-[12px] font-bold">Kerala backwaters</span>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-success-strong">
            <Check className="h-3 w-3" /> Advance paid
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Quote with an AI draft

const INTROS = [
  { lang: 'English', text: 'Here is your 4-night Kerala plan, with a houseboat night in Alleppey.' },
  { lang: 'తెలుగు', text: 'అలెప్పీలో హౌస్‌బోట్ బసతో మీ 4 రాత్రుల కేరళ యాత్ర ప్రణాళిక ఇదిగో.' },
  { lang: 'हिन्दी', text: 'अलेप्पी में हाउसबोट के साथ आपकी 4 रातों की केरल यात्रा योजना यह रही।' },
];
const LINES: [string, string][] = [
  ['Houseboat in Alleppey, 1 night', '₹9,500'],
  ['Hotel in Munnar, 2 nights', '₹14,000'],
  ['Cab for 5 days', '₹12,800'],
  ['Sightseeing and entry tickets', '₹4,200'],
];

export function QuoteGraphic() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % INTROS.length), 2800);
    return () => clearInterval(t);
  }, [reduced]);
  return (
    <div aria-hidden className="relative rounded-[20px] bg-sunken p-4 sm:p-5">
      <div className="flex flex-col gap-4 rounded-[16px] bg-surface p-5 shadow-[0_1px_2px_rgb(23_21_59/0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-muted">Quote for Nisha Das</span>
            <span className="text-[16px] font-extrabold tracking-tight">Kerala backwaters, 4N/5D</span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent">
            <Sparkles className="h-3 w-3" /> Drafted with AI
          </span>
        </div>
        <div className="flex gap-1.5">
          {INTROS.map((x, n) => (
            <span key={x.lang} className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors duration-300', n === i ? 'bg-ink text-white' : 'bg-line-soft text-muted')}>
              {x.lang}
            </span>
          ))}
        </div>
        <p key={i} className="animate-in min-h-[44px] text-[13px] leading-relaxed text-ink-2">
          {INTROS[i]!.text}
        </p>
        <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
          {LINES.map(([a, b]) => (
            <li key={a} className="flex justify-between gap-3 py-2">
              <span className="text-ink-2">{a}</span>
              <span className="tnum font-semibold">{b}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 pt-2.5 text-[14px]">
            <span className="font-bold">Total for 2 adults</span>
            <span className="tnum font-extrabold">₹40,500</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Payment schedule

export function PaymentsGraphic() {
  const rows = [
    { label: 'Advance', amount: '₹30,000', note: 'Paid by UPI, receipt #18', state: 'paid' },
    { label: 'Second instalment', amount: '₹45,000', note: 'Due 20 Nov. Reminder sent on WhatsApp', state: 'reminded' },
    { label: 'Balance', amount: '₹45,000', note: 'Due 5 Dec', state: 'later' },
  ] as const;
  return (
    <div aria-hidden className="relative rounded-[20px] bg-sunken p-4 sm:p-5">
      <div className="flex flex-col gap-4 rounded-[16px] bg-surface p-5 shadow-[0_1px_2px_rgb(23_21_59/0.06)]">
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 44 44" className="h-14 w-14 shrink-0 -rotate-90">
            <circle cx="22" cy="22" r="18" fill="none" stroke="var(--color-line-soft)" strokeWidth="6" />
            <circle className="pay-ring" cx="22" cy="22" r="18" fill="none" stroke="var(--color-success)" strokeWidth="6" strokeLinecap="round" pathLength={100} strokeDasharray="25 100" />
          </svg>
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-muted">Kashmir family trip</span>
            <span className="tnum text-[18px] font-extrabold tracking-tight">₹30,000 of ₹1,20,000</span>
          </div>
        </div>
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3 rounded-[12px] bg-sunken px-3 py-2.5">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full',
                  r.state === 'paid' ? 'bg-success text-white' : r.state === 'reminded' ? 'bg-highlight-soft text-warm' : 'bg-line-soft text-muted',
                )}
              >
                {r.state === 'paid' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : r.state === 'reminded' ? <Bell className="pay-bell h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-bold">{r.label}</span>
                <span className="truncate text-[11px] text-muted">{r.note}</span>
              </span>
              <span className="tnum text-[13px] font-bold">{r.amount}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="pay-toast absolute -bottom-4 right-4 flex items-center gap-2 rounded-[12px] bg-ink px-3.5 py-2.5 text-[12px] font-semibold text-white shadow-[0_14px_30px_-10px_rgb(23_21_59/0.5)] sm:right-8">
        <CheckCheck className="h-4 w-4 text-accent-ring" /> ₹30,000 received. Receipt sent on WhatsApp.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Coach seats for a group departure

const FAMILIES = [
  { name: 'Reddy family', seats: 4, cls: 'bg-accent text-white' },
  { name: 'Iyer family', seats: 3, cls: 'bg-highlight text-white' },
  { name: 'Khan family', seats: 4, cls: 'bg-success text-white' },
  { name: 'Das family', seats: 3, cls: 'bg-plum-ink text-white' },
];

export function SeatsGraphic() {
  // A 2 + 2 coach: 7 rows of four and a back row of two, 30 seats, the first 14 taken in family order
  const taken: string[] = FAMILIES.flatMap((f) => Array.from({ length: f.seats }, () => f.cls));
  const rows = Array.from({ length: 8 }, (_, r) => (r < 7 ? [0, 1, null, 2, 3] : [0, 1, null, null, null]).map((c) => (c === null ? null : r * 4 + c)));
  return (
    <div aria-hidden className="rounded-[20px] bg-sunken p-4 sm:p-5">
      <div className="flex flex-col gap-4 rounded-[16px] bg-surface p-5 shadow-[0_1px_2px_rgb(23_21_59/0.06)] sm:flex-row sm:items-start sm:gap-6">
        <div className="flex flex-col gap-1.5 self-center rounded-[18px] border-2 border-line p-3 pt-5">
          {rows.map((row, r) => (
            <div key={r} className="flex gap-1.5">
              {row.map((seat, c) =>
                seat === null ? (
                  <span key={c} className="h-6 w-4" />
                ) : (
                  <span
                    key={c}
                    className={cn('seat-in grid h-6 w-6 place-items-center rounded-[6px] text-[9px] font-bold', taken[seat] ?? 'border border-line bg-sunken')}
                    style={{ animationDelay: `${seat * 35}ms` }}
                  />
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-muted">Group departure</span>
            <span className="text-[16px] font-extrabold tracking-tight">Char Dham Yatra, May 2027</span>
            <span className="tnum text-[13px] text-ink-2">14 of 30 seats booked</span>
          </div>
          <ul className="flex flex-col gap-2">
            {FAMILIES.map((f) => (
              <li key={f.name} className="flex items-center gap-2.5 text-[13px]">
                <span className={cn('h-3.5 w-3.5 rounded-[4px]', f.cls)} />
                <span className="flex-1 font-semibold">{f.name}</span>
                <span className="tnum text-muted">{f.seats} seats</span>
              </li>
            ))}
          </ul>
          <span className="rounded-[10px] bg-accent-soft px-3 py-2 text-[12px] font-semibold text-accent">Manifest with rooms, ready to print</span>
        </div>
      </div>
    </div>
  );
}
