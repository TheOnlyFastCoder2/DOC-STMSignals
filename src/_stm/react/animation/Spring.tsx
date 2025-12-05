'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useSignal, useWatch } from '../react';
import useSpringSignal from './useSpringSignal';
import useVisibilitySignal, { ensureOverlay } from './useVisibilitySignal';
import { batch } from '../../index';

type SpringPhase = 'enter' | 'leave' | 'down' | 'up' | 'default' | 'active';
type TransformStyleValue = 'flat' | 'preserve-3d';
type Range = [number, number];
type RangeList = Range[];
type PhaseValue = any | [Range | RangeList, any][];

type SpringPropConfig = {
  values?: Partial<Record<SpringPhase, PhaseValue>>;
  stiffness?: number;
  damping?: number;
  isMobile?: boolean;
  debug?: number;
};

type ReactiveLike<T> = { readonly v: T };

const initConfig = {
  scale: 1,
  rotate: 0,
  depth: 0,
  opacity: 1,
  boxShadow: 0,
  translateY: 0,
  translateX: 0,
  shadowColor: [0, 0, 0, 0.3],
  perspective: 50,
  perspectiveOrigin: [50, 50],
  transformOrigin: 'center',
  rotateY: 0,
  rotateX: 0,
  transformStyle: 'flat' as TransformStyleValue,
  height: 0,
};

export interface SpringProps {
  children?: React.ReactNode;
  spring?: Partial<Record<keyof typeof initConfig, SpringPropConfig>>;
  triggers?: ('hover' | 'enter' | 'leave' | 'up' | 'down')[];
  isActive?: ReactiveLike<boolean>;
  visibility?: Parameters<typeof useVisibilitySignal>[0];
  className?: string;
  classInner?: string;
  moveShadow?: boolean;
  isMove?: boolean;
  coverThreshold?: number;
  phases?: SpringPhase[];
  onToggle?: (v?: boolean) => void;
  index?: number;
  total?: number;
}

function isRangeTupleArray(raw: any): raw is [Range | RangeList, any][] {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((item) => Array.isArray(item) && item.length === 2 && Array.isArray(item[0]))
  );
}

const setPhase = (
  phase: SpringPhase,
  st: Record<string, any>,
  spring?: Record<string, SpringPropConfig>,
  scrollRatio?: number // 0..1 — позиция якоря по вьюпорту
) => {
  const has = Object.prototype.hasOwnProperty;

  batch(() => {
    for (const key in st) {
      const cfg = spring?.[key];
      if (!cfg) continue;

      const vals = cfg.values ?? {};
      const phaseRaw = (vals as any)[phase];

      let next: any;

      // 1) продвинутый режим: [ [rangeOrRangeList, value], ... ]
      if (phaseRaw !== undefined && scrollRatio != null && isRangeTupleArray(phaseRaw)) {
        const r = Math.max(0, Math.min(1, scrollRatio)); // clamp 0..1

        outer: for (const [rangeConfig, value] of phaseRaw as [Range | RangeList, any][]) {
          let ranges: RangeList;

          // если передан один range: [0.2, 0.3]
          // превращаем в список: [[0.2, 0.3]]
          if (Array.isArray((rangeConfig as any)[0]) && typeof (rangeConfig as any)[0][0] === 'number') {
            ranges = rangeConfig as RangeList;
          } else {
            ranges = [rangeConfig as Range];
          }

          for (const [from, to] of ranges) {
            if (r >= from && r <= to) {
              next = value;
              break outer;
            }
          }
        }
      }

      // 2) если не нашли по диапазонам — пробуем обычное значение фазы
      if (next === undefined && has.call(vals, phase) && !isRangeTupleArray(phaseRaw)) {
        next = phaseRaw;
      }

      // 3) fallback на default
      if (next === undefined && has.call(vals, 'default')) {
        next = (vals as any).default;
      }

      // 4) fallback на initConfig
      if (next === undefined) {
        next = (initConfig as any)[key];
      }

      st[key].v = next;
    }
  });
};

