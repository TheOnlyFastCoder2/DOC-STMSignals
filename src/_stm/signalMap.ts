// signalMap.ts — слой поверх ядра v6.3.5

import { Signal, signal, effect, Effect, computed, flushSync } from './index'; // поправь путь при необходимости

// Если Priority не экспортируется из core — продублируй локально:
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
 * Массивы T[] сюда НЕ входят — их рассматриваем как контейнер.
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
 *
 *   class Foo { x = 1 }
 *   type X = DeepSignal<Leaf<Foo>>; // Signal<Foo>
 *
 * Важно: это только типовая метка. Рантайм по-прежнему опирается на
 * isPlainObject/Array/Builtin. Для кастомных классов это совпадает:
 *  - прототип не Object.prototype → рантайм и так считает их листом.
 */
export type Leaf<T> = T & { readonly __asLeaf: unique symbol };
export const asLeaf = <T>(x: T): Leaf<T> => x as Leaf<T>;

/**
 * DeepSignal:
 *  - Leaf<*>           → Signal<base> (Leaf сдирается)
 *  - Builtin           → Signal<T>
 *  - ReadonlyArray<U>  → ReadonlyArray<DeepSignal<U>>
 *  - plain-объекты     → { [K]: DeepSignal<T[K]> }
 *  - всё остальное     → Signal<T>
 */
export type DeepSignal<T> =
  T extends Leaf<infer U>
    ? Signal<U>
    : T extends Builtin
      ? Signal<T>
      : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<DeepSignal<U>>
        : T extends object
          ? { [K in keyof T]: DeepSignal<T[K]> }
          : Signal<T>;

/** Кеш обёрток: ключ — исходный объект/массив, значение — что угодно. */
type WrapCache = WeakMap<object, unknown>;

/* ================== Helpers ================== */

