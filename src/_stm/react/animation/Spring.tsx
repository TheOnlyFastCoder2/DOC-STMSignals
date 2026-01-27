'use client';

import React, { useEffect, useImperativeHandle, useLayoutEffect, useState } from 'react';
import { useSignal, useWatch } from '../react';

import useSpringSignal from './useSpringSignal';
import useVisibilitySignal, { type VisibleSignalState } from './useVisibilitySignal';
import { batch, untracked } from '../../index';
import { requestDomCommit } from './domBatcher';
import { DeepSignal } from '../../signalMap';

type SpringPhase = 'default' | 'active';
type VisibilityMode = 'gate' | 'progress';
type TransformStyleValue = 'flat' | 'preserve-3d';

type ReactiveLike<T> = { readonly v: T };

type SpringPropConfig = {
  values?: Partial<Record<SpringPhase, any>>;
  stiffness?: number;
  damping?: number;
  isMobile?: boolean;

  isActive?: ReactiveLike<boolean>;
  phase?: ReactiveLike<SpringPhase>;

  delay?: number | (() => number);
  onProgress?: (phase: SpringPhase, progress: number, el: HTMLDivElement | null) => void;
  speed?: number;
};

type DelayState = {
  timers: Record<string, any>;
  tokens: Record<string, number>;
  planned: Record<string, any>;
};

const initConfig = {
  scale: 1,
  rotate: 0,
  depth: 0,
  opacity: 1,
  boxShadow: 0,
  translateY: 0,
  translateX: 0,
  shadowColor: [0, 0, 0, 0],
  rotateY: 0,
  rotateX: 0,
  transformStyle: 'flat' as TransformStyleValue,
};

export type SpringHandle = {
  st: DeepSignal<typeof initConfig, 'deep'>;
  el: HTMLDivElement | null;
};

export interface SpringProps {
  children?: React.ReactNode;

  spring?: Partial<Record<keyof typeof initConfig, SpringPropConfig>>;
  isActive?: ReactiveLike<boolean>;

  visibility?: Parameters<typeof useVisibilitySignal>[0];
  visibilityMode?: VisibilityMode;

  isOne?: boolean;
  className?: string;
  classInner?: string;

  coverThreshold?: number;
  onCoverChange?: (covered: boolean, index: number) => void;

  refSpring?: React.RefObject<SpringHandle | null>;

  index?: number;
  total?: number;

  is3D?: boolean;
  transformOrigin?: string | [number, number] | [number, number, number];
  perspectiveOrigin?: string | [number, number];
  perspective?: number | string;

  refImpVisible?: React.RefObject<Partial<VisibleSignalState>>;
  ref?: React.RefObject<HTMLDivElement | HTMLElement | null>;

  onPhaseSettled?: (phase: SpringPhase, progress: number, el: HTMLDivElement | null) => void;
  onPhaseProgress?: (phase: SpringPhase, progress: number, el: HTMLDivElement | null) => void;

  settleKey?: keyof typeof initConfig;
  style?: React.CSSProperties;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const cssLen = (v: any, fallbackUnit = 'px') => {
  if (typeof v === 'number') return `${v}${fallbackUnit}`;
  if (typeof v === 'string') return v;
  return `${Number(v) || 0}${fallbackUnit}`;
};

const cssNum = (v: any) => {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return String(parseFloat(v) || 0);
  return String(Number(v) || 0);
};

const resolveValue = (x: any) => {
  if (typeof x === 'function') return x();
  if (x && typeof x === 'object' && 'v' in x) return (x as any).v;
  return x;
};

const getDelayMs = (cfg?: SpringPropConfig) => {
  if (!cfg?.delay) return 0;
  return typeof cfg.delay === 'function' ? cfg.delay() : cfg.delay;
};

type Unit = 'px' | '%' | 'vw' | 'vh' | 'em' | 'rem';
type UnitValue = { n: number; unit: Unit };

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

function mixValue(a: any, b: any, t: number) {
  const p = clamp01(t);

  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((av, i) => mixValue(av, b[i], p));
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * p;
  }