export function Spring({
  children,
  spring,
  triggers = [],
  isActive,
  visibility,
  onToggle,
  className = '',
  classInner = '',
  isMove,
  moveShadow,
  phases,
  index = 1,
  total = 0,
  coverThreshold = 0.35,
}: SpringProps) {
  const elRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);
  const vis = visibility ? useVisibilitySignal<HTMLDivElement>(visibility, elRef) : null;
  const trig = useRef(new Set(triggers));

  const st: Record<string, any> = {};
  for (const key in initConfig) {
    st[key] = useSignal((spring as any)?.[key]?.values?.default ?? (initConfig as any)[key]);
  }
  st.isPressed = useSignal(false);
  st.wasVisibleOnce = useSignal(false);

  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (!spring) return;

    const ranges: RangeList = [];

    for (const key in spring) {
      const cfg = spring[key];
      if (!cfg || !cfg.debug) continue;

      const vals = cfg.values;
      if (!vals) continue;

      // можно смотреть только на active, или пройтись по всем фазам — я делаю по всем
      for (const phase of Object.keys(vals) as SpringPhase[]) {
        const phaseRaw = vals[phase];
        if (!Array.isArray(phaseRaw)) continue;

        for (const entry of phaseRaw as [Range | RangeList, any][]) {
          const [rangeConfig] = entry;

          // [[0.4, 0.8]] или [[0.1,0.2],[0.4,0.8]]
          if (Array.isArray(rangeConfig[0])) {
            ranges.push(...(rangeConfig as RangeList));
          } else {
            ranges.push(rangeConfig as Range);
          }
        }
      }
    }

    if (!ranges.length) return;

    // рисуем линии по этим диапазонам
    // exitAt — пустой; debug = true
    ensureOverlay(ranges, [], true);
  }, [spring]);

  useEffect(() => {
    const media = window.matchMedia('(hover: hover)');
    const update = () => setIsTouch(!media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const phaseHandler = (p: SpringPhase, pressed?: boolean) => {
    if (pressed !== undefined) st.isPressed.v = pressed;

    const scrollRatio = getAnchorRatio();

    setPhase(p, st, spring, scrollRatio);

    if (phases?.includes(p)) onToggle?.(p === 'enter' || p === 'down');
  };

  function getAnchorRatio() {
    if (typeof window === 'undefined') return undefined;
    const el = elRef.current;
    if (!el || !visibility) return undefined;

    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const height = rect.height || 1;

    const anchor: 'top' | 'center' | 'bottom' = visibility.isTop ? 'top' : visibility.isBottom ? 'bottom' : 'center';

    const anchorPos = anchor === 'top' ? rect.top : anchor === 'bottom' ? rect.bottom : rect.top + height / 2;

    return anchorPos / vh;
  }

  const handle = {
    down: (e: React.PointerEvent | React.MouseEvent | React.TouchEvent) => {
      if (!trig.current.has('down')) return;
      trySetPointerCapture(e, elRef.current);
      phaseHandler('down', true);
    },
    up: (e: React.PointerEvent | React.MouseEvent | React.TouchEvent) => {
      if (!trig.current.has('up')) return;
      tryReleasePointerCapture(e, elRef.current);
      phaseHandler('up', false);
    },
    enter: () => (trig.current.has('enter') || trig.current.has('hover')) && phaseHandler('enter'),
    leave: () => (trig.current.has('leave') || trig.current.has('hover')) && phaseHandler('leave'),
  };

  useWatch(() => {
    if (vis) {
      const visible = vis.visible.v;
      phaseHandler(visible ? 'active' : 'default', visible);
      if (visible) st.wasVisibleOnce.v = true;
    }
    if (isActive) {
      phaseHandler(isActive.v ? 'active' : 'default');
    }
  });

  useWatch(() => {
    if (!vis || !st.wasVisibleOnce.v) return;
    const el = vis.ref.current;
    if (!el) return;
    const isLast = index === total;
    const hide = isLast ? 0 : Math.min(1, vis.overlap.v * 2);
    const covered = !isLast && hide > coverThreshold;

    phaseHandler(covered || !vis.visible.v ? 'default' : 'active');
  });

  const springSignals: Record<string, any> = {};
  for (const key in st) {
    springSignals[key] = useSpringSignal(st[key], useSignal(st[key].v), {
      stiffness: (spring as any)?.[key]?.stiffness ?? 160,
      damping: (spring as any)?.[key]?.damping ?? 18,
    });
  }

  useWatch(() => {
    const el = elRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;

    const s = springSignals.scale.v;
    const r = springSignals.rotate.v;
    const z = springSignals.depth.v;
    const o = springSignals.opacity.v;
    const x = springSignals.translateX.v;
    const y = springSignals.translateY.v;
    const ry = springSignals.rotateY.v;
    const rx = springSignals.rotateX.v;
    const sh = springSignals.boxShadow.v;
    const po = springSignals.perspectiveOrigin.v;
    const colorArr = springSignals.shadowColor.v;
    const p = springSignals.perspective.v;
    const h = springSignals.height?.v;

    const color = `rgba(${colorArr[0]}, ${colorArr[1]}, ${colorArr[2]}, ${colorArr[3].toFixed(2)})`;
    const origin = Array.isArray(po) ? `${po[0]}% ${po[1]}%` : po;
    const tOrigin = Array.isArray(st.transformOrigin.v)
      ? `${st.transformOrigin.v[0]}% ${st.transformOrigin.v[1]}%`
      : st.transformOrigin.v;

    el.style.perspective = `${p}px`;
    el.style.perspectiveOrigin = origin;
    inner.style.transformStyle = springSignals.transformStyle.v;
    inner.style.transformOrigin = tOrigin;
    el.style.willChange = 'transform';

    inner.style.transform = `
      rotateY(${ry}deg)
      rotateX(${rx}deg)
      scale(${s})
      rotate(${r}deg)
      translate3d(${x}px, ${y}px, ${z}px)
    `;
    inner.style.opacity = o.toFixed(2);
    inner.style.boxShadow = `0 ${z + sh}px ${(z + sh) * 3}px ${color}`;
    if (typeof h === 'number' && h > 0) {
      inner.style.height = `${h}px`;
      inner.style.overflow = 'hidden';
    } else {
      inner.style.height = '';
      inner.style.overflow = '';
    }
  });

  useEffect(() => {
    const el = elRef.current;
    const inner = innerRef.current;

    if (!isMove || isTouch || !el || !inner) return;

    const controller = new AbortController();
    const { signal } = controller;

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const dy = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);

      st.rotateY.v = -dx * 12;
      st.rotateX.v = dy * 12;

      if (moveShadow) {
        inner.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        inner.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
      }
    };

    const reset = () => {
      st.rotateY.v = 0;
      st.rotateX.v = 0;

      if (moveShadow) {
        inner.style.setProperty('--mouse-x', `50%`);
        inner.style.setProperty('--mouse-y', `50%`);
      }
    };

    el.addEventListener('mousemove', handleMove, { signal });
    el.addEventListener('mouseleave', reset, { signal });

    return () => {
      controller.abort();
    };
  }, [isTouch, isMove, moveShadow]);

  return (
    <div
      ref={elRef}
      className={className}
      onPointerDown={handle.down}
      onPointerUp={handle.up}
      onPointerCancel={handle.up}
      onPointerLeave={handle.leave}
      onPointerEnter={handle.enter}
    >
      <div className={classInner} ref={innerRef}>
        {children}
      </div>
    </div>
  );
}

export function isPointerEvent(e: any): e is React.PointerEvent {
  return !!e && typeof e === 'object' && 'pointerId' in e;
}

export function trySetPointerCapture(
  e: React.PointerEvent | React.MouseEvent | React.TouchEvent,
  el?: HTMLElement | null
) {
  if (!isPointerEvent(e)) return;
  const target = el ?? (e.currentTarget as HTMLElement | null);
  if (!target?.setPointerCapture) return;
  try {
    target.setPointerCapture(e.pointerId);
  } catch {}
}

export function tryReleasePointerCapture(
  e: React.PointerEvent | React.MouseEvent | React.TouchEvent,
  el?: HTMLElement | null
) {
  if (!isPointerEvent(e)) return;
  const target = el ?? (e.currentTarget as HTMLElement | null);
  if (!target?.releasePointerCapture) return;
  try {
    target.releasePointerCapture(e.pointerId);
  } catch {}
}
