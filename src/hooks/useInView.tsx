import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Signal } from '../_stm';
import { TRSignal } from '../_stm/react/react';

export function useInView<T extends HTMLElement>(
  isInView: TRSignal<boolean> | Signal<boolean>,
  options?: IntersectionObserverInit
): (node: T) => void {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<T>(null);

  const setRef = useCallback(
    (node: T) => {
      if (observerRef.current && elementRef.current) {
        observerRef.current.unobserve(elementRef.current);
      }

      elementRef.current = node;

      if (!node) return;
      if (!observerRef.current && typeof window !== 'undefined') {
        observerRef.current = new IntersectionObserver((entries) => {
          const [entry] = entries;
          isInView.v = entry.isIntersecting;
        }, options);
      }

      if (observerRef.current) {
        observerRef.current.observe(node);
      }
    },
    [options]
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  return setRef;
}
