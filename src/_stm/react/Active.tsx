import { useState } from 'react';
import { useWatch, type TRComputed, type TRSignal } from './react';
import type { Signal } from '..';

const isUndefined = Symbol('undefined');
type Sg = TRSignal<any> | Signal<any> | TRComputed<any>;
interface ActiveProps<T> {
  sg?: Sg | typeof isUndefined;
  triggers?: Sg[];
  is?: T | T[] | ((v: T) => boolean) | typeof isUndefined;
  callback?: (v: boolean) => void;
  children: React.ReactNode | (() => React.ReactNode);
  ch?: React.ReactNode | (() => React.ReactNode);
}

function _Active<T>({
  sg = isUndefined,
  is = isUndefined,
  triggers = [],
  children,
  ch,
  callback,
}: ActiveProps<T>) {
  const _ch = ch ?? children;
  const [visible, setVisible] = useState(false);
  const isRerender = is === isUndefined;
  useWatch(() => {
    for (let item of triggers) {
      item.v;
    }
    if (sg === isUndefined) return setVisible(!visible);
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

  return !isRerender ? (visible ? showChildren(_ch) : null) : showChildren(_ch);
}
export const Active = _Active;
function showChildren(ch: React.ReactNode | (() => React.ReactNode)) {
  return typeof ch === 'function' ? ch() : ch;
}
