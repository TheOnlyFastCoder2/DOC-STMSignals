# Core API

Это ядро — «движок», который:

* хранит состояние (`Signal`);
* выводит производные значения (`Computed`);
* запускает побочные эффекты (`Effect`);
* решает, **когда** и **как** это всё считать (планировщик + приоритеты + режимы).

---

## 1. Планировщик: когда выполняются эффекты

Прежде чем говорить про сигналы, важно понять, *когда* вообще запускаются эффекты.

В ядре есть:

* **приоритеты** (`high`, `normal`, `low`) — для очередей внутри кадра;
* **режимы планировщика**:

  * `frame` — по кадрам, через `requestAnimationFrame`;
  * `sync` — сразу, в текущем тике.

### 1.1. Приоритеты: `Priority`

```ts
type Priority = 'high' | 'normal' | 'low';
```

Приоритеты используются, когда эффект живёт в кадровом режиме (`mode = 'frame'`):

* `high` — критично важные реакции, выполняются без бюджетов;
* `normal` — основная работа;
* `low` — фоновые штуки, которые можно отложить.

**Пример:**

```ts
const a = signal(0);

effect(() => {
  console.log('normal', a.v);
}, 'normal');

effect(() => {
  console.log('high', a.v);
}, 'high');

a.v = 1;
// high-эффект будет обработан раньше, в очереди high
```

---

### 1.2. Режим планировщика: `setSchedulerMode`

Есть глобальный режим планировщика:

```ts
type SchedulerMode = 'frame' | 'sync';

export function setSchedulerMode(mode: SchedulerMode): void;
```

* `frame` (по умолчанию) — эффекты живут в очередях, исполняются по кадрам и бюджетам;
* `sync` — все эффекты (включая те, что были в очередях) выполняются «здесь и сейчас», через синхронный раннер.

При переходе в `sync`:

* активный `requestAnimationFrame` отменяется;
* эффекты вытаскиваются из очередей и синхронно выполняются, если помечены `_dirty`.

**Пример:**

```ts
const a = signal(0);

effect(() => {
  console.log('frame-mode', a.v);
}, 'normal');

setSchedulerMode('sync');

a.v = 1;
// эффект отработает сразу, без ожидания RAF
```

---

### 1.3. `flushSync()`: дожать все кадры

```ts
export function flushSync(): void;
```

Принудительно вычищает **кадровые** очереди:

* отменяет активный RAF (если был);
* выбрасывает эффекты из логического батча в очереди;
* выполняет всё: `high → normal → low`, пока очереди пусты.

`sync`-эффектам это обычно не нужно: они и так выполняются сразу в момент `markDirty`.

**Пример:**

```ts
const a = signal(0);

effect(() => {
  console.log('a =', a.v);
}, 'low');

a.v = 1;
// low-эффект уйдёт в очередь и отработает в кадре

flushSync(); // заставим выполнить его прямо сейчас
```

---

### 1.4. `runFrame()`: ручной запуск кадра

```ts
export function runFrame(): void;
```

Запускает один кадр работы планировщика в режиме `frame`:

* сначала `high`,
* затем `normal` (с бюджетом),
* затем `low` (с бюджетом и защитой от голодания),
* обновляет телеметрию (`__v6stats__`).

Обычно `runFrame` вызывает сам `requestAnimationFrame`, но его можно дергать вручную (например, в тестах).

---

## 2. Сигналы

### 2.1. Класс `Signal<T>`

`Signal` — это **ячейка состояния**, к которой можно:

* читать значение (`.v`);
* записывать новое;
* и автоматически строить зависимости с `Computed` / `Effect`, если читать `.v` внутри них.

```ts
export class Signal<T = any> {
  constructor(value: T, equals?: (a: T, b: T) => boolean);
  get v(): T;
  set v(v: T);
}
```

* `value` — начальное значение;
* `equals` — функция сравнения, чтобы управлять тем, считать ли новое значение «таким же».

Чтение `signal.v` внутри эффекта/компьютеда добавляет связь в реактивный граф; запись, если значение изменилось, помечает подписчиков «грязными».

**Простой пример:**

```ts
const count = new Signal(0);

const logEffect = new Effect(() => {
  console.log('count:', count.v);
});

count.v = 1; // → лог: "count: 1"
count.v = 1; // equals/Object.is скажет "то же значение" → эффект не запустится
```

---

### 2.2. Фабрика `signal(...)`

Функциональная обёртка над `new Signal(...)`:

```ts
export const signal = <T>(v: T, equals?: (a: T, b: T) => boolean) =>
  new Signal<T>(v, equals);
```

Просто короче и читаемее.

**Пример:**

```ts
const count = signal(0);

effect(() => {
  console.log('count =', count.v);
});

count.v++; // триггерит эффект
```

---

### 2.3. `signalClient(init)`: только для клиента

