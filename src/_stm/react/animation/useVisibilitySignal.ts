'use client';
import { useEffect, useRef } from 'react';
import { useSignal, type Sig } from '../react';

type Range = [number, number];
type RangeList = Range[];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function inAnyRange(x: number, ranges: RangeList) {
  for (const [a, b] of ranges) {
    if (x >= a && x <= b) return true;
  }
  return false;
}

function minMax(ranges: RangeList) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const [a, b] of ranges) {
    if (a < mn) mn = a;
    if (b > mx) mx = b;
  }
  if (!Number.isFinite(mn)) mn = 0;
  if (!Number.isFinite(mx)) mx = 1;
  return [mn, mx] as const;
}

export function ensureOverlay(enterAt: RangeList, exitAt: RangeList, debug: boolean) {
  if (!debug) return { cleanup: () => {} };

  const overlay = document.createElement('div');
  overlay.className = 'debug-overlay';
  overlay.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999999;
    font-size: 11px;
    font-family: monospace;
    color: #fff;
    text-shadow: 0 0 3px rgba(0,0,0,0.8);
    opacity: 1;
  `;
  document.body.appendChild(overlay);

  const styleEl = document.createElement('style');
  overlay.appendChild(styleEl);

  const makeLine = (y: number, color: string, label: string) => {
    const line = document.createElement('div');
    line.className = 'debug-line';
    line.dataset.label = label;
    line.style.cssText = `
      position: absolute;
      left: 0;
      width: 100%;
      height: 1px;
      top: ${(y * 100).toFixed(2)}%;
      background: ${color};
      opacity: 1;
    `;
    const beforeRule = `
      .debug-line[data-label="${label}"]::before {
        content: "${label}";
        position: absolute;
        left: 8px;
        top: -14px;
        font-size: 11px;
        color: ${color};
        opacity: 1;
      }
    `;
    styleEl.appendChild(document.createTextNode(beforeRule));
    overlay.appendChild(line);
    return line;
  };

  enterAt.forEach(([start, end], i) => {
    makeLine(start, 'rgba(0,255,0,0.7)', `enter[${i}] start=${start}`);
    makeLine(end, 'rgba(0,255,0,0.4)', `enter[${i}] end=${end}`);
  });

  exitAt.forEach(([start, end], i) => {
    if (!Number.isFinite(start) && !Number.isFinite(end)) return;
    makeLine(start, 'rgba(255,0,0,0.7)', `exit[${i}] start=${start}`);
    makeLine(end, 'rgba(255,0,0,0.4)', `exit[${i}] end=${end}`);
  });

  return {
    cleanup: () => overlay.remove(),
  };
}

// ------------------------------------------------------------
// ✅ прогресс нормализуем строго 0..1 внутри enterAt,
// а progressThreshold даёт хвост снаружи
// ------------------------------------------------------------
function mapProgressWithEnterAt(pBase01: number, enterAt: RangeList, tail = 0) {
  const [a0, b0] = minMax(enterAt);
  const a = clamp01(a0);
  const b = clamp01(b0);

  const th = Math.max(0, Math.min(2, tail));
  const aP = a - th;
  const bP = b + th;

  const spanP = Math.max(1e-6, bP - aP);
  const pExt = clamp01((pBase01 - aP) / spanP);

  const pAtA = clamp01((a - aP) / spanP);
  const pAtB = clamp01((b - aP) / spanP);

  const denom = Math.max(1e-6, pAtB - pAtA);
  return clamp01((pExt - pAtA) / denom);
}

// ------------------------------------------------------------
// ✅ watchMode
// ------------------------------------------------------------
export type WatchMode = 'viewport' | 'travel' | 'self';

export interface VisibilitySignalProps {
  delay?: number;
  eventName?: string;
  enterAt?: RangeList;
  exitAt?: RangeList;
  debug?: boolean;
  isTop?: boolean;
  isCenter?: boolean;
  isBottom?: boolean;
  watchNext?: number;
  progressThreshold?: number;
  watchMode?: WatchMode;
  refScroll?: React.RefObject<HTMLElement | null>;
}

export interface VisibleSignalState {
  ratio: Sig<number>;
  overlap: Sig<number>;
  visible: Sig<boolean>;
  progress: Sig<number>;
  remainingPx: Sig<number>;
  unreachablePx: Sig<number>;
  dir: Sig<number>;
  ref: React.RefObject<HTMLElement | null>;
}

export default function useVisibilitySignal<T extends HTMLElement = HTMLDivElement>(
  {
    enterAt = [[0, 1]],
    exitAt = [[Infinity, Infinity]],
    debug = false,
    isTop = false,
    isCenter = false,
    isBottom = false,
    watchNext = -1,
    eventName,
    delay = 0,
    progressThreshold = 0,
    watchMode = 'viewport',
    refScroll,
  }: VisibilitySignalProps,
  externalRef?: React.RefObject<HTMLElement | null>
) {
  const visible = useSignal(false);
  const ratio = useSignal(0);
  const overlap = useSignal(0);
  const progress = useSignal(0);

  const remainingPx = useSignal(0);
  const unreachablePx = useSignal(0);
  const dir = useSignal(0);
  const ref = externalRef ?? useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const controller = new AbortController();
    const { signal } = controller;

    // overlay линии — имеет смысл только в viewport-mode
    const { cleanup } = ensureOverlay(enterAt, exitAt, debug && watchMode === 'viewport');

    let next: HTMLElement | null = null;
    if (watchNext >= 0) {
      let parent: HTMLElement | null = el;
      for (let i = 0; i < watchNext && parent; i++) parent = parent.parentElement;
      next = parent?.nextElementSibling as HTMLElement | null;
    }

    const vh = () => document.documentElement.clientHeight || window.innerHeight;

    let showTimeout: number = -1;
    let isVisibleNow = false;
    let rafId = 0;
    let lastScrollPos: number | null = null;
    const compute = () => {
      rafId = 0;

      const rect = el.getBoundingClientRect();
      const height = rect.height || 1;

      const viewH = vh();
      const visiblePart = Math.max(0, Math.min(rect.bottom, viewH) - Math.max(rect.top, 0));
      ratio.v = Math.min(1, visiblePart / height);

      if (next) {
        const nextRect = next.getBoundingClientRect();
        const overlapPx = Math.max(0, rect.bottom - nextRect.top);
        overlap.v = Math.min(1, Math.max(0, overlapPx / height));
      } else {
        overlap.v = 0;
      }

      // ------------------------------------------------------------
      // ✅ anchorRatio (только для viewport-mode)
      // ------------------------------------------------------------
      const anchorPos = isTop
        ? rect.top
        : isBottom
          ? rect.bottom
          : // isCenter или default => center
            rect.top + height / 2;

      const anchorRatio = anchorPos / viewH;

      // ------------------------------------------------------------
      // ✅ basePos (0..1) для travel/self
      // ------------------------------------------------------------
      let basePos01 = 0; // всегда 0..1
      if (watchMode !== 'viewport') {
        const scroller = refScroll?.current;
        const scrollY = scroller ? scroller.scrollTop : window.scrollY || window.pageYOffset || 0;
        const viewH2 = scroller ? scroller.clientHeight : viewH;

        const maxScrollY = scroller
          ? Math.max(0, scroller.scrollHeight - viewH2)
          : Math.max(0, (document.documentElement.scrollHeight || 0) - viewH2);

        const elTopDoc = rect.top + scrollY;
        const elBottomDoc = rect.bottom + scrollY;

        // где начинается отсчет
        const startScroll =
          watchMode === 'travel'
            ? elTopDoc - viewH // элемент только вошёл снизу
            : elTopDoc; // self: top элемента попал на top viewport

        // идеальный конец
        const endWanted = elBottomDoc;

        // достижимый конец (если страница короче)
        const endScroll = Math.min(endWanted, maxScrollY);

        remainingPx.v = Math.max(0, endScroll - scrollY);
        unreachablePx.v = Math.max(0, endWanted - maxScrollY);

        const denom = Math.max(1e-6, endScroll - startScroll);
        basePos01 = clamp01((scrollY - startScroll) / denom);
      } else {
        remainingPx.v = Math.max(0, rect.bottom);
        unreachablePx.v = 0;
      }

      // ------------------------------------------------------------
      // ✅ visibility gate
      // ------------------------------------------------------------
      const gateX = watchMode === 'viewport' ? anchorRatio : basePos01;

      const inEnter = inAnyRange(gateX, enterAt);
      const inExit = inAnyRange(gateX, exitAt);
      const shouldShow = inEnter && !inExit;

      if (shouldShow && !isVisibleNow) {
        if (showTimeout !== -1) return;
        showTimeout = window.setTimeout(() => {
          visible.v = true;
          isVisibleNow = true;
          showTimeout = -1;
        }, delay ?? 0);
      } else if (!shouldShow && isVisibleNow) {
        if (showTimeout !== -1) {
          clearTimeout(showTimeout);
          showTimeout = -1;
        }
        visible.v = false;
        isVisibleNow = false;
      } else if (!shouldShow && !isVisibleNow) {
        if (showTimeout !== -1) {
          clearTimeout(showTimeout);
          showTimeout = -1;
        }
      }

      // ------------------------------------------------------------
      // ✅ progress
      // ------------------------------------------------------------
      const th = Math.max(0, Math.min(2, progressThreshold));

      if (watchMode === 'viewport') {
        // как было: progress растёт когда элемент идёт вверх (при scroll вниз)
        const [enterMin, enterMax] = minMax(enterAt);

        const enterMinP = enterMin - th;
        const enterMaxP = enterMax + th;

        const spanP = Math.max(1e-6, enterMaxP - enterMinP);

        // 0 на enterMax, 1 на enterMin
        const pExt = clamp01((enterMaxP - anchorRatio) / spanP);

        const pAtMax = clamp01((enterMaxP - enterMax) / spanP);
        const pAtMin = clamp01((enterMaxP - enterMin) / spanP);

        const denom = Math.max(1e-6, pAtMin - pAtMax);
        progress.v = clamp01((pExt - pAtMax) / denom);
      } else {
        // travel/self: базовая позиция уже 0..1
        // enterAt здесь считается как диапазон внутри travel/self
        progress.v = mapProgressWithEnterAt(basePos01, enterAt, th);
      }

      const scroller = refScroll?.current;
      const scrollPos = scroller ? scroller.scrollTop : window.scrollY || window.pageYOffset || 0;

      if (lastScrollPos === null) {
        dir.v = 0;
      } else {
        const d = scrollPos - lastScrollPos;

        // ✅ твой формат:
        // вниз = -1, вверх = 1
        dir.v = d > 0 ? -1 : d < 0 ? 1 : 0;
      }

      lastScrollPos = scrollPos;
    };

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(compute);
    };
    const target = refScroll?.current ?? window;
    target.addEventListener('scroll', schedule, { passive: true, signal });
    window.addEventListener('resize', schedule, { signal });
    window.addEventListener('orientationchange', schedule, { signal });
    if (eventName) window.addEventListener(eventName, schedule, { signal });

    compute();

    return () => {
      controller.abort();
      cleanup();
      if (rafId) cancelAnimationFrame(rafId);
      if (showTimeout !== -1) clearTimeout(showTimeout);
    };
  }, [
    enterAt,
    exitAt,
    isTop,
    isCenter,
    isBottom,
    watchNext,
    debug,
    delay,
    eventName,
    refScroll,
    progressThreshold,
    watchMode,
  ]);

  return { ref, dir, visible, ratio, overlap, progress, remainingPx, unreachablePx };
}
