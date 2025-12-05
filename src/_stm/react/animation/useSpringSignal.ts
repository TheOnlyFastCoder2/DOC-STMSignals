import { useRef } from 'react';
import { useWatch, type TRSignal } from '../react';

export default function useSpringSignal(
  source: TRSignal<any>,
  signal: TRSignal<any>,
  { stiffness = 170, damping = 26, precision = 0.001 } = {}
) {
  const velRef = useRef<number | number[]>(0);
  const rafRef = useRef<number | null>(null);

  const isArray = (v: any): v is number[] => Array.isArray(v);
  const clone = (v: any) => (isArray(v) ? [...v] : v);

  const step = (dt: number) => {
    const from = signal.v;
    const to = source.v;

    // ---- массив ----
    if (isArray(from) && isArray(to)) {
      const n = Math.min(from.length, to.length);
      if (!isArray(velRef.current)) velRef.current = new Array(n).fill(0);
      let stillMoving = false;
      const next = [...from];

      for (let i = 0; i < n; i++) {
        const disp = to[i] - from[i];
        const acc = stiffness * disp - damping * (velRef.current[i] ?? 0);
        velRef.current[i] += acc * dt;
        next[i] += velRef.current[i] * dt;
        if (Math.abs(disp) > precision || Math.abs(velRef.current[i]) > precision) stillMoving = true;
        else velRef.current[i] = 0;
      }

      signal.v = next;
      if (stillMoving) rafRef.current = requestAnimationFrame(() => step(1 / 60));
      else signal.v = clone(to);
      return;
    }

    // ---- число ----
    if (typeof from === 'number' && typeof to === 'number') {
      const disp = to - from;
      const acc = stiffness * disp - damping * (velRef.current as number);
      velRef.current = (velRef.current as number) + acc * dt;
      const next = from + (velRef.current as number) * dt;
      signal.v = next;

      if (Math.abs(disp) > precision || Math.abs(velRef.current as number) > precision)
        rafRef.current = requestAnimationFrame(() => step(1 / 60));
      else {
        signal.v = to;
        velRef.current = 0;
      }
      return;
    }

    // fallback
    signal.v = clone(to);
  };

  useWatch(() => {
    const to = source.v;
    if (!(typeof to === 'number' || Array.isArray(to))) {
      signal.v = Array.isArray(to) ? [...to] : to;
      return;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => step(1 / 60));
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  });

  return signal;
}