function isPlainObject(value: unknown): value is Record<string, any> {
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
  //@ts-expect-error
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
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

/**
 * Реально deep-обёртка:
 *  - plain-объекты → рекурсивно по полям (с учётом циклов и шаринга)
 *  - массивы       → рекурсивно по элементам (с учётом циклов и шаринга)
 *  - всё остальное (Builtin / классы) → единичный Signal (лист)
 *
 * Важно: `seen` сохраняет shared-refs — один и тот же объект/массив, встречающийся
 * в нескольких местах, будет делить одни и те же внутренние сигналы.
 *
 * При желании сохранить идентичность обёрток между разными операциями
 * (replaceAll/replaceAt) можно передать общий WrapCache в seen.
 *
 * WeakMap не удерживает ключи → утечек памяти не создаёт.
 */
export function wrapItemInSignals<T>(
  item: T,
  onLeaf?: (sg: Signal<any>) => void,
  seen: WrapCache = new WeakMap()
): DeepSignal<T> {
  // ---- массив (с поддержкой шаринга и циклов)
  if (Array.isArray(item)) {
    if (seen.has(item as any)) return seen.get(item as any) as any;
    const src = item as any[];
    const out: any[] = new Array(src.length);
    seen.set(item as any, out);
    for (let i = 0; i < src.length; i++) {
      out[i] = wrapItemInSignals(src[i], onLeaf, seen);
    }
    return out as any;
  }

  // ---- plain object
  if (item !== null && typeof item === 'object' && isPlainObject(item)) {
    const obj = item as Record<string, any>;
    if (seen.has(obj)) return seen.get(obj) as any;
    const out: any = {};
    seen.set(obj, out);
    for (const key of ownEnumerableKeys(obj)) {
      out[key as any] = wrapItemInSignals((obj as any)[key], onLeaf, seen);
    }
    return out;
  }

  // ---- лист
  const sg = signal(item as any);
  onLeaf?.(sg);
  return sg as any;
}

/**
 * deepUnwrap — утилита для получения "сырого" снимка данных.
 * Снимает Signal-обёртки и рекурсивно раскручивает объект/массив.
 * Поддерживает циклы через WrapCache.
 */
export function deepUnwrap<T>(x: DeepSignal<T>, seen: WrapCache = new WeakMap()): T {
  if (isSignalLike(x)) {
    return (x as any).v as T;
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
    const src = x as Record<string, any>;
    const out: any = {};
    seen.set(x as any, out);
    for (const k of ownEnumerableKeys(src)) {
      out[k as any] = deepUnwrap((src as any)[k], seen);
    }
    return out;
  }

  return x as any;
}

/* ==================== SignalMap ===================== */

export class SignalMap<T> extends Signal<ReadonlyArray<DeepSignal<T>>> {
  private onLeaf?: (sg: Signal<any>) => void;
  /** Опциональный кеш для сохранения обёрток между операциями (wrap identity). */
  private nodeCache?: WrapCache;

  private assign(next: DeepSignal<T>[]) {
    this.v = freezeDev(next);
  }

  /**
   * @param initial   начальный массив значений (можно readonly)
   * @param onLeaf    коллбек для каждого создаваемого "листового" Signal
   * @param nodeCache общий WrapCache (WeakMap<object, unknown>) для кеширования обёрток.
   *                  WeakMap не удерживает ключи → утечек памяти не создаёт.
   *                  Влияет только на идентичность обёрток между операциями,
   *                  а не на сами данные.
   */
  constructor(
    initial: readonly T[] = [],
    onLeaf?: (sg: Signal<any>) => void,
    nodeCache?: WrapCache
  ) {
    super(
      initial.map((item) =>
        nodeCache ? wrapItemInSignals(item, onLeaf, nodeCache) : wrapItemInSignals(item, onLeaf)
      )
    );
    this.onLeaf = onLeaf;
    this.nodeCache = nodeCache;
  }

  /* ---------- базовые удобства ---------- */

  get length(): number {
    return (this.v ?? []).length;
  }

  at(index: number): DeepSignal<T> | undefined {
    const arr = this.v ?? [];
    const i = index < 0 ? arr.length + index : index;
    return arr[i];
  }

  toArray(): DeepSignal<T>[] {
    return (this.v ?? []).slice();
  }

  /**
   * Удобно для JSON / логирования:
   * JSON.stringify(list) → чистые данные без Signal-обёрток.
   */
  toJSON(): T[] {
    return this.toArray().map((it) => deepUnwrap(it));
  }

  /** Позволяет `for..of` по списку: for (const item of list) { ... } */
  *[Symbol.iterator](): IterableIterator<DeepSignal<T>> {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      yield arr[i];
    }
  }

  forEach(
    fn: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => void
  ): void {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      fn(arr[i], i, arr);
    }
  }

  map<U>(fn: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => U): U[] {
    const arr = this.v ?? [];
    const res: U[] = [];
    for (let i = 0; i < arr.length; i++) {
      res.push(fn(arr[i], i, arr));
    }
    return res;
  }

  some(
    fn: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => boolean
  ): boolean {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      if (fn(arr[i], i, arr)) return true;
    }
    return false;
  }

  every(
    predicate: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => boolean
  ): boolean {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      if (!predicate(arr[i], i, arr)) return false;
    }
    return true;
  }

  find(
    predicate: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => boolean
  ): DeepSignal<T> | undefined {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      if (predicate(arr[i], i, arr)) return arr[i];
    }
    return undefined;
  }

  /**
   * effectMap — простой "проход по списку" без индивидуальных cleanup'ов.
   * Если нужен lifecycle по элементам — см. effectEach().
   */
  effectMap(
    fn: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => void,
    priority: Priority = 'normal'
  ): Effect {
    return effect(() => {
      const arr = this.v ?? [];
      for (let i = 0; i < arr.length; i++) {
        fn(arr[i], i, arr);
      }
    }, priority);
  }

  /**
   * effectEach — keyed-вариант с полноценным lifecycle'ом на элемент.
   *
   * Рекомендация: ключ должен быть стабильным примитивом (id, строка, число).
   * Если id — сигнал, читаем именно .v:
   *
   *   list.effectEach(item => (item as any).id.v, (it, idx) => { ... })
   *
   * Гарантии:
   *  - при замене элемента *с тем же ключом* старый Effect диспоузится и создаётся новый;
   *  - при реордере индекс, передаваемый в fn, всегда актуальный;
   *  - на дубликат ключа в дев-режиме будет warning;
   *  - dispose() у outer-эффекта каскадно гасит всех дочерних эффектов
   *    и computed indexByRef тоже диспоузится, если ядро его поддерживает.
   */
  effectEach<K extends PropertyKey>(
    getKey: (item: DeepSignal<T>, index: number) => K,
    fn: (item: DeepSignal<T>, index: number) => void | (() => void),
    priority: Priority = 'normal'
  ): Effect {
    type Rec = { eff: Effect; item: DeepSignal<T> };
    const effects = new Map<K, Rec>();
    const self = this;

    // Реактивная карта "обёртка → индекс", обновляется раз в проход.
    const indexByRef = computed(() => {
      const arr = self.v ?? [];
      const m = new Map<DeepSignal<T>, number>();
      for (let i = 0; i < arr.length; i++) m.set(arr[i], i);
      return m;
    });

    const getIndex = (itemRef: DeepSignal<T>) => indexByRef.v.get(itemRef) ?? -1;

    const outer = effect(() => {
      const arr = self.v ?? [];
      const nextKeys = new Set<K>();

      // создать/обновить
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const key = getKey(item, i);

        if (nextKeys.has(key)) {
          //@ts-expect-error
          if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            console.warn('[signalMap.effectEach] duplicate key:', key);
          }
          continue;
        }
        nextKeys.add(key);

        const rec = effects.get(key);
        const sameItem = rec && rec.item === item;

        if (!rec || !sameItem) {
          // новый элемент с ключом или подмена по тому же ключу
          rec?.eff.dispose();
          const currentItem = item;
          const child = effect(() => {
            const idx = getIndex(currentItem);
            const cleanup = fn(currentItem, idx);
            return cleanup;
          }, priority);
          effects.set(key, { eff: child, item: currentItem });
        }
        // если item тот же — ничего не делаем, эффект остаётся привязан к тем же сигналам
      }

      // удалить ушедших
      for (const [key, rec] of effects) {
        if (!nextKeys.has(key)) {
          rec.eff.dispose();
          effects.delete(key);
        }
      }
    }, priority);

    // каскадный dispose: при dispose outer → гасим всех детей + indexByRef
    const origDispose = outer.dispose.bind(outer);
    outer.dispose = () => {
      for (const { eff } of effects.values()) eff.dispose();
      effects.clear();

      // если у computed есть dispose() в ядре — приберём за собой
      (indexByRef as any).dispose?.();

      origDispose();
    };

    return outer;
  }

  /* ---------- мутирующие операции (с копированием массива) ---------- */

  private wrap(value: T): DeepSignal<T> {
    return this.nodeCache
      ? wrapItemInSignals(value, this.onLeaf, this.nodeCache)
      : wrapItemInSignals(value, this.onLeaf);
  }

  move(from: number, to: number): void {
    const arr = this.v ?? [];
    const len = arr.length;
    if (from < 0 || from >= len || to < 0 || to >= len || from === to) return;
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    this.assign(next);
  }

  moveById(fromId: string, beforeId: string | null): void {
    const arr = this.v ?? [];
    if (!arr.length) return;

    const getId = (item: any): string | undefined => item?.id?.v;

    const fromIndex = arr.findIndex((item) => getId(item) === fromId);
    if (fromIndex === -1) return;

    let toIndex: number;

    if (beforeId == null) {
      toIndex = arr.length - 1;
    } else {
      const idx = arr.findIndex((item) => getId(item) === beforeId);
      toIndex = idx === -1 ? arr.length - 1 : idx;
    }

    this.move(fromIndex, toIndex);
  }

  push(...items: T[]): number {
    const arr = this.v ?? [];
    if (!items.length) return arr.length;
    const next = arr.slice();
    for (const item of items) {
      next.push(this.wrap(item));
    }
    this.assign(next);
    return next.length;
  }

  unshift(...items: T[]): number {
    const arr = this.v ?? [];
    if (!items.length) return arr.length;
    const next = arr.slice();
    for (let i = items.length - 1; i >= 0; i--) {
      next.unshift(this.wrap(items[i]));
    }
    this.assign(next);
    return next.length;
  }

  pop(): DeepSignal<T> | undefined {
    const arr = this.v ?? [];
    if (!arr.length) return undefined;
    const next = arr.slice();
    const res = next.pop();
    this.assign(next);
    return res;
  }

  shift(): DeepSignal<T> | undefined {
    const arr = this.v ?? [];
    if (!arr.length) return undefined;
    const next = arr.slice();
    const res = next.shift();
    this.assign(next);
    return res;
  }

  splice(start: number, deleteCount?: number, ...items: T[]): DeepSignal<T>[] {
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
  }

  sort(compareFn?: (a: DeepSignal<T>, b: DeepSignal<T>) => number): this {
    const arr = this.v ?? [];
    const next = arr.slice().sort(compareFn as any);
    if (arr.length === next.length && arr.every((x, i) => x === next[i])) return this;
    this.assign(next);
    return this;
  }

  reverse(): this {
    const arr = this.v ?? [];
    const next = arr.slice().reverse();
    this.assign(next);
    return this;
  }

  /* ---------- точечные апдейты / утилиты ---------- */

  /**
   * Обновить существующий элемент без пересборки его внутренних сигналов.
   * Подписчики на сам список (итерация/length) всё равно увидят новую ссылку.
   */
  setAt(index: number, updater: (item: DeepSignal<T>) => void): void {
    const arr = this.v ?? [];
    if (!arr[index]) return;
    updater(arr[index]);
    this.assign(arr.slice());
  }

  /**
   * Полностью заменить элемент новым значением (с новой обёрткой).
   * При наличии nodeCache для одного и того же объекта будут возвращаться
   * те же обёртки (где это возможно).
   */
  replaceAt(index: number, value: T): void {
    const arr = this.v ?? [];
    if (!arr[index]) return;
    const wrapped = this.wrap(value);
    if (arr[index] === wrapped) return; // ничего не поменялось
    const next = arr.slice();
    next[index] = wrapped;
    this.assign(next);
  }

  /** Иммутабельный апдейт в стиле Array.prototype.with. */
  with(index: number, value: T): this {
    const arr = this.v ?? [];
    if (index < 0 || index >= arr.length) return this;
    const wrapped = this.wrap(value);
    if (arr[index] === wrapped) return this;
    const next = arr.slice();
    next[index] = wrapped;
    this.assign(next);
    return this;
  }

  insertAt(index: number, value: T): void {
    const arr = this.v ?? [];
    let idx = index | 0;
    if (idx < 0) idx = 0;
    if (idx > arr.length) idx = arr.length;
    const wrapped = this.wrap(value);
    const next = arr.slice();
    next.splice(idx, 0, wrapped);
    this.assign(next);
  }

  removeAt(index: number): DeepSignal<T> | undefined {
    const arr = this.v ?? [];
    if (index < 0 || index >= arr.length) return undefined;
    const next = arr.slice();
    const [removed] = next.splice(index, 1);
    this.assign(next);
    return removed;
  }

  findIndex(
    predicate: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => boolean
  ): number {
    const arr = this.v ?? [];
    for (let i = 0; i < arr.length; i++) {
      if (predicate(arr[i], i, arr)) return i;
    }
    return -1;
  }

  /**
   * Логически: "filter + пересборка списка".
   * Название слегка «in-place» по смыслу коллекции, но не по ссылке массива.
   */
  filterInPlace(
    predicate: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => boolean
  ): void {
    const arr = this.v ?? [];
    const next: DeepSignal<T>[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (predicate(item, i, arr)) next.push(item);
    }
    if (next.length !== arr.length) {
      this.assign(next);
    }
  }

  /** Полностью очистить список. */
  clear(): void {
    if ((this.v ?? []).length === 0) return;
    this.assign([]);
  }

  /**
   * Заменить весь список новым массивом значений T.
   * При наличии nodeCache будут переиспользованы обёртки для уже известных объектов.
   */
  replaceAll(items: readonly T[]): void {
    const curr = this.v ?? [];
    const next = items.map((item) => this.wrap(item));
    if (curr.length === next.length && curr.every((x, i) => x === next[i])) return;
    this.assign(next);
  }
}

/* ================ фабрика ================= */

/**
 * Удобная фабрика:
 *  - initial   — начальный массив (можно readonly),
 *  - onLeaf    — коллбек для каждого листового Signal,
 *  - nodeCache — общий WrapCache для кеширования обёрток (опционально).
 */
export const signalMap = <T>(
  initial: readonly T[] = [],
  onLeaf?: (sg: Signal<any>) => void,
  nodeCache?: WrapCache
) => new SignalMap<T>(initial, onLeaf, nodeCache);
