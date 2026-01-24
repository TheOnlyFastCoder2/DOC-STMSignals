import { useEffect, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import $ from './styles.module.css';

import { useSignal, useWatch, type Sig } from '../react';
import { Active } from '../Active';

export interface Props extends PropsWithChildren {
  isOpen: Sig<boolean>;
  mode?: 'overlay' | 'normal';
  delay?: number;
  isCloseOnOverlay?: boolean;
  className?: string;
  classNameContent?: string;
  onCloseStart?: () => void;
  onCloseEnd?: () => void;
  isTeleport?: boolean;
}

export default function Popup({
  isOpen,
  delay = 100,
  children,
  isCloseOnOverlay = false,
  classNameContent = '',
  className,
  mode = 'normal',
  onCloseStart,
  onCloseEnd,
  isTeleport = true,
}: Props) {
  const refPopup = useRef<HTMLDivElement>(null);

  // отвечает ТОЛЬКО за рендер / анимацию
  const isVisible = useSignal(false);
  const isClosing = useSignal(false);

  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  useWatch(() => {
    const open = isOpen.v;

    // ✅ токен меняем только на смене open/close
    tokenRef.current++;
    const token = tokenRef.current;

    // ✅ OPEN
    if (open) {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      refPopup.current?.removeAttribute('remove');
      isVisible.v = true;
      isClosing.v = false;
      return;
    }

    // ✅ CLOSE
    // ВАЖНО: читаем НЕ реактивно, иначе эффект сам себя перезапускает
    if (!isVisible.u || isClosing.u) return;

    isClosing.v = true;
    onCloseStart?.();
    refPopup.current?.setAttribute('remove', 'true');

    if (timerRef.current != null) clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(() => {
      // ✅ если успели открыть заново — игнорируем старое закрытие
      if (tokenRef.current !== token) return;

      refPopup.current?.removeAttribute('remove');
      isVisible.v = false;
      isClosing.v = false;
      onCloseEnd?.();
      timerRef.current = null;
    }, delay);
  }, [isOpen, delay]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleClickOverlay = () => {
    if (!isCloseOnOverlay) return;
    (isOpen as any).v = false;
  };

  if (typeof window === 'undefined') return null;
  const Compontent = (
    <Active sg={isVisible} is={true}>
      <div
        ref={refPopup}
        onClick={handleClickOverlay}
        className={`${$.Popup} ${$[mode]} ${className}`}
      >
        <div onClick={(e) => e.stopPropagation()} className={`${$.content} ${classNameContent}`}>
          {children}
        </div>
      </div>
    </Active>
  );

  return isTeleport ? createPortal(Compontent, document.body) : Compontent;
}
