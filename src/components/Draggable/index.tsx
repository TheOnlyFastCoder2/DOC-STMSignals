import { useRef } from 'react';
import $ from './styles.module.css';
import { Draggable, type DraggableImpRef } from '@site/src/_stm/react/Draggable';

const event = new Event('viewport-move');
interface DraggableHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export default function DraggableHeader({ children, className }: DraggableHeaderProps) {
  const ref = useRef<Partial<DraggableImpRef>>({});
  const refEl = useRef<HTMLDivElement>(null);

  ref.current.move = (x, y) => {
    if (!refEl.current) return;
    const header = refEl.current;
    header.style.left = `${x}px`;
    header.style.top = `${y}px`;
    window.dispatchEvent(event);
  };

  return (
    <div className={$.Draggable} ref={refEl}>
      <Draggable impRef={ref}>
        <div className={$.head}></div>
      </Draggable>
      <div className={`${$.container} ${className}`}>{children}</div>
    </div>
  );
}
