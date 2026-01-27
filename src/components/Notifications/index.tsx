import $ from './styles.module.css';

import Popup from '../../_stm/react/Popup';
import { ReactDeep, signalMapRC, useSignal, useWatch } from '../../_stm/react/react';
import { Spring } from '../../_stm/react/animation/Spring';
import useSpringSignal from '../../_stm/react/animation/useSpringSignal';
import { ReactElement, useRef } from 'react';
import { computed, signal } from '@site/src/_stm';
import { DeepSignal } from '@site/src/_stm/signalMap';

const uid = (() => {
  let n = 1;
  return () => {
    return n++;
  };
})();
const qty = signal(0);
interface Itme {
  id: number;
  isOpen: boolean;
  isAnimation: boolean;
  progress: number;
  hovered: boolean;
  isHidden: boolean;

  content: ReactElement<unknown, string | React.JSXElementConstructor<any>>;
  prevIndex: DeepSignal<Itme, 'deep'> | undefined;
}
const createPopup = (content: ReactElement, prev?: DeepSignal<Itme, 'deep'> | undefined) => {
  return {
    id: uid(),
    isOpen: true,
    isAnimation: true,
    started: false,
    progress: 100,
    content,
    hovered: false,
    isHidden: false,
    prev,
  };
};
type Notify = ReactDeep<ReturnType<typeof createPopup>, 'deep'>;
export const stNotify = signalMapRC<ReturnType<typeof createPopup>>([]);

export const toNotify = (content: ReactElement) => {
  qty.u++;
  const prev = stNotify.at(-1);
  stNotify.push(createPopup(content, prev as any));
};

const getVisualIndex = (self: Notify) => {
  let idx = 0;

  for (const x of stNotify) {
    if (x === self) break;
    if (x.isAnimation.v) idx++;
  }

  return idx;
};

const hoveredIdx = computed(() => {
  let idx = 0;
  for (const x of stNotify) {
    if (!x.isAnimation.v) continue;
    if (x.hovered.v) return idx;
    idx++;
  }
  return -1;
});

export default function Notifications() {
  return stNotify.map((notify, i) => {
    return (
      <Popup
        key={notify.id.v}
        delay={0}
        isOpen={notify.isOpen}
        className={$.MWNotifiy}
        classNameContent={$.MWNotifiyContent}
        onPointerEnter={() => (notify.hovered.v = true)}
        onPointerLeave={() => (notify.hovered.v = false)}
        style={{
          zIndex: 1000 - i,
        }}
      >
        <Spring
          isActive={notify.isAnimation}
          classInner={$.MWNotifiySpringInner}
          className={$.MWNotifiySpring}
          settleKey={'opacity'}
          onPhaseSettled={(phase) => {
            if (phase !== 'default') return;

            if (notify.isAnimation.v === false) {
              notify.isOpen.v = false;
              stNotify.removeRef(notify);
            }
          }}
          spring={{
            opacity: {
              values: {
                default: 0,

                active: () => {
                  const idx = getVisualIndex(notify);

                  const step = 0.12;
                  const min = 0.35;
                  const base = Math.max(min, 1 - idx * step);

                  const h = hoveredIdx.v;
                  notify.isHidden.v = false;
                  if (notify.hovered.v) return 1;
                  if (h !== -1 && idx < h) {
                    notify.isHidden.v = true;
                    return 0;
                  }

                  return base;
                },
              },

              stiffness: 80,
              damping: 20,
              speed: 1.2,
            },
            translateY: {
              values: {
                default: '100%',
                active: () => {
                  const idx = getVisualIndex(notify);
                  return `${-idx * 55}%`;
                },
              },
              stiffness: 80,
              damping: 8,
            },
          }}
        >
          <Notification notify={notify} />
        </Spring>
      </Popup>
    );
  });
}

interface Props {
  notify: ReactDeep<ReturnType<typeof createPopup>, 'deep'>;
}

function Notification({ notify }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const details = useSpringSignal(notify.progress, {
    stiffness: 10,
    damping: 2,
    speed: 1.2,
    onProgress: () => {
      const v = details.v;
      const el = ref.current;
      if (!el) return;

      el.style.width = `${v.toFixed(2)}%`;
      if (v < 2 && notify.isAnimation.v) {
        //@ts-expect-error
        notify.isAnimation.v = false;
        qty.v--;
      }
    },
  });

  useWatch(() => {
    if (notify.isHidden.v || notify.hovered.v) return;
    if (!notify.prev.id || (notify.prev && notify.prev.progress.v < 2)) {
      const timeId = setInterval(() => {
        notify.progress.v -= 10;
      }, 200);

      return () => clearInterval(timeId);
    }
  }, [notify]);

  return (
    <div className={$.content}>
      <div className={$.progress}>
        <div className={$.track} ref={ref} />
      </div>

      <div className={$.main}>{notify.content.c}</div>
    </div>
  );
}
