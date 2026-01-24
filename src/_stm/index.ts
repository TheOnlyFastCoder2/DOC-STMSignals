// ──────────────────────────────────────────────
// v6.3.5 — Reactive Core + Adaptive Phased Scheduler (prod-ready)
// ──────────────────────────────────────────────

/* =============== Strict SSR polyfills =============== */
if (typeof globalThis.performance === 'undefined') {
  (globalThis as any).performance = { now: () => Date.now() };
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16);
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
}

/* ================= Visibility + HMR guards =================== */

// 1) HMR: “поколение” планировщика. Старые runFrame перестают жить.
const __STM_SCHED_GEN_KEY__ = '__stm_sched_gen_v635__';
const __stmGen = ((globalThis as any)[__STM_SCHED_GEN_KEY__] =
  ((globalThis as any)[__STM_SCHED_GEN_KEY__] ?? 0) + 1);

const isStaleScheduler = () => (globalThis as any)[__STM_SCHED_GEN_KEY__] !== __stmGen;

// 2) Visibility: не гоняем RAF, когда вкладка скрыта
let isDocVisible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';

// 3) Один visibility handler на всё приложение (чтобы не плодился в HMR)
const __STM_VIS_HANDLER_KEY__ = '__stm_vis_handler_v635__';

function stopRAF() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function maybeStartRAF() {
  if (!isDocVisible) return;
  if (schedulerMode !== 'frame') return;
  if (rafId != null) return;
  if (isStaleScheduler()) return;

  if (queues.high.size || queues.normal.size || queues.low.size) {
    rafId = requestAnimationFrame(runFrame);
  }
}

if (typeof document !== 'undefined') {
  const g = globalThis as any;

  // снимаем старые (после hot reload)
  if (g[__STM_VIS_HANDLER_KEY__]) {
    document.removeEventListener('visibilitychange', g[__STM_VIS_HANDLER_KEY__]);
    window.removeEventListener('pagehide', g[__STM_VIS_HANDLER_KEY__]);
  }

  g[__STM_VIS_HANDLER_KEY__] = () => {
    isDocVisible = document.visibilityState === 'visible';

    if (!isDocVisible) {
      stopRAF();
      return;
    }
    // вернулись на вкладку
    maybeStartRAF();
  };

  document.addEventListener('visibilitychange', g[__STM_VIS_HANDLER_KEY__], {
    passive: true,
  } as any);
  // полезно для bfcache / ухода со страницы
  window.addEventListener('pagehide', g[__STM_VIS_HANDLER_KEY__], { passive: true } as any);
}

/* ======================== Types ====================== */

type Priority = 'high' | 'normal' | 'low';
type Phase = 'update' | 'commit' | 'idle';
export type ErrorWhere = 'effect' | 'computed';
export type ErrorSnapshot = { __stmError: unknown };

/* ================= Safe onError hook ================= */

// важно: при одинаковой ошибке возвращаем один и тот же объект (иначе лишние ререндеры)
const _errCache = new WeakMap<object, { err: unknown; snap: ErrorSnapshot }>();
const STM_ERROR_ORIGIN = Symbol('stm.error.origin');

let onErrorHook: ((e: unknown, where: ErrorWhere) => void) | null = null;
export function onError(fn: (e: unknown, where: ErrorWhere) => void) {
  onErrorHook = fn;
}
function safeOnError(e: unknown, where: ErrorWhere): boolean {
  if (!onErrorHook) return false;
  try {
    onErrorHook(e, where);
    return true;
  } catch {
    return false;
  }
}

/* ================= Reactive context ================== */
let currentContext: Computed | Effect | undefined;

/* ================= Logical batching ================== */
let batchedEffects: Set<Effect> | null = null;

/* ================= Scheduler state =================== */
const queues = {
  high: new Set<Effect>(),
  normal: new Set<Effect>(),
  low: new Set<Effect>(),
};
let rafId: number | null = null;
let phase: Phase = 'idle';
let frameCount = 0;

