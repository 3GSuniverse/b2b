import { Check, CheckCheck, Mail, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * The right half of the sign-in and sign-up screens: a live picture of a travel agency's day.
 * Paper planes carry messages from the office to where each traveller is going; the queue below
 * follows them from Sending to Delivered to Opened. Hover a destination or a row to see its route.
 * Everything is made up, and none of it talks to the server.
 */

type Channel = 'email' | 'whatsapp';
type Point = { x: number; y: number };
type Place = Point & { key: string; label: string };
type Msg = { to: string; text: string; place: string; channel: Channel; count?: number };
type Status = 'sending' | 'delivered' | 'opened';
type FeedItem = { id: number; msg: Msg; status: Status };

// A 400 × 250 map, roughly north up and west left. Not to scale, and not meant to be.
const VIEW = { w: 400, h: 250 };
const OFFICE: Point = { x: 228, y: 168 };
const PLACES: Place[] = [
  { key: 'manali', label: 'Manali', x: 132, y: 34 },
  { key: 'jaipur', label: 'Jaipur', x: 92, y: 92 },
  { key: 'varanasi', label: 'Varanasi', x: 244, y: 88 },
  { key: 'darjeeling', label: 'Darjeeling', x: 334, y: 58 },
  { key: 'goa', label: 'Goa', x: 82, y: 178 },
  { key: 'munnar', label: 'Munnar', x: 148, y: 232 },
  { key: 'andaman', label: 'Andaman', x: 352, y: 196 },
];
const PLACE = Object.fromEntries(PLACES.map((p) => [p.key, p])) as Record<string, Place>;

const MESSAGES: Msg[] = [
  { to: 'Priya Nair', text: 'Your Goa trip starts in 3 days', place: 'goa', channel: 'email' },
  { to: 'Rahul Varma', text: 'Balance of ₹18,400 due on Friday', place: 'munnar', channel: 'whatsapp' },
  { to: 'Sneha Rao', text: 'Your Andaman quote is ready', place: 'andaman', channel: 'email' },
  { to: 'the Manali group', text: 'Packing list for the snow', place: 'manali', channel: 'whatsapp', count: 28 },
  { to: 'Arjun Mehta', text: 'Happy birthday, Arjun!', place: 'jaipur', channel: 'whatsapp' },
  { to: 'Imran Khan', text: 'Pickup at 6:30 AM from Bagdogra', place: 'darjeeling', channel: 'whatsapp' },
  { to: 'Meera Joshi', text: 'How was Varanasi? Tell us', place: 'varanasi', channel: 'email' },
  { to: 'Kavya Iyer', text: 'Monsoon offer: Kerala, 5 nights', place: 'munnar', channel: 'email' },
];

const HEADLINES = ['Every reminder on time.', 'Every birthday remembered.', 'Every balance followed up.', 'Every quote answered.'];

const CYCLE_MS = 2800;
const FLIGHT_MS = 1500;
const ROW_STEP = 64; // row height 56 + gap 8
const ROWS = 3;

/** A curved route from a to b, bowing upward like a flight path. */
function route(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const k = len * 0.3;
  const c = { x: (a.x + b.x) / 2 + nx * k, y: (a.y + b.y) / 2 + ny * k };
  return { c, d: `M${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}` };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** The widest a box of this shape can be while still fitting inside the element. */
function useFitWidth(ref: React.RefObject<HTMLElement | null>, ratio: number) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      setWidth(Math.floor(Math.min(w, h * ratio)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ratio]);
  return width;
}

/** One plane on its way. Moves itself with requestAnimationFrame, so the panel doesn't re-render 60 times a second. */
function Flight({ to, onLand }: { to: Place; onLand: () => void }) {
  const plane = useRef<SVGGElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const landed = useRef(onLand);
  landed.current = onLand;
  const { c, d } = route(OFFICE, to);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const tick = (now: number) => {
      const raw = Math.min(1, (now - start) / FLIGHT_MS);
      const t = ease(raw);
      const u = 1 - t;
      const x = u * u * OFFICE.x + 2 * u * t * c.x + t * t * to.x;
      const y = u * u * OFFICE.y + 2 * u * t * c.y + t * t * to.y;
      const tx = 2 * u * (c.x - OFFICE.x) + 2 * t * (to.x - c.x);
      const ty = 2 * u * (c.y - OFFICE.y) + 2 * t * (to.y - c.y);
      const angle = (Math.atan2(ty, tx) * 180) / Math.PI + 45; // the logo's plane points up and to the right
      const scale = 0.72 + Math.sin(raw * Math.PI) * 0.28; // climbs, then lands
      plane.current?.setAttribute('transform', `translate(${x} ${y}) rotate(${angle}) scale(${scale}) translate(-12 -12)`);
      trail.current?.setAttribute('stroke-dashoffset', String(1 - t));
      if (raw < 1) raf = requestAnimationFrame(tick);
      else landed.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The route is fixed for the life of a flight
  }, []);

  return (
    <g className="dispatch-flight">
      <path ref={trail} d={d} pathLength={1} fill="none" stroke="#7FE0C3" strokeOpacity={0.55} strokeWidth={1.4} strokeDasharray="1" strokeDashoffset="1" strokeLinecap="round" />
      <g ref={plane} transform={`translate(${OFFICE.x} ${OFFICE.y}) scale(0) translate(-12 -12)`}>
        <path d="M4 12l16-8-6 16-3-7-7-1z" fill="#111816" stroke="#7FE0C3" strokeWidth={2} strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** Digits that roll into place instead of jumping. */
function Odometer({ value }: { value: number }) {
  const text = value.toLocaleString('en-IN');
  const chars = [...text];
  return (
    <span className="tnum inline-flex h-[1.15em] items-start overflow-hidden leading-[1.15em]" aria-label={text}>
      {chars.map((ch, i) => {
        const key = chars.length - i; // keyed from the right, so the ones column stays the ones column
        if (!/\d/.test(ch)) return <span key={`s${key}`} aria-hidden>{ch}</span>;
        return (
          <span key={key} aria-hidden className="inline-flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]" style={{ transform: `translateY(-${Number(ch) * 1.15}em)` }}>
            {'0123456789'.split('').map((d) => (
              <span key={d} className="h-[1.15em]">{d}</span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

function RotatingLine({ reduced }: { reduced: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % HEADLINES.length), 3400);
    return () => clearInterval(t);
  }, [reduced]);
  const prev = (i - 1 + HEADLINES.length) % HEADLINES.length;
  return (
    <span className="grid">
      <span className="sr-only">{HEADLINES[0]}</span>
      {HEADLINES.map((line, n) => (
        <span
          key={line}
          aria-hidden
          className="col-start-1 row-start-1 transition-[opacity,transform,filter] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ opacity: n === i ? 1 : 0, transform: `translateY(${n === i ? 0 : n === prev ? -0.4 : 0.4}em)`, filter: n === i ? 'none' : 'blur(6px)' }}
        >
          {line}
        </span>
      ))}
    </span>
  );
}

function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  return channel === 'email' ? <Mail className={className} aria-hidden /> : <MessageCircle className={className} aria-hidden />;
}

function StatusChip({ item }: { item: FeedItem }) {
  if (item.status === 'sending') {
    return (
      <span className="flex flex-col items-end gap-1 text-xs text-white/60">
        Sending
        <span className="dispatch-sending h-[2px] w-12 overflow-hidden rounded-full bg-white/10" aria-hidden />
      </span>
    );
  }
  if (item.status === 'delivered') {
    return (
      <span className="dispatch-pop flex items-center gap-1 text-xs text-white/70">
        <Check className="h-3.5 w-3.5" aria-hidden /> Delivered
      </span>
    );
  }
  return (
    <span className="dispatch-pop flex items-center gap-1 text-xs font-medium text-accent-ring">
      <CheckCheck className="h-3.5 w-3.5" aria-hidden /> {item.msg.channel === 'email' ? 'Opened' : 'Read'}
    </span>
  );
}

const seed = (): FeedItem[] => [
  { id: -1, msg: MESSAGES[7]!, status: 'delivered' },
  { id: -2, msg: MESSAGES[6]!, status: 'opened' },
  { id: -3, msg: MESSAGES[5]!, status: 'opened' },
];

/** `headline={false}` leaves out the heading, for pages that already have one (the home page). */
export function DispatchPanel({ headline = true, className }: { headline?: boolean; className?: string } = {}) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const [feed, setFeed] = useState<FeedItem[]>(seed);
  const [flights, setFlights] = useState<{ id: number; place: string }[]>([]);
  const [ripples, setRipples] = useState<{ id: number; place: string }[]>([]);
  const [bubble, setBubble] = useState<{ id: number; msg: Msg } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [sent, setSent] = useState(1248);
  const next = useRef(0);
  const mapBox = useRef<HTMLDivElement>(null);
  const mapWidth = useFitWidth(mapBox, VIEW.w / VIEW.h);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  const land = useCallback(
    (id: number, msg: Msg) => {
      setFeed((f) => f.map((it) => (it.id === id ? { ...it, status: 'delivered' } : it)));
      setSent((n) => n + (msg.count ?? 1));
      setRipples((r) => [...r, { id, place: msg.place }]);
      setBubble({ id, msg });
      later(() => setFlights((fl) => fl.filter((f) => f.id !== id)), 700);
      later(() => setRipples((r) => r.filter((x) => x.id !== id)), 1000);
      later(() => setBubble((b) => (b?.id === id ? null : b)), 2100);
      later(() => setFeed((f) => f.map((it) => (it.id === id ? { ...it, status: 'opened' } : it))), 2300);
    },
    [later],
  );

  useEffect(() => {
    if (reduced) return;
    const launch = () => {
      if (document.visibilityState === 'hidden') return; // no backlog of planes when the tab comes back
      const id = next.current++;
      const msg = MESSAGES[id % MESSAGES.length]!;
      setFeed((f) => [{ id, msg, status: 'sending' as const }, ...f].slice(0, ROWS + 1));
      setFlights((fl) => [...fl, { id, place: msg.place }]);
    };
    const first = setTimeout(launch, 700);
    const every = setInterval(launch, CYCLE_MS);
    const pending = timers.current;
    return () => {
      clearTimeout(first);
      clearInterval(every);
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [reduced]);

  // The panel leans a little toward the pointer
  const lean = (e: React.PointerEvent) => {
    if (reduced || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    panel.current.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    panel.current.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const settle = () => {
    panel.current?.style.setProperty('--px', '0');
    panel.current?.style.setProperty('--py', '0');
    setHover(null);
  };

  const hovered = hover ? PLACE[hover] : null;
  const shown = hovered ? { id: -100, msg: feed.find((f) => f.msg.place === hover)?.msg ?? MESSAGES.find((m) => m.place === hover)! } : bubble;
  const shownPlace = shown ? PLACE[shown.msg.place]! : null;
  const leanStyle = (x: number, y: number): CSSProperties => ({ transform: `translate3d(calc(var(--px) * ${x}px), calc(var(--py) * ${y}px), 0)` });

  return (
    <div
      ref={panel}
      onPointerMove={lean}
      onPointerLeave={settle}
      className={`relative hidden flex-col gap-6 overflow-hidden rounded-[24px] bg-ink p-9 text-white lg:flex xl:p-10 ${className ?? ''}`}
      style={{ '--px': 0, '--py': 0 } as CSSProperties}
    >
      {/* Background: the logo's plane, large and faint, drifting the other way */}
      <svg aria-hidden className="dispatch-lean pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] opacity-[0.07]" style={leanStyle(-16, -12)} viewBox="0 0 24 24" fill="none" stroke="#7FE0C3" strokeWidth="0.6">
        <path d="M4 12l16-8-6 16-3-7-7-1z" />
      </svg>

      {headline && <div className="relative flex flex-col gap-4">
        <h2 className="max-w-xl text-[28px] font-semibold leading-tight tracking-[-0.025em]">
          <span className="block text-balance">Message every traveller from your own name.</span>
          <RotatingLine reduced={reduced} />
        </h2>
        <p className="max-w-md text-[15px] leading-relaxed text-white/65 [@media(max-height:800px)]:hidden">
          Trip reminders, payment follow-ups, quotes and birthday wishes, by email and WhatsApp, with every bounce and unsubscribe handled for you.
        </p>
      </div>}

      {/* The map */}
      <div ref={mapBox} className="relative min-h-[150px] flex-1 [@media(max-height:620px)]:hidden" aria-hidden>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: mapWidth, height: (mapWidth * VIEW.h) / VIEW.w }}>
          <div className="dispatch-lean absolute inset-0" style={leanStyle(8, 6)}>
            <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <pattern id="dispatch-dots" width="14" height="14" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.8" fill="white" fillOpacity="0.07" />
                </pattern>
                <radialGradient id="dispatch-fade" cx="50%" cy="55%" r="60%">
                  <stop offset="0.55" stopColor="white" />
                  <stop offset="1" stopColor="white" stopOpacity="0" />
                </radialGradient>
                <mask id="dispatch-mask">
                  <rect x="-40" y="-40" width={VIEW.w + 80} height={VIEW.h + 80} fill="url(#dispatch-fade)" />
                </mask>
              </defs>
              <rect x="-40" y="-40" width={VIEW.w + 80} height={VIEW.h + 80} fill="url(#dispatch-dots)" mask="url(#dispatch-mask)" />

              {/* Every route, faint; the hovered one, bright */}
              {PLACES.map((p) => (
                <path
                  key={p.key}
                  d={route(OFFICE, p).d}
                  fill="none"
                  stroke="#7FE0C3"
                  strokeWidth={hover === p.key ? 1.4 : 1}
                  strokeOpacity={hover === p.key ? 0.8 : 0.13}
                  strokeDasharray="2 5"
                  strokeLinecap="round"
                  className="transition-[stroke-opacity] duration-300"
                />
              ))}

              {/* The office */}
              <circle cx={OFFICE.x} cy={OFFICE.y} r={6} fill="#7FE0C3" fillOpacity={0.35} className="dispatch-beacon" />
              <circle cx={OFFICE.x} cy={OFFICE.y} r={5.5} fill="#111816" stroke="#7FE0C3" strokeWidth={1.6} />
              <circle cx={OFFICE.x} cy={OFFICE.y} r={2} fill="#7FE0C3" />
              <text x={OFFICE.x + 10} y={OFFICE.y + 4} fontSize={11} fontWeight={600} fill="white" fillOpacity={0.85}>
                Your office
              </text>

              {ripples.map((r) => (
                <circle key={r.id} cx={PLACE[r.place]!.x} cy={PLACE[r.place]!.y} r={5} fill="none" stroke="#7FE0C3" strokeWidth={1.4} className="dispatch-ripple" />
              ))}

              {PLACES.map((p) => {
                const on = hover === p.key || shown?.msg.place === p.key;
                return (
                  <g key={p.key} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)} className="cursor-default">
                    <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                    <circle cx={p.x} cy={p.y} r={on ? 4.5 : 3.5} fill={on ? '#7FE0C3' : 'white'} fillOpacity={on ? 1 : 0.55} className="transition-all duration-300" />
                    <text x={p.x} y={p.y + 17} textAnchor="middle" fontSize={10.5} fill="white" fillOpacity={on ? 0.95 : 0.5} className="transition-[fill-opacity] duration-300 select-none">
                      {p.label}
                    </text>
                  </g>
                );
              })}

              {flights.map((f) => (
                <Flight key={f.id} to={PLACE[f.place]!} onLand={() => land(f.id, MESSAGES[f.id % MESSAGES.length]!)} />
              ))}
            </svg>

            {/* What just landed, or what's under the pointer */}
            {shown && shownPlace && (
              <div
                key={`${shown.id}-${shown.msg.place}`}
                className="dispatch-bubble pointer-events-none absolute z-10 w-max"
                style={{
                  left: `${(shownPlace.x / VIEW.w) * 100}%`,
                  top: `${(shownPlace.y / VIEW.h) * 100}%`,
                  ['--bx' as string]: shownPlace.x > 300 ? '-88%' : shownPlace.x < 110 ? '-12%' : '-50%',
                  ['--by' as string]: shownPlace.y < 70 ? '26px' : 'calc(-100% - 14px)',
                }}
              >
                <div className={`flex max-w-[230px] items-start gap-2.5 rounded-[12px] px-3 py-2.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)] ${shown.msg.channel === 'whatsapp' ? 'rounded-tl-[4px] bg-[#1d3a31]' : 'bg-white text-ink'}`}>
                  <ChannelIcon channel={shown.msg.channel} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${shown.msg.channel === 'whatsapp' ? 'text-accent-ring' : 'text-accent'}`} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-medium leading-snug">{shown.msg.text}</span>
                    <span className={`text-[11px] ${shown.msg.channel === 'whatsapp' ? 'text-white/55' : 'text-muted'}`}>
                      {shown.msg.count ? `To ${shown.msg.count} travellers` : `To ${shown.msg.to}`}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The queue */}
      <div className="relative flex flex-col gap-2.5 rounded-[18px] bg-white/[0.06] p-4 ring-1 ring-white/10">
        <div className="flex items-baseline justify-between px-1">
          <span className="flex items-center gap-2 text-[13px] font-medium text-white/60">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="dispatch-live absolute inset-0 rounded-full bg-accent-ring" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent-ring" />
            </span>
            Going out today
          </span>
          <span className="flex items-baseline gap-1 text-[13px] text-white/55">
            <span className="font-semibold text-white">
              <Odometer value={sent} />
            </span>
            sent
          </span>
        </div>
        <div className="relative overflow-hidden" style={{ height: ROWS * ROW_STEP - 8 }}>
          {feed.map((item, i) => (
            <div
              key={item.id}
              onPointerEnter={() => setHover(item.msg.place)}
              onPointerLeave={() => setHover(null)}
              className="absolute inset-x-0 top-0 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
              style={{ transform: `translateY(${i * ROW_STEP}px)`, opacity: i < ROWS ? 1 : 0 }}
            >
              <div
                className={`dispatch-row flex h-14 items-center gap-3 rounded-[12px] px-3.5 transition-colors duration-200 ${hover === item.msg.place ? 'bg-white/[0.11]' : 'bg-white/[0.05]'}`}
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] ${item.msg.channel === 'whatsapp' ? 'bg-accent-ring/15 text-accent-ring' : 'bg-white/10 text-white/80'}`}>
                  <ChannelIcon channel={item.msg.channel} className="h-3.5 w-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{item.msg.text}</span>
                  <span className="truncate text-xs text-white/55">
                    {item.msg.count ? `To ${item.msg.count} travellers` : `To ${item.msg.to}`}, {PLACE[item.msg.place]!.label}
                  </span>
                </span>
                <StatusChip item={item} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
