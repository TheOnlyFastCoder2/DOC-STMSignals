import { useWatch, type Sig } from '../react';

type BoolLike = boolean | Sig<boolean>;
const readBool = (v?: boolean | Sig<boolean>) => (typeof v === 'boolean' ? v : v?.v === true);

type UseSpringMouseOpts = {
  ref?: React.RefObject<HTMLElement | null>;
  isMove?: BoolLike;
  mouseStrength?: number;
  isReverse?: boolean;
  onMouse: (x: number, y: number, rotateX: number, rotateY: number) => void;
};

export function useSpringMouse({
  ref,
  isMove = true,
  mouseStrength = 1,
  isReverse = false,
  onMouse,
}: UseSpringMouseOpts) {
  useWatch(
    () => {
      if (typeof window === 'undefined') return;

      const isTouch = window.matchMedia('(hover: none)').matches;

      const moveEnabled = readBool(isMove);
      const target = !ref ? document.documentElement : ref?.current;
      if (!target) return;

      if (isTouch || !moveEnabled) {
        onMouse(0, 0, 0, 0);
        return;
      }

      const controller = new AbortController();
      const { signal } = controller;

      let raf = 0;
      let lastX = 0;
      let lastY = 0;
      let hasPos = false;

      const applyMouse = () => {
        raf = 0;
        if (!hasPos) return;

        const rect = !ref
          ? {
              left: 0,
              top: 0,
              width: window.innerWidth,
              height: window.innerHeight,
            }
          : target.getBoundingClientRect();

        const nx = (lastX - rect.left - rect.width / 2) / (rect.width / 2);
        const ny = (lastY - rect.top - rect.height / 2) / (rect.height / 2);

        const cx = Math.max(-1, Math.min(1, nx));
        const cy = Math.max(-1, Math.min(1, ny));

        const c = isReverse ? -1 : 1;
        const ROTATE_RADIUS = 18;

        onMouse(
          cx,
          cy,
          cy * ROTATE_RADIUS * mouseStrength * c,
          cx * ROTATE_RADIUS * mouseStrength * c
        );
      };

      const handleMove = (e: MouseEvent) => {
        lastX = e.clientX;
        lastY = e.clientY;
        hasPos = true;
        if (!raf) raf = requestAnimationFrame(applyMouse);
      };

      const reset = () => onMouse(0, 0, 0, 0);

      target.addEventListener('mousemove', handleMove, { signal });
      target.addEventListener('mouseleave', reset, { signal });

      return () => controller.abort();
    },
    [],
    'sync'
  );
}