/* ---- Adaptive budgets (after HIGH) ---- */
const TARGET_FRAME_MS = 16.6;
let normalBudgetMs = 7.0;
let lowBudgetMs = 3.5;
const MIN_NORMAL_BUDGET = 3.0,
  MAX_NORMAL_BUDGET = 10.0;
const MIN_LOW_BUDGET = 1.0,
  MAX_LOW_BUDGET = 6.0;
let ewmaFrame = 16.6;
const EWMA_ALPHA = 0.12;

/* ---- Low starvation guard ---- */
let framesSinceLow = 0;
const LOW_FORCE_EVERY_N_FRAMES = 6;

/* ---- Intra-frame HIGH bump ---- */
const HIGH_BURST_LIMIT = 2;

type SchedulerMode = 'frame' | 'sync';
let schedulerMode: SchedulerMode = 'frame';

export function setSchedulerMode(mode: SchedulerMode) {
  if (schedulerMode === mode) return;
  schedulerMode = mode;

  if (mode === 'sync') {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    const all = new Set<Effect>();
    queues.high.forEach((e) => all.add(e));
    queues.normal.forEach((e) => all.add(e));
    queues.low.forEach((e) => all.add(e));
    queues.high.clear();
    queues.normal.clear();
    queues.low.clear();

    all.forEach((e) => scheduleSyncEffect(e));
  }
}

let syncQueue: Set<Effect> | null = null;
let isRunningSyncQueue = false;

function scheduleSyncEffect(eff: Effect) {
  if (eff.isDisposed) return;

  if (!syncQueue) syncQueue = new Set();
  syncQueue.add(eff);

  if (isRunningSyncQueue) return; // уже крутится, просто добавили

  isRunningSyncQueue = true;
  try {
    while (syncQueue.size) {
      const it = syncQueue.values().next().value as Effect;
      syncQueue.delete(it);
      if (!it.isDisposed && it._dirty) it.run();
    }
  } finally {
    isRunningSyncQueue = false;
    syncQueue = null;
  }
}

/* ===================== Links ========================= */
export interface Link {
  source: Signal | Computed;
  target: Computed | Effect;
  nextSource?: Link;
  prevSource?: Link;
  nextTarget?: Link;
  prevTarget?: Link;
}

/* ==================== Helpers ======================= */
function adaptBudgets(frameMs: number) {
  ewmaFrame = ewmaFrame * (1 - EWMA_ALPHA) + frameMs * EWMA_ALPHA;
  const over = ewmaFrame - TARGET_FRAME_MS;
  if (over > 1) {
    normalBudgetMs = Math.max(MIN_NORMAL_BUDGET, normalBudgetMs - 0.8);
    lowBudgetMs = Math.max(MIN_LOW_BUDGET, lowBudgetMs - 0.4);
  } else if (over < -1) {
    normalBudgetMs = Math.min(MAX_NORMAL_BUDGET, normalBudgetMs + 0.8);
    lowBudgetMs = Math.min(MAX_LOW_BUDGET, lowBudgetMs + 0.4);
  }
}

function scheduleEffect(eff: Effect) {
  if (eff.isDisposed) return;

  // логическое батчинг выше всего
  if (batchedEffects) {
    batchedEffects.add(eff);
    return;
  }

  // глобальный режим может форсить sync
  const useSync = schedulerMode === 'sync' || eff.mode === 'sync';

  if (useSync) {
    scheduleSyncEffect(eff);
  } else {
    schedule(eff); // твой текущий планировщик с queues + RAF
  }
}

function scheduleRAF() {
  if (rafId != null) return;
  if (schedulerMode !== 'frame') return;
  if (!isDocVisible) return;
  if (isStaleScheduler()) return;
  rafId = requestAnimationFrame(runFrame);
}

function schedule(eff: Effect) {
  queues[eff.priority].add(eff);
  scheduleRAF();
}

function enqueueOrBatch(eff: Effect) {
  scheduleEffect(eff);
}

