import { prefersReducedMotion } from './motion';

/**
 * Two small moments for the things that matter most in a travel agency's day.
 *   takeoff(): a paper plane leaves from the button that sent something and flies off the screen.
 *   burst():   a ring of sparks around something that just succeeded, like a recorded payment.
 * Both draw outside React, clean up after themselves, and do nothing when motion is reduced.
 */

const PLANE = 'M4 12l16-8-6 16-3-7-7-1z';
const SVG_NS = 'http://www.w3.org/2000/svg';

function layer() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:80;overflow:hidden';
  document.body.appendChild(el);
  return el;
}

function centerOf(from?: Element | null) {
  const r = from?.getBoundingClientRect();
  if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.6 };
}

/** The last element the person clicked, so callers in onSuccess don't have to pass it. */
let lastPointer: Element | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPointer = (e.target as Element)?.closest('button,a') ?? null), { capture: true, passive: true });
}

export function takeoff(from?: Element | null) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const start = centerOf(from ?? lastPointer);
  const host = layer();
  const end = { x: window.innerWidth + 80, y: -80 };
  // A curve that dips first, as if gathering speed, then climbs away to the top right
  const c1 = { x: start.x + (end.x - start.x) * 0.25, y: start.y + 40 };
  const c2 = { x: start.x + (end.x - start.x) * 0.6, y: start.y - (start.y - end.y) * 0.2 };
  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x,
      y: u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y,
    };
  };

  // The trail
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(window.innerWidth));
  svg.setAttribute('height', String(window.innerHeight));
  svg.style.cssText = 'position:absolute;inset:0;overflow:visible';
  const trail = document.createElementNS(SVG_NS, 'path');
  trail.setAttribute('d', `M${start.x} ${start.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`);
  trail.setAttribute('fill', 'none');
  trail.setAttribute('stroke', '#4a3fd1');
  trail.setAttribute('stroke-width', '2');
  trail.setAttribute('stroke-linecap', 'round');
  trail.setAttribute('stroke-opacity', '0.5');
  trail.setAttribute('pathLength', '1');
  trail.setAttribute('stroke-dasharray', '1');
  trail.setAttribute('stroke-dashoffset', '1');
  svg.appendChild(trail);
  host.appendChild(svg);

  // The plane
  const plane = document.createElement('div');
  plane.style.cssText = 'position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;display:grid;place-items:center;border-radius:13px;background:#1d1a4d;box-shadow:0 12px 32px -8px rgb(29 26 77 / .45)';
  plane.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF8A1F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${PLANE}"/></svg>`;
  host.appendChild(plane);

  const steps = 24;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = at(t);
    const q = at(Math.min(1, t + 0.01));
    const angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI + 45;
    const scale = t < 0.12 ? 0.4 + (t / 0.12) * 0.75 : 1.15 - t * 0.45;
    frames.push({ transform: `translate(${p.x}px, ${p.y}px) rotate(${angle}deg) scale(${scale})`, opacity: t > 0.85 ? (1 - t) / 0.15 : 1, offset: t });
  }
  const flight = plane.animate(frames, { duration: 1300, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' });
  trail.animate(
    [
      { strokeDashoffset: 1, opacity: 1 },
      { strokeDashoffset: 0, opacity: 1, offset: 0.7 },
      { strokeDashoffset: 0, opacity: 0 },
    ],
    { duration: 1600, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
  );
  flight.finished.finally(() => setTimeout(() => host.remove(), 400));
}

export function burst(from?: Element | null, color = '#0e9466') {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const { x, y } = centerOf(from ?? lastPointer);
  const host = layer();
  const ring = document.createElement('div');
  ring.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:999px;border:2px solid ${color}`;
  host.appendChild(ring);
  ring.animate([{ transform: 'scale(0.6)', opacity: 0.9 }, { transform: 'scale(4.5)', opacity: 0 }], { duration: 700, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' });
  const count = 16;
  const colors = [color, '#ff8a1f', '#4a3fd1'];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const dist = 56 + Math.random() * 44;
    const dot = document.createElement('div');
    const size = 5 + Math.round(Math.random() * 4);
    dot.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;margin:-${size / 2}px 0 0 -${size / 2}px;border-radius:${i % 3 ? '999px' : '2px'};background:${colors[i % colors.length]}`;
    host.appendChild(dot);
    dot.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist + 10}px) scale(0.4) rotate(${Math.random() * 180}deg)`, opacity: 0 },
      ],
      { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'forwards' },
    );
  }
  setTimeout(() => host.remove(), 1100);
}
