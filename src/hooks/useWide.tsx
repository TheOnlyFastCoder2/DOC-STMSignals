import { useEffect, useState } from 'react';
import { subscribeMediaQuery } from '../utils/subscribeMediaQuery';

export default function useIsWide(minWidth = 521, type: 'max' | 'min' = 'min') {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(${type}-width: ${minWidth}px)`);
    setIsWide(mq.matches);
    const unsubscribe = subscribeMediaQuery(mq, (m) => setIsWide(m.matches));
    return unsubscribe;
  }, [minWidth]);

  return isWide;
}
