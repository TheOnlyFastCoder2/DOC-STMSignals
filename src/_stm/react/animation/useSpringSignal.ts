import { useEffect, useRef } from 'react';
import { useSignal, useWatch, type TRSignal } from '../react';
import { startSpring, isSpringRunning } from './springTicker';

type Unit = 'px' | '%' | 'vw' | 'vh' | 'em' | 'rem';
type UnitValue = { n: number; unit: Unit };

type Stepper = (dt: number) => boolean;
type EnabledLike = boolean | { readonly v: boolean };

const readEnabled = (e: EnabledLike | undefined) => {
  if (typeof e === 'object' && e) return !!e.v;
  return e !== false;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function parseUnitValue(v: any): UnitValue | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)(px|%|vw|vh|em|rem)$/i);
  if (!m) return null;
  return { n: Number(m[1]), unit: m[2].toLowerCase() as Unit };
}

function formatUnitValue(n: number, unit: Unit) {
  const rounded = Math.abs(n) < 1e-8 ? 0 : +n.toFixed(5);
  return `${rounded}${unit}`;
}

function numOf(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  if (typeof v === 'string') {
    const u = parseUnitValue(v);
    if (u) return u.n;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function dist(a: any, b: any): number | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;

    let sum = 0;
    for (let i = 0; i < n; i++) {
      const da = numOf(a[i]);
      const db = numOf(b[i]);
      if (da == null || db == null) return null;
      const d = da - db;
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  const na = numOf(a);
  const nb = numOf(b);
  if (na == null || nb == null) return null;

  return Math.abs(na - nb);
}

function calcProgress(cur: any, start: any, target: any): number {
  const denom = dist(start, target);
  const d = dist(cur, target);

  if (denom == null || d == null) return 0;
  if (denom < 1e-8) return 1;

  const p = 1 - d / denom;
  return clamp01(p);
}

export default function useSpringSignal(
  source: TRSignal<any>,

  {
    stiffness = 170,
    damping = 26,
    precision = 0.001,
    onSettled,
    enabled = true,

    speed = 1,

    onTick,
    skipFirst = true,

    onProgress,
    monotonicProgress = true,
  }: {
    stiffness?: number;
    damping?: number;
    precision?: number;
    onSettled?: () => void;
    enabled?: EnabledLike;

    speed?: number;

    onTick?: () => void;
    skipFirst?: boolean;

    onProgress?: (value: any, percent: number) => void;
    monotonicProgress?: boolean;
  } = {}
) {
  const signal = useSignal(source.v);
  const velRef = useRef<number | number[]>(0);
  const stopRef = useRef<null | (() => void)>(null);
  const didInitRef = useRef(false);

  const arrBufRef = useRef<null | { a: number[]; b: number[]; flip: boolean; len: number }>(null);

  const startRef = useRef<any>(null);
  const targetRef = useRef<any>(null);
  const maxProgRef = useRef<number>(0);

  const optsRef = useRef({
    stiffness,
    damping,
    precision,
    onSettled,
    enabled,
    speed,
    onTick,
    skipFirst,
    onProgress,
    monotonicProgress,
  });

  optsRef.current = {
    stiffness,
    damping,
    precision,
    onSettled,
    enabled,
    speed,
    onTick,
    skipFirst,
    onProgress,
    monotonicProgress,
  };

  const isArray = (v: any): v is number[] => Array.isArray(v);
  const clone = (v: any) => (isArray(v) ? [...v] : v);

  function emitProgress(value: any) {
    const { onProgress, monotonicProgress } = optsRef.current;
    if (!onProgress) return;

    let p = calcProgress(value, startRef.current, targetRef.current);

    if (monotonicProgress) {
      if (p < maxProgRef.current) p = maxProgRef.current;
      else maxProgRef.current = p;
    }

    onProgress(value, p);
  }

  function emitProgressDone(value: any) {
    const { onProgress } = optsRef.current;
    if (!onProgress) return;
    maxProgRef.current = 1;
    onProgress(value, 1);
  }

  const stepperRef = useRef<Stepper | null>(null);

  if (!stepperRef.current) {
    stepperRef.current = (dt: number) => {
      const {
        stiffness,
        damping,
        precision,
        onSettled,
        enabled,
        speed: spRaw,
        onTick,
      } = optsRef.current;

      const enabledNow = readEnabled(enabled);

      const sp = Math.max(0.05, Math.min(12, spRaw || 1));
      const totalDt = dt * sp;

      const maxStep = 1 / 60;
      const steps = Math.max(1, Math.ceil(totalDt / maxStep));
      const h = totalDt / steps;

      if (!enabledNow) {
        stopRef.current?.();
        stopRef.current = null;

        velRef.current = 0;
        arrBufRef.current = null;

        signal.v = clone(source.v);
        onTick?.();

        emitProgressDone(signal.v);
        onSettled?.();
        return false;
      }

      const to = source.v;

      const toU = parseUnitValue(to);
      const ok = typeof to === 'number' || isArray(to) || !!toU;

      if (!ok) {
        signal.v = clone(to);
        velRef.current = 0;
        arrBufRef.current = null;
        onTick?.();

        emitProgressDone(signal.v);
        onSettled?.();
        return false;
      }

      if (isArray(to)) {
        let cur = signal.v;
        if (!isArray(cur)) cur = to;

        const curArr = cur as number[];
        const n = Math.min(curArr.length, to.length);

        if (!isArray(velRef.current) || (velRef.current as number[]).length !== n) {
          velRef.current = new Array(n).fill(0);
        }

        if (!arrBufRef.current || arrBufRef.current.len !== n) {
          arrBufRef.current = {
            a: curArr.slice(0, n),
            b: curArr.slice(0, n),
            flip: false,
            len: n,
          };
        }

        const buf = arrBufRef.current;
        let next = buf.flip ? buf.a : buf.b;
        buf.flip = !buf.flip;

        let stillMoving = false;
        const vel = velRef.current as number[];

        let curLocal = curArr;

        for (let s = 0; s < steps; s++) {
          if (s > 0) {
            next = buf.flip ? buf.a : buf.b;
            buf.flip = !buf.flip;
          }

          stillMoving = false;

          for (let i = 0; i < n; i++) {
            const v = vel[i] ?? 0;
            const disp = to[i] - curLocal[i];
            const acc = stiffness * disp - damping * v;

            const vNext = v + acc * h;
            vel[i] = vNext;

            const xNext = curLocal[i] + vNext * h;
            next[i] = xNext;

            if (Math.abs(disp) > precision || Math.abs(vNext) > precision) {
              stillMoving = true;
            } else {
              vel[i] = 0;
              next[i] = to[i];
            }
          }

          curLocal = next;
        }

        signal.v = next;
        onTick?.();
        emitProgress(signal.v);

        if (!stillMoving) {
          signal.v = clone(to);
          velRef.current = 0;
          arrBufRef.current = null;
          onTick?.();

          emitProgressDone(signal.v);
          onSettled?.();
          return false;
        }

        return true;
      }

      if (typeof signal.v === 'number' && typeof to === 'number') {
        let x = signal.v as number;
        let v = velRef.current as number;

        let stillMoving = false;

        for (let s = 0; s < steps; s++) {
          const disp = to - x;
          const acc = stiffness * disp - damping * v;

          v = v + acc * h;
          x = x + v * h;

          if (Math.abs(disp) > precision || Math.abs(v) > precision) stillMoving = true;
        }

        velRef.current = v;
        signal.v = x;
        onTick?.();
        emitProgress(signal.v);

        const disp = to - x;
        if (!stillMoving || (Math.abs(disp) <= precision && Math.abs(v) <= precision)) {
          signal.v = to;
          velRef.current = 0;
          onTick?.();

          emitProgressDone(signal.v);
          onSettled?.();
          return false;
        }

        return true;
      }

      const fromU = parseUnitValue(signal.v);
      const toU2 = parseUnitValue(to);

      if (fromU || toU2) {
        const unit = (toU2?.unit ?? fromU!.unit) as Unit;

        let curN =
          fromU?.n ??
          (typeof signal.v === 'number' ? signal.v : Number.parseFloat(String(signal.v)) || 0);

        const targetN =
          toU2?.n ?? (typeof to === 'number' ? to : Number.parseFloat(String(to)) || 0);

        let v = velRef.current as number;

        let stillMoving = false;

        for (let s = 0; s < steps; s++) {
          const disp = targetN - curN;
          const acc = stiffness * disp - damping * v;

          v = v + acc * h;
          curN = curN + v * h;

          if (Math.abs(disp) > precision || Math.abs(v) > precision) stillMoving = true;
        }

        velRef.current = v;
        signal.v = formatUnitValue(curN, unit);
        onTick?.();
        emitProgress(signal.v);

        const disp = targetN - curN;
        if (!stillMoving || (Math.abs(disp) <= precision && Math.abs(v) <= precision)) {
          signal.v = clone(to);
          velRef.current = 0;
          onTick?.();

          emitProgressDone(signal.v);
          onSettled?.();
          return false;
        }

        return true;
      }

      signal.v = clone(to);
      velRef.current = 0;
      arrBufRef.current = null;
      onTick?.();

      emitProgressDone(signal.v);
      onSettled?.();
      return false;
    };
  }

  useWatch(() => {
    const to = source.v;

    if (!didInitRef.current) {
      didInitRef.current = true;

      if (optsRef.current.skipFirst) {
        signal.v = clone(to);
        velRef.current = 0;
        arrBufRef.current = null;

        startRef.current = clone(signal.v);
        targetRef.current = clone(to);
        maxProgRef.current = 1;

        optsRef.current.onTick?.();
        optsRef.current.onProgress?.(signal.v, 1);
        return;
      }
    }

    const enabledNow = readEnabled(optsRef.current.enabled);
    const isUnit = !!parseUnitValue(to);
    const ok = typeof to === 'number' || Array.isArray(to) || isUnit;

    if (!ok || !enabledNow) {
      stopRef.current?.();
      stopRef.current = null;

      velRef.current = 0;
      arrBufRef.current = null;

      signal.v = clone(to);

      startRef.current = clone(signal.v);
      targetRef.current = clone(to);
      maxProgRef.current = 1;

      optsRef.current.onTick?.();
      optsRef.current.onProgress?.(signal.v, 1);

      optsRef.current.onSettled?.();

      return;
    }

    const fromUnit = parseUnitValue(signal.v);
    const toUnit = parseUnitValue(to);

    if (Array.isArray(to) && !Array.isArray(signal.v)) {
      signal.v = clone(to);
      velRef.current = new Array(to.length).fill(0);
      arrBufRef.current = null;
    } else if (typeof to === 'number') {
      if (typeof signal.v !== 'number' && !fromUnit) {
        signal.v = to;
        velRef.current = 0;
        arrBufRef.current = null;
      }
    } else if (toUnit) {
      const okCurrent = typeof signal.v === 'number' || typeof signal.v === 'string';
      if (!okCurrent) {
        signal.v = clone(to);
        velRef.current = 0;
        arrBufRef.current = null;
      }
    }

    startRef.current = clone(signal.v);
    targetRef.current = clone(to);
    maxProgRef.current = 0;

    if (!isSpringRunning(stepperRef.current!)) {
      stopRef.current?.();
      stopRef.current = startSpring(stepperRef.current!);
    }
  });

  useEffect(() => {
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, []);

  return signal;
}