function scheduleFromBatch(toSchedule: Set<Effect>, requestRaf = true) {
  for (const eff of toSchedule) {
    const useSync = schedulerMode === 'sync' || eff.mode === 'sync';

    if (useSync) {
      scheduleSyncEffect(eff);
    } else {
      queues[eff.priority].add(eff);
    }
  }
  toSchedule.clear();

  if (
    requestRaf &&
    schedulerMode === 'frame' &&
    (queues.high.size || queues.normal.size || queues.low.size)
  ) {
    scheduleRAF();
  }
}

function runHighQueue(limit = Infinity) {
  let handled = 0;
  while (queues.high.size && handled < limit) {
    const it = queues.high.values().next();
    const eff = it.value as Effect;
    queues.high.delete(eff); // delete-before-run
    if (!eff.isDisposed && eff._dirty) eff.run();
    handled++;
  }
}

const CHUNK = 8;
function runPhase(set: Set<Effect>, budgetChecker: () => boolean) {
  while (set.size && budgetChecker()) {
    let i = 0;
    while (i++ < CHUNK && set.size && budgetChecker()) {
      const eff = set.values().next().value as Effect;
      set.delete(eff); // delete-before-run (self-resched safe)
      if (!eff.isDisposed && eff._dirty) eff.run();
    }
  }
}

/* ================== Frame runner ===================== */
export function flushSync() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (batchedEffects) {
    const toSchedule = batchedEffects;
    batchedEffects = null;
    scheduleFromBatch(toSchedule, /*requestRaf*/ false);
  }
  do {
    runHighQueue();
    while (queues.normal.size) runPhase(queues.normal, () => true);
    while (queues.low.size) runPhase(queues.low, () => true);
  } while (queues.high.size || queues.normal.size || queues.low.size);
}

export function runFrame() {
  const frameStartTotal = performance.now();
  rafId = null;

  /* ── HIGH (always, unbudgeted) ───────────────────── */
  phase = 'update';
  updateTelemetry(0, 0, 0);
  runHighQueue();

  /* budgets measured after HIGH */
  let budgetStart = performance.now();
  const haveNormalBudget = () => performance.now() - budgetStart < normalBudgetMs;
  const haveLowBudget = () => performance.now() - budgetStart < normalBudgetMs + lowBudgetMs;

  /* ── NORMAL (budgeted) ───────────────────────────── */
  phase = 'update';
  if (queues.normal.size) {
    runPhase(queues.normal, haveNormalBudget);
  }

  /* ── COMMIT (mid-frame hook) ─────────────────────── */
  phase = 'commit';
  updateTelemetry(performance.now() - budgetStart, performance.now() - frameStartTotal, 0);

  /* ── Intra-frame HIGH bump (bounded) ─────────────── */
  let bursts = 0;
  if (queues.high.size) {
    runHighQueue(HIGH_BURST_LIMIT);
    bursts = 1; // фиксируем факт добора (если делаете цикл — инкрементируйте внутри)
    budgetStart = performance.now(); // перезапускаем бюджет после добора
  }

  /* ── LOW (budgeted or forced) ────────────────────── */
  phase = 'idle';
  const shouldForceLow = framesSinceLow >= LOW_FORCE_EVERY_N_FRAMES;
  if (queues.low.size && (haveLowBudget() || shouldForceLow)) {
    const checker = shouldForceLow ? () => true : haveLowBudget; // при форсе игнорируем бюджет
    runPhase(queues.low, checker);
    framesSinceLow = 0;
  } else if (queues.low.size) {
    framesSinceLow++;
  }

  /* ── Stats & adapt ───────────────────────────────── */
  const frameTotal = performance.now() - frameStartTotal;
  const frameBudgeted = performance.now() - budgetStart;
  frameCount++;
  adaptBudgets(frameTotal);
  updateTelemetry(frameBudgeted, frameTotal, bursts);

  if (queues.high.size || queues.normal.size || queues.low.size) {
    scheduleRAF();
  }
}

