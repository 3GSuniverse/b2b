import { useEffect, useLayoutEffect, useRef, useState, type DependencyList } from 'react';
import { pct } from './format';

/**
 * Small motion helpers shared across the app. Everything here respects the visitor's
 * "reduce motion" setting: numbers land on their value at once, nothing slides.
 */

const reducedQuery = () => (typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)'));

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => !!reducedQuery()?.matches);
  useEffect(() => {
    const mq = reducedQuery();
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export const prefersReducedMotion = () => !!reducedQuery()?.matches;

/** False on the first frame, true after: lets bars and rings grow from zero instead of appearing full. */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    return () => cancelAnimationFrame(raf);
  }, []);
  return mounted;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A number that counts toward its target: from zero the first time, from where it was after that. */
export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = a + (target - a) * easeOut(t);
      setValue(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/** Shows a number counting up to `value`, formatted the same way the final number is. */
export function CountUp({ value, format, decimals = 0, step, duration }: { value: number; format?: (v: number) => string; decimals?: number; step?: number; duration?: number }) {
  const v = useCountUp(value, duration);
  // `step` keeps the in-between numbers round (whole rupees while counting paise); the last one is exact
  const shown = Math.abs(v - value) < 0.5 ? value : step ? Math.round(v / step) * step : decimals ? Number(v.toFixed(decimals)) : Math.round(v);
  return (
    <span className="tnum">
      <span aria-hidden>{format ? format(shown) : shown.toLocaleString('en-IN')}</span>
      <span className="sr-only">{format ? format(value) : value.toLocaleString('en-IN')}</span>
    </span>
  );
}

/**
 * Measures the selected item inside a container, for a highlight that slides between items
 * (tabs, the segmented switch, the sidebar). The first position is placed without sliding.
 */
export function useSlidingIndicator<T extends HTMLElement>(selector: string, axis: 'x' | 'y', deps: DependencyList) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ offset: number; size: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector);
      setBox(el ? (axis === 'x' ? { offset: el.offsetLeft, size: el.offsetWidth } : { offset: el.offsetTop, size: el.offsetHeight }) : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
    // The caller says when the selection changes
  }, deps);
  useEffect(() => {
    if (!box || animate) return;
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(raf);
  }, [box, animate]);
  return { ref, box, animate };
}

export const SPRING = 'cubic-bezier(0.22, 1.2, 0.36, 1)';
export const SMOOTH = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Plays a short keyframe animation on an element without re-rendering or remounting it. */
export function play(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  if (!el || prefersReducedMotion() || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate(keyframes, options);
}

/** A percentage that counts up and lands on exactly what pct() shows. */
export function CountPercent({ value, duration = 1100 }: { value: number | null | undefined; duration?: number }) {
  const v = value ?? 0;
  return <CountUp value={v} decimals={v % 1 !== 0 ? 1 : 0} format={(x) => pct(x)} duration={duration} />;
}
