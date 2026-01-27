import {
  memo,
  useEffect as _useEffect,
  useEffect,
  useRef,
  type DependencyList,
  ReactElement,
} from 'react';
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
import { SignalMap, type DeepSignal, type LeafMode } from '../signalMap';

export type Sig<T = any> = Signal<T> | Computed<T> | { get v(): T };

type ReactSigMeta = { c: React.JSX.Element };

export type TRSignal<T> = Signal<T> & ReactSigMeta;

export type TRComputed<T> = Computed<T> & ReactSigMeta;

type Unsignal<T> =
  T extends Signal<infer U> ? Unsignal<U> : T extends Computed<infer U> ? Unsignal<U> : T;

type Reactify<S> =
  S extends TRSignal<infer U>
    ? TRSignal<U>
    : S extends TRComputed<infer U>
      ? TRComputed<U>
      : S extends Signal<infer U>
        ? TRSignal<Reactify<Unsignal<U>>>
        : S extends Computed<infer U>
          ? TRComputed<Reactify<Unsignal<U>>>
          : S extends ReadonlyArray<infer U>
            ? ReadonlyArray<Reactify<U>>
            : S extends object
              ? { [K in keyof S]: Reactify<S[K]> }
              : S;

export type ReactDeep<T, M extends LeafMode> = Reactify<DeepSignal<T, M>>;
type BaseMap<T, M extends LeafMode> = Omit<SignalMap<T, M>, 'map' | 'v' | 'removeRef'>;
export type TRMapSignal<T, M extends LeafMode = 'deep'> = BaseMap<T, M> & {
  readonly v: ReadonlyArray<ReactDeep<T, M>>;
  map(renderFn: (item: ReactDeep<T, M>, index: number) => any): React.ReactElement;
  removeRef(item: ReactDeep<T, M>): void;
};

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

function createStoreHub(): { notify: () => void; externalStore: ExternalStoreFn } {
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const l of listeners) l();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const externalStore: ExternalStoreFn = (sig) =>
    useSyncExternalStore(
      subscribe,
      () => safeSnapshot(sig as any),
      () => safeSnapshot(sig as any)
    );

  return { notify, externalStore };
}

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
// | ErrorSnapshot
export function useSignalValue<T>(sg: Sig<T>): T | ReactElement {
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
  const val = externalStore(sg);
  if (isErrorSnapshot(val)) return renderValue(val);
  return val as T;
}

function rcify<T>(sig: Signal<T>): TRSignal<T>;
function rcify<T>(sig: Computed<T>): TRComputed<T>;
function rcify<T>(sig: any) {
  const listeners = new Set<() => void>();

  const Comp = memo(() => {
    const value = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => safeSnapshot(sig as any),
      () => safeSnapshot(sig as any)
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
      safeSnapshot(sig as any);
    } finally {
      for (const l of listeners) l();
    }
  });

  return sig;
}

export function signalRC<T>(initialValue: T): TRSignal<T> {
  return rcify(signal<T>(initialValue) as Signal<T>);
}

export function computedRC<T>(fn: () => T): TRComputed<T> {
  return rcify(computed(fn) as Computed<T>);
}
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

export function signalMapRC<T, M extends LeafMode = 'deep'>(
  initialValue: readonly T[] = [],
  onLeaf?: (leaf: Signal<any>) => void,
  wrapMode: M = 'deep' as M
): TRMapSignal<T, M> {
  const leafHub = createStoreHub();
  const listHub = createStoreHub();

  const mapSignal = new SignalMap<T, M>(
    initialValue,
    (leaf: Signal<any>) => {
      onLeaf?.(leaf);
      definedComponent(leafHub.externalStore, leaf);
      effect(() => {
        leaf.v;
        leafHub.notify();
      });
    },
    undefined,
    wrapMode
  );

  effect(() => {
    mapSignal.v;
    listHub.notify();
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
        const state = listHub.externalStore(mapSignal);

        if (isErrorSnapshot(state)) return renderValue(state);

        const keyOf =
          mapSignal.itemKey ?? ((item: any, index: number) => item?.id?.v ?? item?.id ?? index);

        return (state as any[]).map((item, index) => (
          <Row key={keyOf(item, index)} item={item} index={index} />
        ));
      });

      Map.displayName = 'SignalMapRC.Map';
      return <Map />;
    },
  });

  return mapSignal as any;
}