/* ================== Telemetry ======================== */
(globalThis as any).__v6stats__ = {
  phase: 'idle' as Phase,
  lastFrameDuration: 0, // time since budgetStart (без первичного HIGH)
  lastFrameTotal: 0, // полный кадр (включая первичный HIGH)
  highBursts: 0, // сколько раз добирали HIGH внутри кадра (здесь 0/1)
  queues: { high: 0, normal: 0, low: 0 },
};
function updateTelemetry(duration: number, total: number, bursts: number) {
  (globalThis as any).__v6stats__ = {
    phase,
    lastFrameDuration: +duration.toFixed(2),
    lastFrameTotal: +total.toFixed(2),
    highBursts: bursts | 0,
    queues: {
      high: queues.high.size,
      normal: queues.normal.size,
      low: queues.low.size,
    },
  };
}

/* ================== Linking utils ==================== */
function linkOnce(source: Signal | Computed, target: Computed | Effect): Link | void {
  if (source === target) return; // no self-link
  (target as any)._depMap ??= new WeakMap<Signal | Computed, Link>();
  const depMap: WeakMap<Signal | Computed, Link> = (target as any)._depMap;

  const existing = depMap.get(source);
  if (existing) return existing;

  const link: Link = { source, target };

  // attach to source._targets
  link.nextTarget = (source as any)._targets;
  if ((source as any)._targets) (source as any)._targets.prevTarget = link;
  (source as any)._targets = link;

  // attach to target._sources
  link.nextSource = (target as any)._sources;
  if ((target as any)._sources) (target as any)._sources.prevSource = link;
  (target as any)._sources = link;

  depMap.set(source, link);
  return link;
}

function unlinkAllSources(t: { _sources?: Link; _depMap?: WeakMap<any, Link> }) {
  let node = t._sources;
  while (node) {
    const next = node.nextSource;
    const src = node.source as any;

    // detach from src._targets
    if (src._targets === node) {
      src._targets = node.nextTarget ?? undefined;
      if (node.nextTarget) node.nextTarget.prevTarget = undefined;
    } else {
      if (node.prevTarget) node.prevTarget.nextTarget = node.nextTarget;
      if (node.nextTarget) node.nextTarget.prevTarget = node.prevTarget;
    }

    // remove mapping from depMap
    t._depMap?.delete(node.source);

    node.nextSource = node.prevSource = node.nextTarget = node.prevTarget = undefined;
    node = next;
  }
  t._sources = undefined;
}

/* ===================== Signal ======================== */
export class Signal<T = any> {
  _value: T;
  _version = 0;
  _targets?: Link;
  private cmp?: (a: T, b: T) => boolean;

  constructor(value: T, equals?: (a: T, b: T) => boolean) {
    this._value = value;
    this.cmp = equals;
  }

  private _setValue(next: T): boolean {
    const equal = this.cmp ? this.cmp(next, this._value) : Object.is(next, this._value);
    if (equal) return false;

    this._value = next;
    this._version++;
    return true;
  }

  get v() {
    const ctx = currentContext;
    if (ctx) linkOnce(this, ctx);
    return this._value;
  }

  get u() {
    return untracked(() => this.v);
  }
  set u(v: T) {
    this._setValue(v);
  }
  set v(v: T) {
    if (!this._setValue(v)) return;

    let node = this._targets;
    while (node) {
      const next = node.nextTarget; // capture next before callback
      node.target.markDirty();
      node = next;
    }
  }
}

/* ==================== Computed ======================= */
export class Computed<T = any> {
  _sources?: Link;
  _targets?: Link;
  _depMap?: WeakMap<Signal | Computed, Link>;
  _dirty = true;
  _value!: T;
  private _computing = false;
  private _hasValue = false;

  // ✅ NEW: error state
  private _hasError = false;
  private _error: unknown = null;

  fn: () => T;

  constructor(fn: () => T) {
    this.fn = fn;
  }

