import { type PropsWithChildren, useEffect, useRef } from 'react';
import { effect } from '..';
import { useSignal, useWatch } from './react';

export interface DraggableImpRef {
  move?: (x: number, y: number) => void;
  startX?: number;
  startY?: number;
}

interface DraggableProps extends PropsWithChildren {
  impRef: React.RefObject<Partial<DraggableImpRef>>;
}

export function Draggable({ impRef, children }: DraggableProps) {
  const x = useSignal(0)
  const y = useSignal(0)
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!impRef.current) impRef.current = {};
  }, [impRef]);

  useWatch(() => {
    impRef.current?.move?.(x.v, y.v);
  });

  const onGrabberDown = (
    e: React.MouseEvent<HTMLDivElement, MouseEvent> | React.TouchEvent<HTMLDivElement>
  ) => {
    e.stopPropagation();
    const prevX = x.v;
    const prevY = y.v;

    startDrag(e.nativeEvent, {
      onStart: () => {
        document.body.style.userSelect = 'none';
      },
      onMove: (dx, dy) => {
        x.v = prevX + dx;
        y.v = prevY + dy;
      },
      onEnd: () => {
        document.body.style.userSelect = '';
      },
    });
  };

  useEffect(() => {
    const curr = impRef.current;
    x.v = curr?.startX ?? 0;
    y.v = curr?.startY ?? 0;
  }, [impRef, x, y]);

  return (
    <div
      ref={ref}
      onMouseDown={onGrabberDown}
      onTouchStart={onGrabberDown}
      style={{ display: 'contents' }}
      children={children}
    />
  );
}

function getPointerEvent(e: MouseEvent | TouchEvent) {
  return 'touches' in e ? e.touches[0] : e;
}

type DragCallbacks = {
  onStart?: (x: number, y: number, event: MouseEvent | TouchEvent) => void;
  onMove?: (dx: number, dy: number, event: MouseEvent | TouchEvent) => void;
  onEnd?: (event: MouseEvent | TouchEvent) => void;
};

const startDrag = (
  startEvent: MouseEvent | TouchEvent,
  { onStart, onMove, onEnd }: DragCallbacks = {}
) => {
  const startPointer = getPointerEvent(startEvent);
  const startX = startPointer.clientX;
  const startY = startPointer.clientY;

  onStart?.(startX, startY, startEvent);

  const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
    moveEvent.preventDefault();
    const pointer = getPointerEvent(moveEvent);
    const dx = pointer.clientX - startX;
    const dy = pointer.clientY - startY;
    onMove?.(dx, dy, moveEvent);
  };

  const handleEnd = (endEvent: MouseEvent | TouchEvent) => {
    if (typeof window == undefined) return;
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleEnd);
    window.removeEventListener('touchmove', handleMove);
    window.removeEventListener('touchend', handleEnd);
    document.body.style.cursor = 'default';
    onEnd?.(endEvent);
  };

  if (typeof window == undefined) return;
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);
  window.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd);
  document.body.style.cursor = 'grabbing';
};
