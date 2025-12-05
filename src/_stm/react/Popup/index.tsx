import { useImperativeHandle, useRef, type PropsWithChildren } from 'react';
import $ from './styles.module.css';

import { useSignal } from '../react';
import { Active } from '../Active';
import { createPortal } from 'react-dom';
export interface ImpRef {
  toOpen: () => void;
  toClose: (cb?: (isBlock: boolean) => void) => void;
}

export interface Props extends PropsWithChildren {
  impRef: React.RefObject<Partial<ImpRef>>;
  mode?: 'overlay' | 'normal';
  delay?: number;
  isCloseOnOverlay?: boolean;
  className?: string;
  classNameContent?: string;
}

export default function Popup({
  className,
  impRef,
  delay = 100,
  children,
  isCloseOnOverlay = false,
  classNameContent = '',
  mode = 'normal',
}: Props) {
  const refPopup = useRef<HTMLDivElement>(null);
  const isOpen = useSignal(false);
  const timeId = useSignal(-1);

  useImperativeHandle(impRef, () => ({
    toOpen: () => (isOpen.v = true),
    toClose: (cb) => {
      if (!!~timeId.v) return;
      cb?.(true);
      refPopup.current?.setAttribute?.('remove', 'true');
      timeId.v = setTimeout(() => {
        refPopup.current?.removeAttribute?.('remove');
        timeId.v = -1;
        isOpen.v = false;
        cb?.(false);
      }, delay);
    },
  }));

  const handleClickOverlay = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCloseOnOverlay) return;
    e.currentTarget.setAttribute?.('remove', 'true');
    impRef.current.toClose?.();
  };
  if (typeof window === 'undefined') return;
  const overlays = document.getElementById('#root') || document.body;

  return (
    <Active sg={isOpen} is={true}>
      {createPortal(
        <div
          onClick={handleClickOverlay}
          className={`${$.Popup} ${$[mode]} ${className}`}
          ref={refPopup}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${$.content} ${classNameContent}`}
            children={children}
          />
        </div>,
        overlays
      )}
    </Active>
  );
}
1