  // ✅ NEW: invalidate targets when state toggles (ok <-> error)
  private _notifyTargets(skip?: Computed | Effect) {
    const targets = this._targets;
    if (!targets) return;

    const outer = !!batchedEffects;
    if (!outer) batchedEffects = new Set();

    for (let n = targets; n; n = n.nextTarget) {
      if (n.target !== skip) n.target.markDirty();
    }

    if (!outer) {
      const toSchedule = batchedEffects!;
      batchedEffects = null;
      scheduleFromBatch(toSchedule, /* requestRaf */ true);
    }
  }

  get v() {
    if (this._dirty) this.recompute();

    // ✅ IMPORTANT: линк ставим ДО throw, иначе зависимость не восстановится
    const ctx = currentContext;
    if (ctx && ctx !== this) linkOnce(this as any, ctx);

    // ✅ propagate error
    if (this._hasError) throw this._error;

    if (!this._hasValue) throw new Error('Computed accessed before first successful compute');
    return this._value;
  }

  recompute() {
    if (this._computing) throw new Error('Computed cycle detected');

    const outerCtx = currentContext;
    const wasErrored = this._hasError;

    unlinkAllSources(this);

    const prev = currentContext;
    currentContext = this;
    this._computing = true;

    try {
      this._dirty = false;

      const next = this.fn();
      this._value = next;
      this._hasValue = true;

      this._hasError = false;
      this._error = null;
    } catch (e) {
      this._dirty = false;
      this._hasError = true;
      this._error = e;

      // ✅ логируем только у "первоисточника"
      let shouldLog = true;
      if (e && typeof e === 'object') {
        const obj = e as any;
        if (obj[STM_ERROR_ORIGIN]) shouldLog = false;
        else obj[STM_ERROR_ORIGIN] = this;
      }
      safeOnError(e, 'computed');

      // ✅ при входе в ошибку — инвалидируем зависимых
      if (!wasErrored) this._notifyTargets(outerCtx as any);
    } finally {
      this._computing = false;
      currentContext = prev;
    }

    // ✅ при выходе из ошибки — тоже инвалидируем зависимых
    if (wasErrored && !this._hasError) {
      this._notifyTargets(outerCtx as any);
    }
  }
  markDirty() {
    if (this._dirty) return;
    this._dirty = true;

    const targets = this._targets;
    const outer = !!batchedEffects;
    if (!outer) batchedEffects = new Set();

    for (let n = targets; n; n = n.nextTarget) n.target.markDirty();

    if (!outer) {
      const toSchedule = batchedEffects!;
      batchedEffects = null;
      scheduleFromBatch(toSchedule, /* requestRaf */ true);
    }
  }
}

/* ===================== Effect ======================== */
export type EffectOptions = { lazy?: boolean };
export type EffectKind = Priority | 'sync';
export type EffectMode = 'frame' | 'sync';

export class Effect {
  _sources?: Link;
  _depMap?: WeakMap<Signal | Computed, Link>;
  _dirty = true;
  private fn: () => void | (() => void);
  private disposeFn?: () => void;
  isDisposed = false;
  private _running = false;
  priority: Priority;
  mode: EffectMode;

  constructor(
    fn: () => void | (() => void),
    priorityOrMode: EffectKind = 'normal',
    opts?: EffectOptions
  ) {
    this.fn = fn;
    this._dirty = true;

    if (priorityOrMode === 'sync') {
      this.mode = 'sync';
      this.priority = 'normal';
    } else {
      this.mode = 'frame';
      this.priority = priorityOrMode;
    }

    if (opts?.lazy) enqueueOrBatch(this);
    else this.run();
  }

  run() {
    if (this.isDisposed || this._running || !this._dirty) return;
    this._running = true;
    this._dirty = false;

    try {
      if (this.disposeFn) untracked(() => this.disposeFn!());
      unlinkAllSources(this);

      const prev = currentContext;
      currentContext = this;
      try {
        const cleanup = this.fn();
        if (typeof cleanup === 'function') this.disposeFn = cleanup;
      } catch (e) {
        // ✅ НЕ ставим _dirty=true — не ретраим бесконечно
        if (!safeOnError(e, 'effect')) throw e;
      } finally {
        currentContext = prev;
      }
    } finally {
      this._running = false;

      // ✅ оставляем: если self-dirty случился во время run (sync-mode edge),
      // тогда надо перескейджулить
      if (this._dirty && !this.isDisposed) {
        scheduleEffect(this);
      }
    }
  }