  const au = parseUnitValue(a);
  const bu = parseUnitValue(b);
  if (au || bu) {
    const unit = (bu?.unit ?? au?.unit ?? 'px') as Unit;
    const an = au?.n ?? (typeof a === 'number' ? a : Number.parseFloat(String(a)) || 0);
    const bn = bu?.n ?? (typeof b === 'number' ? b : Number.parseFloat(String(b)) || 0);
    return formatUnitValue(an + (bn - an) * p, unit);
  }

  return p >= 1 ? b : a;
}

const setPhase = (
  basePhase: SpringPhase,
  st: Record<string, any>,
  spring?: Partial<Record<keyof typeof initConfig, SpringPropConfig>>,
  delayState?: DelayState,
  isTouch?: boolean
) => {
  const has = Object.prototype.hasOwnProperty;

  batch(() => {
    for (const key in initConfig) {
      const cfg = (spring as any)?.[key] as SpringPropConfig | undefined;
      if (!cfg) continue;

      if (isTouch && cfg.isMobile === false) continue;
      if (!isTouch && cfg.isMobile === true) continue;

      let phase: SpringPhase = basePhase;
      if (cfg.phase) phase = cfg.phase.v;
      else if (cfg.isActive) phase = cfg.isActive.v ? 'active' : 'default';

      const vals = cfg.values ?? {};

      let nextValue: any;
      if (has.call(vals, phase)) nextValue = (vals as any)[phase];
      else if (has.call(vals, 'default')) nextValue = (vals as any).default;
      else nextValue = (initConfig as any)[key];

      const d = getDelayMs(cfg);
      const resolvedNow = resolveValue(nextValue);

      if (delayState && d > 0) {
        if (Object.is(delayState.planned[key], resolvedNow) && delayState.timers[key]) continue;

        if (delayState.timers[key]) {
          clearTimeout(delayState.timers[key]);
          delete delayState.timers[key];
        }

        const tok = (delayState.tokens[key] ?? 0) + 1;
        delayState.tokens[key] = tok;
        delayState.planned[key] = resolvedNow;

        delayState.timers[key] = setTimeout(() => {
          if (delayState.tokens[key] !== tok) return;

          st[key].v = resolveValue(nextValue);

          delete delayState.timers[key];
        }, d);

        continue;
      }

      if (delayState?.timers[key]) {
        clearTimeout(delayState.timers[key]);
        delete delayState.timers[key];
      }

      if (delayState) delayState.planned[key] = resolvedNow;

      if (!Object.is(st[key].v, resolvedNow)) {
        st[key].v = resolvedNow;
      }
    }
  });
};

const initParams: Parameters<typeof useVisibilitySignal>[0] = {
  enterAt: [[0, 1]],
};

