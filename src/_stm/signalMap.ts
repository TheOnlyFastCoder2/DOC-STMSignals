import { Signal, signal, effect, Effect, computed, untracked, Computed } from './index';

type Priority = 'high' | 'normal' | 'low';

/* ====================== Типы ======================= */

export type Primitive = string | number | boolean | symbol | bigint | null | undefined;

/**
 * Builtin — всё, что считаем "листом" и НЕ разворачиваем по ключам:
 *   - примитивы
 *   - Date/RegExp/Promise/функции
 *   - Map/Set/WeakMap/WeakSet
 *   - буферы и typed-массивы
 *
 * Массивы T[] сюда НЕ входят — их рассматриваем как контейнер
 * (если leafMode не говорит иначе).
 */
type Builtin =
  | Primitive
  | Date
  | RegExp
  | Function
  | Promise<any>
  | Map<any, any>
  | Set<any>
  | WeakMap<any, any>
  | WeakSet<any>
  | ArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * Leaf<T> / asLeaf — типовой бренд, чтобы *насильно* трактовать тип как лист:
 *   type X = DeepSignal<Leaf<Foo>, 'deep'>;
 */
export type Leaf<T> = T & { readonly __asLeaf: unique symbol };
export const asLeaf = <T>(x: T): Leaf<T> => x as Leaf<T>;

/** Кеш обёрток: ключ — исходный объект/массив, значение — обёртка. */
export type WrapCache = WeakMap<object, unknown>;

/* ================== Leaf policies ================== */

export type LeafMode = 'deep' | 'object' | 'array' | 'object+array';

export type WrapOptions<M extends LeafMode = LeafMode> = {
  /**
   * deep = разворачиваем plain objects + arrays
   * object = plain object → Signal
   * array = массив → Signal
   * object+array = и объекты и массивы → Signal
   */
  leafMode?: M;

  /** точечное правило “это leaf” (выше leafMode) */
  isLeaf?: (value: unknown) => boolean;

  /** штамповать numeric ids (по умолчанию true) */
  stampIds?: boolean;
};

type AtomicObj<M extends LeafMode> = M extends 'object' | 'object+array' ? true : false;
type AtomicArr<M extends LeafMode> = M extends 'array' | 'object+array' ? true : false;

/**
 * DeepSignal:
 * - Leaf<*>           -> Signal<base>
 * - Builtin           -> Signal<T>
 * - Array<U>          -> (atomicArr ? Signal<T> : Array<DeepSignal<U,M>>)
 * - plain object      -> (atomicObj ? Signal<T> : {K: DeepSignal<T[K],M>})
 * - everything else   -> Signal<T>
 */
export type DeepSignal<T, M extends LeafMode> =
  T extends Leaf<infer U>
    ? Signal<U>
    : T extends Signal<infer U>
      ? Signal<U>
      : T extends Computed<infer U>
        ? Computed<U>
        : T extends Builtin
          ? Signal<T>
          : T extends ReadonlyArray<infer U>
            ? AtomicArr<M> extends true
              ? Signal<T>
              : ReadonlyArray<DeepSignal<U, M>>
            : T extends object
              ? AtomicObj<M> extends true
                ? Signal<T>
                : { [K in keyof T]: DeepSignal<T[K], M> }
              : Signal<T>;

/* ================== Helpers ================== */

function isPlainObject(value: unknown): value is Record<string | symbol, any> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownEnumerableKeys(obj: object): (string | symbol)[] {
  return Reflect.ownKeys(obj).filter((k) => {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    return !!desc?.enumerable;
  });
}

/* Дев-заморозка массива, чтобы ловить случайные мутации list.v */
function freezeDev<A extends ReadonlyArray<unknown>>(arr: A): A {
  const p: any = typeof process !== 'undefined' ? process : undefined;
  if (p?.env?.NODE_ENV !== 'production') {
    return Object.freeze(arr.slice()) as A;
  }
  return arr;
}