  markDirty() {
    if (this.isDisposed || this._dirty) return;
    this._dirty = true;
    scheduleEffect(this);
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.disposeFn) untracked(() => this.disposeFn!());

    if (batchedEffects) batchedEffects.delete(this);
    queues.high.delete(this);
    queues.normal.delete(this);
    queues.low.delete(this);

    unlinkAllSources(this);
    this._sources = undefined;
  }
}

/* ========================= API ======================= */
export const signal = <T>(v: T, equals?: (a: T, b: T) => boolean) => new Signal<T>(v, equals);

export function signalClient<T>(init: () => T) {
  const s = signal<T | null>(null as T | null);
  if (typeof window !== 'undefined') {
    s.v = init();
  }

  return s;
}

export const computed = <T>(fn: () => T) => new Computed<T>(fn);
export const effect = (
  fn: () => void | (() => void),
  kind: EffectKind = 'normal',
  opts?: EffectOptions
) => new Effect(fn, kind, opts);

export const __SSR_STATE__: Record<string, any> = {};

export type SSRSignal<T> = Signal<T> & { __ssrId: string };
export function ssrSignal<T>(initial: T, explicitId: string): SSRSignal<T> {
  const id = explicitId;
  const sg = signal<T>(initial) as SSRSignal<T>;
  sg.__ssrId = id;

  // КЛИЕНТ
  if (typeof window !== 'undefined') {
    const g = window as any;
    const state = g.__SSR_STATE__ as Record<string, any> | undefined;

    if (state && Object.prototype.hasOwnProperty.call(state, id)) {
      sg.v = state[id] as T;
      delete state[id];
    }

    return sg;
  }

  __SSR_STATE__[id] = initial;

  const proto = Object.getPrototypeOf(sg);
  const desc = Object.getOwnPropertyDescriptor(proto, 'v');

  if (desc && desc.get && desc.set) {
    Object.defineProperty(sg, 'v', {
      configurable: true,
      enumerable: desc.enumerable ?? true,
      get() {
        return desc.get!.call(this);
      },
      set(value: T) {
        desc.set!.call(this, value as any);
        __SSR_STATE__[id] = value;
      },
    });
  } else {
    __SSR_STATE__[id] = initial;
  }

  return sg;
}

export function getSSRStore() {
  return `window['__SSR_STATE__'] = ${JSON.stringify(__SSR_STATE__)};`;
}

export function getJsonSSRStore() {
  return JSON.stringify(__SSR_STATE__);
}

export function untracked<T>(fn: () => T): T {
  const prev = currentContext;
  currentContext = undefined;
  try {
    return fn();
  } finally {
    currentContext = prev;
  }
}

export function batch(fn: () => void) {
  const outer = !!batchedEffects;
  if (!outer) batchedEffects = new Set();
  try {
    fn();
  } finally {
    if (!outer) {
      const toSchedule = batchedEffects!;
      batchedEffects = null;
      scheduleFromBatch(toSchedule, /* requestRaf */ true);
    }
  }
}

export function setPriority(eff: Effect, p: Priority) {
  if (eff.priority === p) return;
  queues.high.delete(eff);
  queues.normal.delete(eff);
  queues.low.delete(eff);
  eff.priority = p;
  if (eff._dirty && eff.mode === 'frame') {
    scheduleEffect(eff);
  }
}

export function safeSnapshot<T>(sig: Signal<T> | Computed<T>): T | ErrorSnapshot {
  try {
    const v = sig.v;
    _errCache.delete(sig as any);
    return v;
  } catch (e) {
    const cached = _errCache.get(sig as any);
    if (cached && cached.err === e) return cached.snap;
    const snap = { __stmError: e };
    _errCache.set(sig as any, { err: e, snap });
    return snap;
  }
}