Иногда значение можно получить **только в браузере** (например, `window.innerWidth`).
Для этого есть `signalClient`:

```ts
export function signalClient<T>(init: () => T): Signal<T | null>;
```

* на сервере сигнал создаётся с `null`;
* в браузере сразу берёт `init()` и кладёт в `.v`.

**Пример:**

```ts
const width = signalClient(() => window.innerWidth);

// на сервере: width.v === null
// на клиенте после инициализации: width.v === window.innerWidth
```

---

## 3. Вычисляемые значения: `Computed`

### 3.1. Класс `Computed<T>`

`Computed` — это значение, которое **выводится** из других сигналов и `Computed`.
Оно кэшируется и само отслеживает свои зависимости.

```ts
export class Computed<T = any> {
  constructor(fn: () => T);

  get v(): T;
  recompute(): void;
  markDirty(): void;
}
```

* `fn` — функция, описывающая, как считать значение из других сигналов.

Чтения `.v` внутри `fn` автоматически формируют зависимости.
Если эти зависимости меняются, `Computed` помечается _dirty и пересчитается при следующем чтении `.v` или по графу.

**Пример:**

```ts
const count = signal(2);
const doubled = new Computed(() => count.v * 2);

console.log(doubled.v); // 4

count.v = 5;
console.log(doubled.v); // 10 (пересчиталось)
```

---

### 3.2. Фабрика `computed(...)`

Синтаксический сахар над `new Computed(...)`:

```ts
export const computed = <T>(fn: () => T) => new Computed<T>(fn);
```

**Пример:**

```ts
const first = signal('Alice');
const last = signal('Smith');

const fullName = computed(() => `${first.v} ${last.v}`);

effect(() => {
  console.log('Hello,', fullName.v);
});

first.v = 'Bob';
// → "Hello, Bob Smith"
```

---

## 4. Эффекты: `Effect` и `effect(...)`

### 4.1. Класс `Effect`

`Effect` — это реакция на изменения: «прочитал сигналы → сделал что-то снаружи».

У эффекта есть:

* `priority` — приоритет в кадровом режиме;
* `mode` — `'frame' | 'sync'`, то есть он живёт либо в кадрах, либо в синхронном раннере.

```ts
type EffectKind = Priority | 'sync';
type EffectMode = 'frame' | 'sync';

export class Effect {
  constructor(
    fn: () => void | (() => void),
    kind: EffectKind = 'normal',
    opts?: { lazy?: boolean }
  );

  run(): void;
  markDirty(): void;
  dispose(): void;

  // поля:
  priority: Priority;
  mode: EffectMode;
}
```

* `kind = 'high' | 'normal' | 'low'` → `mode = 'frame'`, эффект идёт в очереди;
* `kind = 'sync'` → `mode = 'sync'`, эффект выполнится сразу при `markDirty`, без RAF.

Если `opts.lazy` не указан, эффект выполняется сразу в конструкторе.

**Пример:**

```ts
const a = signal(0);

// кадровый эффект
const e1 = new Effect(() => {
  console.log('frame', a.v);
}, 'normal');

// синхронный эффект
const e2 = new Effect(() => {
  console.log('sync', a.v);
}, 'sync');

a.v = 1;
// сначала синхронно отработает e2,
// потом e1 — в ближайшем кадре (или при flushSync)
```

---

### 4.2. Фабрика `effect(...)`

Функциональная обёртка над `new Effect`:

```ts
type EffectKind = Priority | 'sync';

export const effect = (
  fn: () => void | (() => void),
  kind: EffectKind = 'normal',
  opts?: { lazy?: boolean }
) => new Effect(fn, kind, opts);
```

**Примеры:**

```ts
// обычный реактивный лог
effect(() => {
  console.log('count =', count.v);
});

// высокий приоритет
effect(() => {
  console.log('HIGH', count.v);
}, 'high');

// всегда синхронный
effect(() => {
  console.log('SYNC', count.v);
}, 'sync');
```

---

## 5. Утилиты планировщика и графа

### 5.1. `batch(fn)`: много изменений — один проход

```ts
export function batch(fn: () => void): void;
```

Внутри `batch` эффекты не запускаются сразу, а собираются в набор.
После выхода из `batch` все помеченные эффекты отправляются в планировщик (frame или sync).

**Пример:**

```ts
const a = signal(1);
const b = signal(2);

effect(() => {
  console.log('sum =', a.v + b.v);
});

batch(() => {
  a.v = 10;
  b.v = 20;
});
// эффект отработает один раз с sum = 30
```

---

### 5.2. `untracked(fn)`: выйти из реактивного контекста

```ts
export function untracked<T>(fn: () => T): T;
```

Выполнить `fn` так, будто нет текущего эффекта/компьютеда:

* чтения сигналов внутри `untracked` **не добавляют зависимостей**;
* изменения сигналов внутри `untracked` не привязывают текущий эффект к этим сигналам.

**Пример:**

```ts
const a = signal(3);
const b = signal(2);

effect(() => {
  // эффект ЗАВИСИТ только от a
  console.log('a =', a.v);

  untracked(() => {
    // работа с b не влияет на зависимости эффекта
    b.v = a.v * 2;
    console.log('debug b =', b.v);
  });
});

// не вызовет effect, потому что он не подписан на b
b.v = 32;
```

---

### 5.3. `setPriority(eff, p)`

```ts
export function setPriority(eff: Effect, p: Priority): void;
```

Меняет приоритет эффекта **в кадровом режиме**:

* эффект удаляется из старых очередей;
* получает новый `priority`;
* если он `_dirty`, будет запланирован с учётом нового приоритета.

Для `mode = 'sync'` приоритет значения почти не имеет: такой эффект и так исполняется сразу.

**Пример:**

```ts
const e = effect(() => {
  console.log('scroll-related stuff');
}, 'low');

// позже решаем, что это важно
setPriority(e, 'high');
```

---

### 5.4. `setSchedulerMode(mode)`

(уже обсуждали выше, но как API-узел):

```ts
export function setSchedulerMode(mode: 'frame' | 'sync'): void;
```

* `frame` — кадры, очереди, бюджеты;
* `sync` — всё выполняется сразу через синхронную очередь.

---

## 6. Глобальный обработчик ошибок

### `onError(fn)`

```ts
export function onError(fn: (e: unknown, where: ErrorWhere) => void): void;
```

Регистрирует глобальную обработку ошибок:

* `where` — `'effect'` или `'computed'`;
* если обработчик сам упадёт, ядро не съест вторую ошибку, а бросит её.

**Пример:**

```ts
onError((e, where) => {
  console.error('Reactive error in', where, e);
});

effect(() => {
  throw new Error('boom');
});
// попадёт в onError с where = 'effect'
```

---

## 7. SSR: `ssrSignal` и стор

### 7.1. `__SSR_STATE__`

```ts
export const __SSR_STATE__: Record<string, any> = {};
```

На сервере сюда попадают значения всех `ssrSignal`.
Потом это можно сериализовать и передать в браузер.

---

### 7.2. `SSRSignal<T>`

```ts
export type SSRSignal<T> = Signal<T> & { __ssrId: string };
```

Обычный `Signal<T>`, но с полем `__ssrId`.
По нему сигнал узнаёт себя в SSR-сторе.

---

### 7.3. `ssrSignal(initial, explicitId)`

```ts
export function ssrSignal<T>(initial: T, explicitId: string): SSRSignal<T>;
```

Сигнал, который:

* на **сервере**:

  * создаётся с `initial`,
  * пишет значение в `__SSR_STATE__[explicitId]`,
  * при изменениях обновляет это поле;
* на **клиенте**:

  * ищет `window.__SSR_STATE__[explicitId]`,
  * если находит — подхватывает значение и удаляет ключ из стора,
  * если нет — остаётся с `initial`.

**Пример:**

```ts
// core.ts
export const sgProjects = ssrSignal<Project[]>([], '/projects');

// loader на сервере
await project.list(); // внутри он положит данные в sgProjects.v

// layout на сервере
<script dangerouslySetInnerHTML={{ __html: getSSRStore() }} />

// где-нибудь в React-компоненте на клиенте
const projects = sgProjects.v; // уже есть список из SSR, без доп. запроса
```

---

### 7.4. `getSSRStore()` и `getJsonSSRStore()`

```ts
export function getSSRStore(): string;
export function getJsonSSRStore(): string;
```

* `getSSRStore()` — возвращает JS-строку вида
  `window['__SSR_STATE__'] = { ... };` — удобно прямо класть в `<script>`.
* `getJsonSSRStore()` — просто `JSON.stringify(__SSR_STATE__)`,
  если хотите сами решить, как встроить JSON в HTML.

---

## Итог

Порядок такой:

1. **Планировщик** решает, *когда* запускать эффекты: по кадрам (`frame`) или сразу (`sync`), с приоритетами и бюджетами.
2. **Сигналы (`Signal`)** хранят состояние.
3. **`Computed`** выводит одно значение из других.
4. **`Effect`** реагирует на изменения и ходит во внешний мир.
5. **Утилиты (`batch`, `untracked`, `setPriority`, `setSchedulerMode`, `flushSync`)** дают контроль над тем, *как* всё это работает.
6. **`ssrSignal`+`__SSR_STATE__`** склеивают сервер и клиент в одну непрерывную историю состояния.

А дальше уже можно наращивать слои: `signalMap`, React-обёртки и всё остальное — зная, что внизу у тебя предсказуемое, понятное ядро.