/* --- Signal-детект для deepUnwrap (аппаратный) --- */
function isSignalLike(x: any): x is Signal<any> {
  if (x instanceof Signal) return true;
  if (!x || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  if (!proto) return false;
  const desc = Object.getOwnPropertyDescriptor(proto, 'v');
  return !!desc && (typeof desc.get === 'function' || typeof desc.set === 'function');
}

/* ================== Stable numeric ids ================== */

const STM_NODE_ID = Symbol.for('stm.signalMap.nodeId.v635');

const __STM_ID_SEQ_KEY__ = '__stm_signalmap_id_seq_v635__';
const __STM_ID_MAP_KEY__ = '__stm_signalmap_id_map_v635__';

function getGlobalIdSeq(): number {
  const g = globalThis as any;
  if (g[__STM_ID_SEQ_KEY__] == null) g[__STM_ID_SEQ_KEY__] = 1;
  return g[__STM_ID_SEQ_KEY__];
}
function setGlobalIdSeq(next: number) {
  (globalThis as any)[__STM_ID_SEQ_KEY__] = next;
}
function getGlobalIdMap(): WeakMap<object, number> {
  const g = globalThis as any;
  if (!g[__STM_ID_MAP_KEY__]) g[__STM_ID_MAP_KEY__] = new WeakMap<object, number>();
  return g[__STM_ID_MAP_KEY__] as WeakMap<object, number>;
}

function stableIdForSource(sourceRef: object): number {
  const map = getGlobalIdMap();
  let id = map.get(sourceRef);
  if (!id) {
    id = getGlobalIdSeq();
    setGlobalIdSeq(id + 1);
    map.set(sourceRef, id);
  }
  return id;
}

function stampId(wrapper: object, sourceRef: object) {
  if ((wrapper as any)[STM_NODE_ID] != null) return;
  const id = stableIdForSource(sourceRef);
  Object.defineProperty(wrapper, STM_NODE_ID, {
    value: id,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function getNodeId(x: any): number {
  if (!x || typeof x !== 'object') return 0;
  const existing = (x as any)[STM_NODE_ID];
  if (typeof existing === 'number') return existing;

  stampId(x, x);
  return (x as any)[STM_NODE_ID];
}

/* ================== Iterative wrap ================== */

/**
 * Реально deep-обёртка (итеративная, без рекурсии):
 *  - plain-объекты → по полям (с учётом циклов и шаринга)
 *  - массивы       → по элементам (с учётом циклов и шаринга)
 *  - всё остальное → Signal (leaf)
 *
 * Дополнительно:
 *  - leafMode позволяет сделать plain object и/или array атомарным (одним Signal)
 *  - isLeaf позволяет точечно форсить leaf
 *  - stampIds ставит стабильный numeric id на wrapper’ы
 */
export function wrapItemInSignals<T, M extends LeafMode = 'deep'>(
  root: T,
  onLeaf?: (sg: Signal<any>) => void,
  seen: WrapCache = new WeakMap(),
  modeOrOpts: M | WrapOptions<M> = 'deep' as M
): DeepSignal<T, M> {
  const opts: WrapOptions<M> =
    typeof modeOrOpts === 'string' ? ({ leafMode: modeOrOpts } as WrapOptions<M>) : modeOrOpts;

  const leafMode = (opts.leafMode ?? ('deep' as M)) as M;
  const isLeaf = opts.isLeaf;
  const stamp = opts.stampIds !== false;

  const atomicObj = (leafMode === 'object' || leafMode === 'object+array') as AtomicObj<M>;
  const atomicArr = (leafMode === 'array' || leafMode === 'object+array') as AtomicArr<M>;

  type Frame =
    | { kind: 'array'; src: any[]; out: any[]; i: number }
    | {
        kind: 'object';
        src: Record<string | symbol, any>;
        out: any;
        keys: (string | symbol)[];
        i: number;
      };

  const stack: Frame[] = [];

  const wrapLeaf = (value: any): any => {
    if (value && typeof value === 'object') {
      const cached = seen.get(value as any);
      if (cached) return cached;

      const sg = signal(value);

      if (stamp) stampId(sg as any, value as any);
      onLeaf?.(sg);

      seen.set(value as any, sg);
      return sg;
    }

    const sg = signal(value);
    if (stamp) stampId(sg as any, sg as any);
    onLeaf?.(sg);
    return sg;
  };

  const wrap = (value: any): any => {
    if (isSignalLike(value)) return value;
    if (isWrappedNode(value)) return value;
    if (isLeaf?.(value) === true) return wrapLeaf(value);

    if (Array.isArray(value)) {
      if (atomicArr) return wrapLeaf(value);

      const cached = seen.get(value as any);
      if (cached) return cached;

      const out: any[] = new Array(value.length);
      if (stamp) stampId(out as any, value as any);

      seen.set(value as any, out);
      stack.push({ kind: 'array', src: value, out, i: 0 });
      return out;
    }

    if (value !== null && typeof value === 'object' && isPlainObject(value)) {
      if (atomicObj) return wrapLeaf(value);

      const cached = seen.get(value as any);
      if (cached) return cached;

      const out: any = {};
      if (stamp) stampId(out, value as any);

      seen.set(value as any, out);
      const keys = ownEnumerableKeys(value);
      stack.push({ kind: 'object', src: value, out, keys, i: 0 });
      return out;
    }

    return wrapLeaf(value);
  };

  const rootWrapped = wrap(root);

  while (stack.length) {
    const top = stack[stack.length - 1];

    if (top.kind === 'array') {
      if (top.i >= top.src.length) {
        stack.pop();
        continue;
      }
      const idx = top.i++;
      top.out[idx] = wrap(top.src[idx]);
      continue;
    }

    if (top.i >= top.keys.length) {
      stack.pop();
      continue;
    }
    const k = top.keys[top.i++];
    top.out[k as any] = wrap(top.src[k as any]);
  }

  return rootWrapped as any;
}

/* ================== deepUnwrap ================== */

/**
 * deepUnwrap — утилита для получения "сырого" снимка данных.
 * Снимает Signal-обёртки и рекурсивно раскручивает объект/массив.
 * Поддерживает циклы через WrapCache.
 */
export function deepUnwrap<T>(x: any, seen: WrapCache = new WeakMap()): T {
  if (isSignalLike(x)) {
    return x.v as T;
  }

  if (Array.isArray(x)) {
    if (seen.has(x as any)) return seen.get(x as any) as T;
    const src = x as any[];
    const out: any[] = new Array(src.length);
    seen.set(x as any, out);
    for (let i = 0; i < src.length; i++) {
      out[i] = deepUnwrap(src[i], seen);
    }
    return out as any;
  }

  if (x && typeof x === 'object') {
    if (seen.has(x as any)) return seen.get(x as any) as T;
    const src = x as Record<string | symbol, any>;
    const out: any = {};
    seen.set(x as any, out);
    for (const k of ownEnumerableKeys(src)) {
      out[k as any] = deepUnwrap((src as any)[k], seen);
    }
    return out;
  }

  return x as T;
}

/* ==================== SignalMap ===================== */

export function isWrappedNode(x: any): boolean {
  return !!(x && typeof x === 'object' && (x as any)[STM_NODE_ID] != null);
}

export class SignalMap<T, M extends LeafMode = 'deep'> extends Signal<
  ReadonlyArray<DeepSignal<T, M>>
> {
  private onLeaf?: (sg: Signal<any>) => void;
  private nodeCache?: WrapCache;
  private wrapOpts: WrapOptions<M>;

  /** Пользовательский key-функционал (вне React используем PropertyKey). */
  public itemKey?: (item: DeepSignal<T, M>, index: number) => PropertyKey;

  private assign(next: DeepSignal<T, M>[]) {
    this.v = freezeDev(next);
  }

  /**
   * @param initial   начальный массив значений (можно readonly)
   * @param onLeaf    коллбек для каждого создаваемого "листового" Signal
   * @param nodeCache общий WrapCache (WeakMap<object, unknown>) для кеширования обёрток.
   * @param wrapModeOrOpts leafMode строкой или WrapOptions объектом
   */
  constructor(
    initial: readonly T[] = [],
    onLeaf?: (sg: Signal<any>) => void,
    nodeCache?: WrapCache,
    wrapModeOrOpts: M | WrapOptions<M> = 'deep' as M
  ) {
    const wrapOpts: WrapOptions<M> =
      typeof wrapModeOrOpts === 'string'
        ? ({ leafMode: wrapModeOrOpts } as WrapOptions<M>)
        : wrapModeOrOpts;

    super(
      initial.map((item) =>
        nodeCache
          ? wrapItemInSignals<T, M>(item, onLeaf, nodeCache, wrapOpts)
          : wrapItemInSignals<T, M>(item, onLeaf, new WeakMap(), wrapOpts)
      )
    );

    this.onLeaf = onLeaf;
    this.nodeCache = nodeCache;
    this.wrapOpts = wrapOpts;
  }

  /* ---------- id helpers ---------- */
  private mutate<R>(fn: () => R): R {
    return untracked(fn);
  }

  /** Stable numeric id для элемента (React-key / effectEach-key) */
  idOf(item: DeepSignal<T, M>): number {
    return getNodeId(item as any);
  }

  /** дефолтный key fn (если нет itemKey) */
  keyOf = (item: DeepSignal<T, M>, index: number): number => {
    const id = this.idOf(item);
    return id || index;
  };

  /* ---------- базовые удобства ---------- */

  get length(): number {
    return (this.v ?? []).length;
  }

  at(index: number): DeepSignal<T, M> | undefined {
    return this.mutate(() => {
      const arr = this.v ?? [];
      const i = index < 0 ? arr.length + index : index;
      return arr[i];
    });
  }

  toArray(): DeepSignal<T, M>[] {
    return (this.v ?? []).slice();
  }

  toJSON(): T[] {
    return this.toArray().map((it) => deepUnwrap<T>(it));
  }

  *[Symbol.iterator](): IterableIterator<DeepSignal<T, M>> {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      yield arr[i];
    }
  }

  forEach(
    fn: (item: DeepSignal<T, M>, index: number, array: ReadonlyArray<DeepSignal<T, M>>) => void
  ): void {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) fn(arr[i], i, arr);
  }

  map<U>(
    fn: (item: DeepSignal<T, M>, index: number, array: ReadonlyArray<DeepSignal<T, M>>) => U
  ): U[] {
    const arr = this.v ?? [];
    const res: U[] = [];
    for (let i = 0; i < arr.length; i++) res.push(fn(arr[i], i, arr));
    return res;
  }

  some(
    fn: (item: DeepSignal<T, M>, index: number, array: ReadonlyArray<DeepSignal<T, M>>) => boolean
  ): boolean {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) if (fn(arr[i], i, arr)) return true;
    return false;
  }

  every(
    predicate: (
      item: DeepSignal<T, M>,
      index: number,
      array: ReadonlyArray<DeepSignal<T, M>>
    ) => boolean
  ): boolean {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) if (!predicate(arr[i], i, arr)) return false;
    return true;
  }

  find(
    predicate: (
      item: DeepSignal<T, M>,
      index: number,
      array: ReadonlyArray<DeepSignal<T, M>>
    ) => boolean
  ): DeepSignal<T, M> | undefined {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) if (predicate(arr[i], i, arr)) return arr[i];
    return undefined;
  }

  /* ================= effects ================= */

  effectMap(
    fn: (item: DeepSignal<T, M>, index: number, array: ReadonlyArray<DeepSignal<T, M>>) => void,
    priority: Priority = 'normal'
  ): Effect {
    return effect(() => {
      const arr = this.v ?? [];
      for (let i = 0; i < arr.length; i++) fn(arr[i], i, arr);
    }, priority);
  }

  effectEach<K extends PropertyKey>(
    getKey: (item: DeepSignal<T, M>, index: number) => K,
    fn: (item: DeepSignal<T, M>, index: number) => void | (() => void),
    priority: Priority = 'normal'
  ): Effect {
    type Rec = { eff: Effect; item: DeepSignal<T, M> };
    const effects = new Map<K, Rec>();
    const self = this;

    const indexByRef = computed(() => {
      const arr = self.v ?? [];
      const m = new Map<DeepSignal<T, M>, number>();
      for (let i = 0; i < arr.length; i++) m.set(arr[i], i);
      return m;
    });

    const getIndex = (itemRef: DeepSignal<T, M>) => indexByRef.v.get(itemRef) ?? -1;

    const outer = effect(() => {
      const arr = self.v ?? [];
      const nextKeys = new Set<K>();

      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const key = getKey(item, i);

        if (nextKeys.has(key)) {
          const p: any = typeof process !== 'undefined' ? process : undefined;
          if (p?.env?.NODE_ENV !== 'production') {
            console.warn('[signalMap.effectEach] duplicate key:', key);
          }
          continue;
        }
        nextKeys.add(key);

        const rec = effects.get(key);
        const sameItem = rec && rec.item === item;

        if (!rec || !sameItem) {
          rec?.eff.dispose();

          const currentItem = item;
          const child = effect(() => {
            const idx = getIndex(currentItem);
            const cleanup = fn(currentItem, idx);
            return cleanup;
          }, priority);

          effects.set(key, { eff: child, item: currentItem });
        }
      }

      for (const [key, rec] of effects) {
        if (!nextKeys.has(key)) {
          rec.eff.dispose();
          effects.delete(key);
        }
      }
    }, priority);

    const origDispose = outer.dispose.bind(outer);
    outer.dispose = () => {
      for (const { eff } of effects.values()) eff.dispose();
      effects.clear();
      (indexByRef as any).dispose?.();
      origDispose();
    };

    return outer;
  }

  /* ================= mutations ================= */

  private wrap(value: T): DeepSignal<T, M> {
    return this.nodeCache
      ? wrapItemInSignals<T, M>(value, this.onLeaf, this.nodeCache, this.wrapOpts)
      : wrapItemInSignals<T, M>(value, this.onLeaf, new WeakMap(), this.wrapOpts);
  }

  moveById(
    fromId: PropertyKey,
    targetId: PropertyKey | null,
    rel: number = 0,
    key: Extract<keyof T, PropertyKey> = 'id' as any
  ): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      const len = arr.length;
      if (!len) return;

      const readKey = (item: DeepSignal<T, M>): PropertyKey | undefined => {
        const base = isSignalLike(item) ? (item as any).v : (item as any);
        const raw = base?.[key];
        return isSignalLike(raw) ? (raw as any).v : raw;
      };

      const fromIndex = arr.findIndex((it) => readKey(it) === fromId);
      if (fromIndex === -1) return;

      if (targetId == null) {
        if (len <= 1) return;
        this.move(fromIndex, len - 1, 1);
        return;
      }

      const toIndex = arr.findIndex((it) => readKey(it) === targetId);
      if (toIndex === -1) {
        if (len <= 1) return;
        this.move(fromIndex, len - 1, 1);
        return;
      }

      this.move(fromIndex, toIndex, rel);
    });
  }

  move(from: number, to: number, rel: number = 0): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      const len = arr.length;
      if (len < 2) return;
      if (from < 0 || from >= len) return;
      if (to < 0 || to >= len) return;

      if (rel === 0) {
        if (from === to) return;
        const next = arr.slice();
        [next[from], next[to]] = [next[to], next[from]];
        this.assign(next);
        return;
      }

      const next = arr.slice();
      const [item] = next.splice(from, 1);

      let dest = rel < 0 ? to + rel + 1 : to + rel;
      if (from < dest) dest--;
      dest = Math.max(0, Math.min(dest, next.length));

      next.splice(dest, 0, item);
      this.assign(next);
    });
  }
  removeRef(item: DeepSignal<T, M>): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      const idx = arr.indexOf(item);
      if (idx === -1) return;
      this.removeAt(idx);
    });
  }
  push(...items: T[]): number {
    return this.mutate(() => {
      const arr = this.v ?? [];
      if (!items.length) return arr.length;

      const next = arr.slice();
      for (const item of items) next.push(this.wrap(item));
      this.assign(next);
      return next.length;
    });
  }

  unshift(...items: T[]): number {
    return this.mutate(() => {
      const arr = this.v ?? [];
      if (!items.length) return arr.length;

      const next = arr.slice();
      for (let i = items.length - 1; i >= 0; i--) {
        next.unshift(this.wrap(items[i]));
      }
      this.assign(next);
      return next.length;
    });
  }

  pop(): DeepSignal<T, M> | undefined {
    return this.mutate(() => {
      const arr = this.v ?? [];
      if (!arr.length) return undefined;

      const next = arr.slice();
      const res = next.pop();
      this.assign(next);
      return res;
    });
  }

  shift(): DeepSignal<T, M> | undefined {
    return this.mutate(() => {
      const arr = this.v ?? [];
      if (!arr.length) return undefined;

      const next = arr.slice();
      const res = next.shift();
      this.assign(next);
      return res;
    });
  }

  splice(start: number, deleteCount?: number, ...items: T[]): DeepSignal<T, M>[] {
    return this.mutate(() => {
      const arr = this.v ?? [];
      const next = arr.slice();

      const len = next.length;
      const from = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
      const dc =
        deleteCount === undefined ? len - from : Math.max(0, Math.min(deleteCount, len - from));

      const wrapped = items.map((item) => this.wrap(item));
      const removed = next.splice(from, dc, ...wrapped);

      this.assign(next);
      return removed;
    });
  }

  sort(compareFn?: (a: DeepSignal<T, M>, b: DeepSignal<T, M>) => number): this {
    return this.mutate(() => {
      const arr = this.v ?? [];
      const next = arr.slice().sort(compareFn as any);
      if (arr.length === next.length && arr.every((x, i) => x === next[i])) return this;
      this.assign(next);
      return this;
    });
  }

  reverse(): this {
    return this.mutate(() => {
      const arr = this.v ?? [];
      const next = arr.slice().reverse();
      this.assign(next);
      return this;
    });
  }

  setAt(index: number, updater: (item: DeepSignal<T, M>) => void): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      if (!arr[index]) return;
      updater(arr[index]);
      this.assign(arr.slice());
    });
  }

  replaceAt(index: number, value: T): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      if (!arr[index]) return;

      const wrapped = this.wrap(value);
      if (arr[index] === wrapped) return;

      const next = arr.slice();
      next[index] = wrapped;
      this.assign(next);
    });
  }

  with(index: number, value: T): this {
    return this.mutate(() => {
      const arr = this.v ?? [];
      if (index < 0 || index >= arr.length) return this;

      const wrapped = this.wrap(value);
      if (arr[index] === wrapped) return this;

      const next = arr.slice();
      next[index] = wrapped;
      this.assign(next);
      return this;
    });
  }

  insertAt(index: number, value: T): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      let idx = index | 0;
      if (idx < 0) idx = 0;
      if (idx > arr.length) idx = arr.length;

      const wrapped = this.wrap(value);
      const next = arr.slice();
      next.splice(idx, 0, wrapped);
      this.assign(next);
    });
  }

  removeAt(index: number): DeepSignal<T, M> | undefined {
    return this.mutate(() => {
      const arr = this.v ?? [];
      if (index < 0 || index >= arr.length) return undefined;

      const next = arr.slice();
      const [removed] = next.splice(index, 1);
      this.assign(next);
      return removed;
    });
  }

  findIndex(
    predicate: (
      item: DeepSignal<T, M>,
      index: number,
      array: ReadonlyArray<DeepSignal<T, M>>
    ) => boolean
  ): number {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) if (predicate(arr[i], i, arr)) return i;
    return -1;
  }

  filterInPlace(
    predicate: (
      item: DeepSignal<T, M>,
      index: number,
      array: ReadonlyArray<DeepSignal<T, M>>
    ) => boolean
  ): void {
    this.mutate(() => {
      const arr = this.v ?? [];
      const next: DeepSignal<T, M>[] = [];
      for (let i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i, arr)) next.push(arr[i]);
      }
      if (next.length !== arr.length) this.assign(next);
    });
  }

  clear(): void {
    this.mutate(() => {
      if ((this.v ?? []).length === 0) return;
      this.assign([]);
    });
  }

  replaceAll(items: readonly T[]): void {
    this.mutate(() => {
      const curr = this.v ?? [];
      const next = items.map((item) => this.wrap(item));
      if (curr.length === next.length && curr.every((x, i) => x === next[i])) return;
      this.assign(next);
    });
  }
}

