import { useState } from 'react';
import { useWatch, type TRComputed, type TRSignal } from './react';
import type { Signal } from '..';

const isUndefined = Symbol('undefined');
type Sg = TRSignal<any> | Signal<any> | TRComputed<any>;
interface ActiveProps<T> {
  sg: Sg;
  triggers?: Sg[];
  is?: T | T[] | ((v: T) => boolean) | typeof isUndefined;
  callback?: (v: boolean) => void;
  children: React.ReactNode | (() => React.ReactNode);
}

function _Active<T>({ sg, is = isUndefined, triggers = [], children, callback }: ActiveProps<T>) {
  const [visible, setVisible] = useState(false);
  const isRerender = is === isUndefined;
  useWatch(() => {
    for (let item of triggers) {
      item.v;
    }

    const val = sg.v;

    if (isRerender) return setVisible(!visible);
    let result = false;

    if (is === undefined) {
      result = !visible;
    } else if (typeof is === 'function') {
      result = (is as any)(val);
    } else if (Array.isArray(is)) {
      result = is.includes(val as any);
    } else {
      result = val === is;
    }

    callback?.(result);
    setVisible(result);
  }, [...triggers, is]);

  return !isRerender ? (visible ? showChildren(children) : null) : showChildren(children);
}
export const Active = _Active;
function showChildren(ch: React.ReactNode | (() => React.ReactNode)) {
  return typeof ch === 'function' ? ch() : ch;
}
