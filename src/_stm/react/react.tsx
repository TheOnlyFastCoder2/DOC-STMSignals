import { memo, useEffect as _useEffect, useEffect, useRef, type DependencyList } from 'react';
import { useSyncExternalStore } from 'react';
import {
  Signal,
  Computed,
  Effect,
  signal,
  computed,
  effect,
  type EffectKind,
  type EffectOptions,
  safeSnapshot,
} from '../index';
import { SignalMap, type DeepSignal, type LeafMode } from '../signalMap'; // или из '../index', если реэкспортируешь

/* =============== Типы над сигналами =============== */

export type Sig<T = any> = Signal<T> | Computed<T> | { get v(): T };

/** Мета для «реактивного» сигнала — .c с готовым React-элементом */
type ReactSigMeta = { c: React.JSX.Element };

// Листовой writable-сигнал под React
export type TRSignal<T> = Signal<T> & ReactSigMeta;

// Листовой computed (read-only) под React
export type TRComputed<T> = Computed<T> & ReactSigMeta;

/** DeepSignal с .c на каждом листовом Signal */
type Reactify<S> =
  S extends Signal<infer U>
    ? TRSignal<U>
    : S extends Computed<infer U>
      ? TRComputed<U>
      : S extends ReadonlyArray<infer U>
        ? ReadonlyArray<Reactify<U>>
        : S extends object
          ? { [K in keyof S]: Reactify<S[K]> }
          : S;
export type ReactDeep<T, M extends LeafMode> = Reactify<DeepSignal<T, M>>;
type BaseMap<T> = Omit<SignalMap<T>, 'map' | 'v'>;
/** SignalMap, у которого v типизирован как массив DeepReact, + .map(renderFn) → JSX */
export type TRMapSignal<T, M extends LeafMode = 'deep'> = BaseMap<T> & {
  readonly v: ReadonlyArray<ReactDeep<T, M>>;
  map(renderFn: (item: ReactDeep<T, M>, index: number) => any): React.ReactElement;
};
/* =============== Внутренний listener-хелпер =============== */

/**
 * Один useSignalListener даёт:
 *  - Set слушателей (из useSyncExternalStore)
 *  - функцию notify(), которая дергает всех
 *  - externalStore(sig) — обёртку для useSyncExternalStore
 */
function useSignalListener(): [() => void, ExternalStoreFn] {
  const listenersRef = useRef<Set<() => void>>(new Set());
  const notifyRef = useRef(() => {
    for (const l of listenersRef.current) l();
  });

  const externalStore: ExternalStoreFn = (sig) =>
    useSyncExternalStore(
      (listener) => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      () => safeSnapshot(sig as any),
      () => safeSnapshot(sig as any)
    );

  return [notifyRef.current, externalStore];
}

/* =============== Общий конструктор .c =============== */

export type ErrorSnapshot = { __stmError: unknown };
type ExternalStoreFn = <T>(s: Sig<T>) => T | ErrorSnapshot;

function definedComponent<T>(externalStore: ExternalStoreFn, sig: Sig<T>) {
  const Comp = memo(() => {
    const value = externalStore(sig);
    return renderValue(value);
  });

  Object.defineProperty(sig, 'c', {
    configurable: true,
    enumerable: false,
    value: <Comp />,
  });
}
/** Рендер значения, если это не уже готовый React-элемент */
export function renderValue<T>(value: T): React.ReactElement {
  if (value && typeof value === 'object' && '__stmError' in (value as any)) {
    const e = (value as any).__stmError;
    const msg = e instanceof Error ? e.message : String(e);
    return <>Error: {msg}</>;
  }

  if (typeof value === 'object' && value !== null && 'type' in (value as any)) {
    return value as unknown as React.ReactElement;
  }
  return <>{String(value)}</>;
}

/* =============== useSignal =============== */

export function useSignal<T>(initialValue: T): TRSignal<T> {
  const [notify, externalStore] = useSignalListener();
  const sigRef = useRef<Signal<T> | null>(null);
  const effRef = useRef<Effect | null>(null);

  if (!sigRef.current) {
    const sig = signal<T>(initialValue);
    sigRef.current = sig;
    definedComponent(externalStore, sig);
  }

  _useEffect(() => {
    const sig = sigRef.current!;

    const eff = new Effect(() => {
      try {
        sig.v;
      } finally {
        notify();
      }
    });
    effRef.current = eff;

    return () => {
      eff.dispose();
      effRef.current = null;
    };
  }, [notify]);

  return sigRef.current as TRSignal<T>;
}