/* ================ фабрика ================= */

/**
 * signalMap:
 *  - initial   — массив значений
 *  - onLeaf    — коллбек на каждый leaf Signal
 *  - nodeCache — общий WrapCache для сохранения identity обёрток
 *  - wrapModeOrOpts — LeafMode или WrapOptions
 */

export function signalMap<T, M extends LeafMode = 'deep'>(
  initial: readonly T[],
  onLeaf: ((sg: Signal<any>) => void) | undefined,
  nodeCache: WrapCache | undefined,
  wrapMode: M
): SignalMap<T, M>;

export function signalMap<T, M extends LeafMode = 'deep'>(
  initial: readonly T[],
  onLeaf: ((sg: Signal<any>) => void) | undefined,
  nodeCache: WrapCache | undefined,
  wrapOpts: WrapOptions<M> & { leafMode: M }
): SignalMap<T, M>;

/** implementation (единственная!) */
export function signalMap<T, M extends LeafMode = 'deep'>(
  initial: readonly T[] = [],
  onLeaf?: (sg: Signal<any>) => void,
  nodeCache?: WrapCache,
  wrapModeOrOpts?: M | (WrapOptions<M> & { leafMode?: M })
): SignalMap<T, any> {
  const arg = (wrapModeOrOpts ?? 'deep') as any;
  return new SignalMap<any, any>(initial, onLeaf, nodeCache, arg);
}