export function Spring({
  children,
  spring,
  isActive,
  visibility,
  visibilityMode = 'gate',

  className = '',
  classInner = '',

  index = 1,
  total = 0,
  coverThreshold = 0.35,
  onCoverChange,
  onPhaseSettled,
  refImpVisible,
  settleKey,
  isOne,
  ref,
  refSpring,
  onPhaseProgress,
  style,
  is3D = false,
  transformOrigin = [50, 50],
  perspective = 1000,
  perspectiveOrigin = [50, 50],
  ...props
}: SpringProps) {
  const elRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);

  const vis = useVisibilitySignal<HTMLDivElement>(visibility ?? initParams, elRef);

  const delayStateRef = React.useRef<DelayState>({
    timers: {},
    tokens: {},
    planned: {},
  });

  const modeRef = React.useRef<VisibilityMode>(visibilityMode);
  modeRef.current = visibilityMode;

  const phaseRef = React.useRef<SpringPhase>('default');
  const settledPhaseRef = React.useRef<SpringPhase | null>(null);

  const st: Record<string, any> = {};
  for (const key in initConfig) {
    st[key] = useSignal((spring as any)?.[key]?.values?.default ?? (initConfig as any)[key]);
  }
  st.wasVisibleOnce = useSignal(false);

  const [isTouch, setIsTouch] = useState(false);

  useImperativeHandle(refImpVisible, () => ({
    ...(vis ? vis : {}),
  }));

  useEffect(() => {
    const media = window.matchMedia('(hover: hover)');
    const update = () => setIsTouch(!media.matches);
    update();
    media.addEventListener('change', update);

    return () => {
      media.removeEventListener('change', update);
      const ds = delayStateRef.current;
      for (const k in ds.timers) clearTimeout(ds.timers[k]);
      ds.timers = {};
    };
  }, []);

  const applyPhase = (p: SpringPhase) => {
    setPhase(p, st, spring, delayStateRef.current, isTouch);
  };

  const dirtyRef = React.useRef(false);
  const commitImplRef = React.useRef<() => void>(() => {});

  const commitStable = React.useCallback(() => {
    commitImplRef.current();
  }, []);

  const scheduleCommit = React.useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    requestDomCommit(commitStable);
  }, [commitStable]);

  const settleKeyResolved = (settleKey ?? 'opacity') as keyof typeof initConfig;

  const springSignals: Record<string, any> = {};
  for (const key in st) {
    const cfg = (spring as any)?.[key] as SpringPropConfig | undefined;

    const stiffness = cfg?.stiffness ?? 160;
    const damping = cfg?.damping ?? 18;
    const speed = cfg?.speed ?? 1;

    const vals = cfg?.values ?? {};
    const hasActive = Object.prototype.hasOwnProperty.call(vals, 'active');

    const userOnProgress = cfg?.onProgress;
    const isSettleKey = key === settleKeyResolved;

    springSignals[key] = useSpringSignal(st[key], {
      stiffness,
      damping,
      enabled: !!cfg && !(visibilityMode === 'progress' && hasActive),
      speed,
      onTick: scheduleCommit,

      onProgress:
        userOnProgress || isSettleKey
          ? (_value, percent) => {
              const el = elRef.current;
              const ph = phaseRef.current;

              userOnProgress?.(ph, percent, el);

              if (!isSettleKey) return;
              if (modeRef.current !== 'gate') return;

              onPhaseProgress?.(ph, percent, el);

              const eps = 0.001;
              if (percent >= 1 - eps) {
                if (settledPhaseRef.current !== ph) {
                  settledPhaseRef.current = ph;
                  onPhaseSettled?.(ph, 1, el);
                }
              }
            }
          : undefined,
    });
  }

  commitImplRef.current = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;

    const el = elRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;

    untracked(() => {
      const has = (k: keyof typeof initConfig) =>
        !!spring && Object.prototype.hasOwnProperty.call(spring, k);

      const needTransform =
        has('scale') ||
        has('rotate') ||
        has('depth') ||
        has('translateX') ||
        has('translateY') ||
        has('rotateY') ||
        has('rotateX');

      if (needTransform) {
        const s = springSignals.scale.v;
        const r = springSignals.rotate.v;
        const z = springSignals.depth.v;
        const x = springSignals.translateX.v;
        const y = springSignals.translateY.v;
        const ry = springSignals.rotateY.v;
        const rx = springSignals.rotateX.v;

        inner.style.willChange = 'transform, opacity';

        if (has('transformStyle')) {
          inner.style.transformStyle = springSignals.transformStyle.v;
        }

        const is3DResolved = is3D === true;

        if (is3DResolved && perspective) {
          el.style.perspective = cssLen(perspective);
          el.style.perspectiveOrigin = perspectiveOrigin
            ? Array.isArray(perspectiveOrigin)
              ? `${perspectiveOrigin[0]}% ${perspectiveOrigin[1]}%`
              : perspectiveOrigin
            : '50% 50%';
        } else {
          el.style.perspective = '';
          el.style.perspectiveOrigin = '';
        }

        inner.style.transformStyle = is3DResolved ? 'preserve-3d' : 'flat';

        inner.style.transformOrigin = transformOrigin
          ? Array.isArray(transformOrigin)
            ? `${transformOrigin[0]}% ${transformOrigin[1]}%`
            : transformOrigin
          : 'center';

        inner.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg) scale(${cssNum(
          s
        )}) rotate(${r}deg) translate3d(${cssLen(x)},${cssLen(y)},${cssLen(z)})`;
      }

      if (has('opacity')) {
        inner.style.opacity = Number(springSignals.opacity.v).toFixed(3);
      }

      if (has('boxShadow') || has('shadowColor') || has('depth')) {
        const z = Number(springSignals.depth.v) || 0;
        const sh = Number(springSignals.boxShadow.v) || 0;
        const colorArr = springSignals.shadowColor.v as number[];

        const color = `rgba(${colorArr[0]}, ${colorArr[1]}, ${colorArr[2]}, ${(
          colorArr[3] ?? 0
        ).toFixed(2)})`;

        inner.style.boxShadow = `0 ${z + sh}px ${(z + sh) * 3}px ${color}`;
      }
    });
  };

  useLayoutEffect(() => {
    dirtyRef.current = true;
    commitImplRef.current();
  }, []);

  useWatch(() => {
    if (spring) {
      for (const key in spring) {
        const cfg = (spring as any)[key] as SpringPropConfig | undefined;
        cfg?.isActive?.v;
        cfg?.phase?.v;
      }
    }

    const userActive = isActive ? !!isActive.v : true;

    if (visibilityMode === 'progress') {
      const el = elRef.current;
      const pLinear = userActive ? clamp01(vis?.progress?.v ?? 0) : 0;
      const p = 1 - Math.abs(pLinear * 2 - 1);
      const phaseForCb: SpringPhase = p > 0.001 ? 'active' : 'default';

      const ds = delayStateRef.current;
      if (Object.keys(ds.timers).length) {
        for (const k in ds.timers) clearTimeout(ds.timers[k]);
        ds.timers = {};
      }

      batch(() => {
        for (const key in initConfig) {
          const cfg = (spring as any)?.[key] as SpringPropConfig | undefined;
          if (!cfg) continue;

          if (isTouch && cfg.isMobile === false) continue;
          if (!isTouch && cfg.isMobile === true) continue;

          const vals = cfg.values ?? {};
          if (!Object.prototype.hasOwnProperty.call(vals, 'active')) continue;

          const a = Object.prototype.hasOwnProperty.call(vals, 'default')
            ? (vals as any).default
            : (initConfig as any)[key];

          const b = Object.prototype.hasOwnProperty.call(vals, 'active') ? (vals as any).active : a;

          st[key].v = mixValue(a, b, p);
          cfg.onProgress?.(phaseForCb, p, el);
        }
      });

      onPhaseProgress?.('active', p, el);

      const eps = 0.001;
      if (p >= 1 - eps) onPhaseSettled?.('active', 1, el);
      if (p <= eps) onPhaseSettled?.('default', 1, el);

      const phase: SpringPhase = p > eps ? 'active' : 'default';
      phaseRef.current = phase;
      settledPhaseRef.current = null;
      return;
    }

    let isVisible = true;
    let covered = false;

    if (vis) {
      const v = vis.visible.v;
      const overlap = vis.overlap.v;
      isVisible = v;

      if ((!isOne || !st.wasVisibleOnce.v) && v) st.wasVisibleOnce.v = true;
      if (isOne && st.wasVisibleOnce.v && !v) return;

      if (st.wasVisibleOnce.v) {
        const isLast = index === total;
        const hide = isLast ? 0 : Math.min(1, overlap * 2);
        covered = !isLast && hide > coverThreshold;
        onCoverChange?.(covered, index);
      } else {
        covered = false;
      }
    }

    const enabled = userActive && isVisible;
    const phase: SpringPhase = enabled ? 'active' : 'default';

    if (phaseRef.current !== phase) {
      phaseRef.current = phase;
      settledPhaseRef.current = null;
    }

    applyPhase(phase);
  });

  useImperativeHandle(refSpring, () => ({
    st: st as SpringHandle['st'],
    el: elRef.current,
  }));

  return (
    <div
      className={className}
      style={style}
      {...props}
      ref={(el) => {
        elRef.current = el;
        if (el) el.style.willChange = 'transform';
        if (ref) ref.current = el;
      }}
    >
      <div className={classInner} ref={innerRef}>
        {children}
      </div>
    </div>
  );
}