/* =============== useSignalValue (подписка на конкретный сигнал) =============== */

export function useSignalValue<T>(sg: Sig<T>): T | ErrorSnapshot {
  const [notify, externalStore] = useSignalListener();

  _useEffect(() => {
    const eff = new Effect(() => {
      try {
        sg.v;
      } finally {
        notify();
      }
    });

    return () => {
      eff.dispose();
    };
  }, [notify, sg]);

  return externalStore(sg);
}

export function signalRC<T>(initialValue: T): TRSignal<T> {
  const sig = signal<T>(initialValue) as TRSignal<T>;

  const listeners = new Set<() => void>();

  const Comp = memo(() => {
    const value = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => safeSnapshot(sig),
      () => safeSnapshot(sig)
    );

    return renderValue(value);
  });

  Object.defineProperty(sig, 'c', {
    configurable: true,
    enumerable: false,
    value: <Comp />,
  });

  new Effect(() => {
    try {
      sig.v;
    } finally {
      for (const l of listeners) l();
    }
  });

  return sig;
}

/* =============== useComputed =============== */

export function useComputed<T>(fn: () => T): TRComputed<T> {
  const [notify, externalStore] = useSignalListener();
  const compRef = useRef<Computed<T> | null>(null);

  if (!compRef.current) {
    const comp = computed(fn);
    compRef.current = comp;
    definedComponent(externalStore, comp);
  }

  _useEffect(() => {
    const comp = compRef.current!;
    const eff = new Effect(() => {
      try {
        comp.v;
      } finally {
        notify();
      }
    });

    return () => {
      eff.dispose();
    };
  }, [notify]);

  return compRef.current as TRComputed<T>;
}

/* =============== useWatch =============== */

export function useWatch(
  fn: () => void,
  deps: DependencyList = [],
  priorityOrMode: EffectKind = 'normal',
  opts?: EffectOptions
) {
  const cb = useRef(fn);
  cb.current = fn;

  _useEffect(() => {
    const eff = new Effect(() => cb.current(), priorityOrMode, opts);
    return () => eff.dispose();
  }, [cb, ...deps]);
}

/* =============== useSignalMap =============== */

export function useSignalMap<T, M extends LeafMode = 'deep'>(
  initialValue: readonly T[],
  deps: DependencyList = []
): TRMapSignal<T, M> {
  const [leafNotify, leafExternalStore] = useSignalListener();

  const [listNotify, listExternalStore] = useSignalListener();

  const sigMapRef = useRef<SignalMap<T> | null>(null);
  const listEffRef = useRef<Effect | null>(null);

  if (!sigMapRef.current) {
    const mapSignal = new SignalMap<T>(initialValue, (leaf: Signal<any>) => {
      definedComponent(leafExternalStore, leaf);
      effect(() => {
        leaf.v;
        leafNotify();
      });
    });

    sigMapRef.current = mapSignal;

    listEffRef.current = effect(() => {
      mapSignal.v;
      listNotify();
    });

    Object.defineProperty(mapSignal, 'map', {
      configurable: true,
      enumerable: false,
      value: (renderFn: (item: any, index: number) => React.ReactNode) => {
        const Row = memo(({ item, index }: { item: any; index: number }) => {
          const node = useComputed(() => renderFn(item, index));
          return node.c;
        });

        const Map = memo(() => {
          const state = listExternalStore(mapSignal);

          if (isErrorSnapshot(state)) return renderValue(state);

          const keyOf =
            mapSignal.itemKey ?? ((item: any, index: number) => item?.id?.v ?? item?.id ?? index);

          return state.map((item, index) => (
            <Row key={keyOf(item, index)} item={item} index={index} />
          ));
        });

        Map.displayName = 'SignalMap.Map';
        return <Map />;
      },
    });
  }

  useEffect(() => {
    return () => {
      listEffRef.current?.dispose();
      listEffRef.current = null;
    };
  }, [...deps]);

  return sigMapRef.current as any;
}

export function isErrorSnapshot(x: unknown): x is ErrorSnapshot {
  return !!x && typeof x === 'object' && '__stmError' in (x as any);
}
