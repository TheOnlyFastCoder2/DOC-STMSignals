'use client';
import { useEffect, useRef } from 'react';
import { useSignal } from '../react';

type Range = [number, number];
type RangeList = Range[];

export function ensureOverlay(enterAt: RangeList, exitAt: RangeList, debug: boolean) {
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
    // mix-blend-mode: difference;
    opacity: ${debug ? 1 : 0};
    visibility: ${debug ? 'visible' : 'hidden'};
    transition: opacity 0.3s ease;
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
      opacity: ${debug ? 1 : 0};
      visibility: ${debug ? 'visible' : 'hidden'};
      transition: opacity 0.3s ease;
    `;
    const beforeRule = `
      .debug-line[data-label="${label}"]::before {
        content: "${label}";
        position: absolute;
        left: 8px;
        top: -14px;
        font-size: 11px;
        color: ${color};
        opacity: ${debug ? 1 : 0};
        transition: opacity 0.3s ease;
      }
    `;
    styleEl.appendChild(document.createTextNode(beforeRule));
    overlay.appendChild(line);
    return line;
  };

  const enterLines = enterAt.flatMap(([start, end], i) => [
    makeLine(start, 'rgba(0,255,0,0.7)', `enter[${i}] start=${start}`),
    makeLine(end, 'rgba(0,255,0,0.4)', `enter[${i}] end=${end}`),
  ]);

  const exitLines = exitAt.flatMap(([start, end], i) => [
    makeLine(start, 'rgba(255,0,0,0.7)', `exit[${i}] start=${start}`),
    makeLine(end, 'rgba(255,0,0,0.4)', `exit[${i}] end=${end}`),
  ]);

  return { overlay, enterLines, exitLines };
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
  }: {
    delay?: number;
    eventName?: string;
    enterAt?: RangeList;
    exitAt?: RangeList;
    debug?: boolean;
    isTop?: boolean;
    isCenter?: boolean;
    isBottom?: boolean;
    watchNext?: number;
  },
  externalRef?: React.RefObject<HTMLElement | null>
) {
  const visible = useSignal(false);
  const ratio = useSignal(0);
  const overlap = useSignal(0);
  const ref = externalRef ?? useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const controller = new AbortController();
    const { signal } = controller;
    const { enterLines, exitLines } = ensureOverlay(enterAt, exitAt, debug);

    let next: HTMLElement | null = null;
    if (watchNext >= 0) {
      let parent: HTMLElement | null = el;
      for (let i = 0; i < watchNext && parent; i++) parent = parent.parentElement;
      next = parent?.nextElementSibling as HTMLElement | null;
    }

    const vh = () => document.documentElement.clientHeight || window.innerHeight;
    let showTimeout: number | null = null;
    let isVisibleNow = false;

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const height = rect.height || 1;
      const visiblePart = Math.max(0, Math.min(rect.bottom, vh()) - Math.max(rect.top, 0));
      ratio.v = Math.min(1, visiblePart / height);

      if (next) {
        const nextRect = next.getBoundingClientRect();
        const overlapPx = Math.max(0, rect.bottom - nextRect.top);
        overlap.v = Math.min(1, Math.max(0, overlapPx / height));
      } else {
        overlap.v = 0;
      }

      const anchor = isTop ? 'top' : isBottom ? 'bottom' : 'center';
      const anchorPos = anchor === 'top' ? rect.top : anchor === 'bottom' ? rect.bottom : rect.top + height / 2;
      const anchorRatio = anchorPos / vh();

      const getRange = (lines: HTMLElement[]) => {
        if (!lines.length) return [0, 0];
        const ratios = lines.map((l) => l.getBoundingClientRect().top / vh());
        return [Math.min(...ratios), Math.max(...ratios)];
      };

      const [enterMin, enterMax] = getRange(enterLines);
      const [exitMin, exitMax] = getRange(exitLines);
      const inEnter = anchorRatio >= enterMin && anchorRatio <= enterMax;
      const inExit = anchorRatio >= exitMin && anchorRatio <= exitMax;
      const shouldShow = inEnter && !inExit;

      if (shouldShow && !isVisibleNow) {
        if (showTimeout) clearTimeout(showTimeout);
        showTimeout = window.setTimeout(() => {
          visible.v = true;
          isVisibleNow = true;
        }, delay ?? 0);
      } else if (!shouldShow && isVisibleNow) {
        if (showTimeout) clearTimeout(showTimeout);
        visible.v = false;
        isVisibleNow = false;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true, signal });
    window.addEventListener('resize', onScroll, { signal });
    window.addEventListener('orientationchange', onScroll, { signal });
    if (eventName) window.addEventListener(eventName, onScroll, { signal });

    onScroll();

    return () => {
      controller.abort();
      if (showTimeout) clearTimeout(showTimeout);
    };
  }, [enterAt, exitAt, isTop, isCenter, isBottom, watchNext, debug, delay, eventName]);

  return { ref, visible, ratio, overlap };
}
