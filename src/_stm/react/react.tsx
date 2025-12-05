import { memo, useEffect as _useEffect, useEffect, useRef, type DependencyList } from 'react';
import { useSyncExternalStore } from 'react';
import { Signal, Computed, Effect, signal, computed, effect } from '../index';
import { SignalMap, type DeepSignal } from '../signalMap'; // или из '../index', если реэкспортируешь

/* =============== Типы над сигналами =============== */

export type Sig<T = any> = Signal<T> | Computed<T>;

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
export type ReactDeep<T> = Reactify<DeepSignal<T>>;
type BaseMap<T> = Omit<SignalMap<T>, 'map' | 'v'>;
/** SignalMap, у которого v типизирован как массив DeepReact, + .map(renderFn) → JSX */
export type TRMapSignal<T> = BaseMap<T> & {
  readonly v: ReadonlyArray<ReactDeep<T>>;
  map(renderFn: (item: ReactDeep<T>, index: number) => any): React.ReactElement;
};
/* =============== Внутренний listener-хелпер =============== */

type ExternalStore = <T>(signal: Sig<T>) => T;

/**
 * Один useSignalListener даёт:
 *  - Set слушателей (из useSyncExternalStore)
 *  - функцию notify(), которая дергает всех
 *  - externalStore(sig) — обёртку для useSyncExternalStore
 */
function useSignalListener(): [() => void, <T>(s: Signal<T> | Computed<T>) => T] {
  const listenersRef = useRef<Set<() => void>>(new Set());
  const notifyRef = useRef(() => {
    for (const l of listenersRef.current) l();
  });

  function externalStore<T>(sig: Signal<T> | Computed<T>) {
    return useSyncExternalStore(
      (listener) => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      () => sig.v,
      () => sig.v
    );
  }

  return [notifyRef.current, externalStore];
}

/* =============== Общий конструктор .c =============== */

function definedComponent(externalStore: ExternalStore, sig: Sig) {
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
      sig.v;
      notify();
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

export function useSignalValue<T>(sg: Sig<T>): T {
  const [notify, externalStore] = useSignalListener();

  _useEffect(() => {
    const eff = new Effect(() => {
      sg.v;
      notify();
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
      () => sig.v,
      () => sig.v
    );

    return renderValue(value);
  });

  Object.defineProperty(sig, 'c', {
    configurable: true,
    enumerable: false,
    value: <Comp />,
  });

  new Effect(() => {
    sig.v;
    for (const l of listeners) l();
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
      comp.v;
      notify();
    });

    return () => {
      eff.dispose();
    };
  }, [notify]);

  return compRef.current as TRComputed<T>;
}

/* =============== useWatch =============== */

export function useWatch(fn: () => void, deps: DependencyList = []) {
  const cb = useRef(fn);
  cb.current = fn;

  _useEffect(() => {
    const eff = new Effect(() => cb.current());
    return () => eff.dispose();
  }, [cb, ...deps]);
}

/* =============== useSignalMap =============== */

export function useSignalMap<T>(
  initialValue: readonly T[],
  deps: DependencyList = []
): TRMapSignal<T> {
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
        const Map = memo(() => {
          const state = listExternalStore(mapSignal);
          return state.map(renderFn);
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
