# React-обёртки над ядром

Этот модуль — тонкий мост между реактивным ядром (`Signal`, `Computed`, `Effect`) и React.

Главная идея:

- состояние и вычисления живут в ядре (сигналы);
- React-компоненты только **подписываются** на них через хуки;
- у сигналов можно получить готовый JSX-элемент `.c` и рендерить его как обычный React-элемент.

---

## Быстрый обзор хуков

- `useSignal(initial)` — локальный сигнал внутри компонента (аналог `useState`, но реактивный, с `.v` и `.c`).
- `useSignalValue(signal)` — подписка на внешний сигнал/компьютед (модель вне React).
- `useComputed(fn)` — вычисляемое значение внутри компонента.
- `useWatch(fn, deps?)` — реактивный `Effect`, привязанный к жизненному циклу компонента.
- `useSignalMap(initial, deps?)` — реактивный список (`SignalMap`) под React.
- `signalRC(initial)` — создать глобальный сигнал с `.c` без хука (используется вне компонентов).

Дальше — каждый по порядку.

---

## `useSignal(initial)`

### Что это

Локальное состояние-комо-сигнал:

- создаёт `Signal<T>` внутри компонента;
- даёт доступ к:
  - `.v` — текущее значение;
  - `.c` — готовый React-элемент для рендера значения.

По сути — `useState`, но сразу интегрированный с реактивным ядром.

### Сигнатура

```ts
export function useSignal<T>(initialValue: T): TRSignal<T>;
````

`TRSignal<T>` — это `Signal<T>` + поле `.c: JSX.Element`.

### Пример

```tsx
import { useSignal } from './react';

function Counter() {
  const count = useSignal(0);

  return (
    <div>
      <button onClick={() => (count.v -= 1)}>-</button>
      <span>{count.c}</span> {/* рендер текущего значения */}
      <button onClick={() => (count.v += 1)}>+</button>
    </div>
  );
}
```

Можно использовать как `.v` (обычное значение), так и `.c` (готовый элемент).

---

## `useSignalValue(signal)`

### Что это

Хук для **подписки на уже существующий** сигнал или computed, который живёт вне компонента:

* ничего не создаёт, только слушает;
* возвращает актуальное `sg.v`;
* при изменении `sg.v` компонент автоматически перерендерится.

### Сигнатура

```ts
export function useSignalValue<T>(sg: Sig<T>): T;
// Sig<T> = Signal<T> | Computed<T>
```

### Пример

```ts
// model.ts
import { signal } from '../index';

export const theme = signal<'light' | 'dark'>('light');
```

```tsx
// ThemeSwitcher.tsx
import { useSignalValue } from './react';
import { theme } from './model';

function ThemeSwitcher() {
  const current = useSignalValue(theme);

  return (
    <button onClick={() => (theme.v = current === 'light' ? 'dark' : 'light')}>
      Theme: {current}
    </button>
  );
}
```

`theme` может использоваться и вне React (в эффектах ядра, в API-слое и т.д.), а `useSignalValue` просто «подписывает» компонент на его изменения.

---

## `useComputed(fn)`

### Что это

Создаёт `Computed` внутри компонента:

* `fn` может читать сигналы и другие `Computed`;
* возвращаемый объект:

  * `.v` — вычисленное значение;
  * `.c` — готовый React-элемент для рендера.

### Сигнатура

```ts
export function useComputed<T>(fn: () => T): TRComputed<T>;
```

`TRComputed<T>` — это `Computed<T>` + `.c`.

### Пример

```tsx
import { useSignal, useComputed } from './react';

function FullName() {
  const first = useSignal('');
  const last = useSignal('');

  const fullName = useComputed(() => `${first.v} ${last.v}`.trim());

  return (
    <div>
      <input value={first.v} onChange={(e) => (first.v = e.target.value)} />
      <input value={last.v} onChange={(e) => (last.v = e.target.value)} />
      <p>Full name: {fullName.c}</p>
    </div>
  );
}
```

`fullName` автоматически пересчитается, когда изменятся `first.v` или `last.v`.

---

## `useWatch(fn, deps?)`

### Что это

Хук для случаев, когда нужно «подключить» **reactive-Effect** к жизненному циклу React-компонента.

Работает как `useEffect`, но внутри создаёт `Effect` из ядра:

* при маунте компонента создаётся `Effect`;
* при анмаунте — диспоузится;
* если в `fn` читаются сигналы — он становится реактивным (перезапускается при изменении этих сигналов).

### Сигнатура

```ts
export function useWatch(fn: () => void, deps: DependencyList = []): void;
```

### Пример

```tsx
import { useWatch } from './react';
import { signal } from '../index';

const userId = signal('1');

function DebugUser() {
  useWatch(() => {
    console.log('userId changed:', userId.v);
  }, [userId]); // deps отвечают за пересоздание самого Effect

  return null;
}
```

* `userId.v` внутри `useWatch` делает `Effect` зависимым от `userId`;
* при смене `userId.v` эффект сработает снова;
* при анмаунте компонента `Effect` будет корректно очищен.

---

## `useSignalMap(initial, deps?)`

### Что это

Хук над `SignalMap<T>` для удобной работы с **реактивными списками** в React:

* создаёт `SignalMap<T>` внутри компонента;
* превращает каждый элемент в `DeepSignal<T>` + `.c` на листьях;
* даёт метод `.map(renderFn)`, который сразу возвращает React-элемент, подписанный на список.

### Сигнатура

```ts
export function useSignalMap<T>(
  initialValue: readonly T[],
  deps: DependencyList = []
): TRMapSignal<T>;
```

`TRMapSignal<T>` — это `SignalMap<T>` с:

* `.v: ReadonlyArray<ReactDeep<T>>`;
* `.map((item, index) => JSX)` → `ReactElement`.

### Пример: список задач

```tsx
import { useSignalMap } from './react';

type Todo = { id: number; title: string; done: boolean };

function TodoList() {
  const todos = useSignalMap<Todo>([
    { id: 1, title: 'Learn signals', done: false },
    { id: 2, title: 'Wire React', done: true },
  ]);

  return todos.map((item, index) => (
    <div key={item.id.v}>
      <label>
        <input
          type="checkbox"
          checked={item.done.v}
          onChange={() => (item.done.v = !item.done.v)}
        />
        {item.title.c}
      </label>
    </div>
  ));
}
```

Внутри:

* `item.id`, `item.title`, `item.done` — это сигналы (с `.v` и `.c`);
* `.map(...)` уже сам подписан на изменения списка (через `useSyncExternalStore` и `Effect`).

---

## `signalRC(initial)`

### Что это

Фабрика для создания **глобального сигнала** (вне React), но сразу с `.c` и React-подпиской.

Отличается от `useSignal`:

* `useSignal` — хук, создаёт сигнал внутри компонента;
* `signalRC` — обычная функция, создаёт сигнал один раз и потом его можно использовать в любом компоненте.

### Сигнатура

```ts
export function signalRC<T>(initialValue: T): TRSignal<T>;
```

### Пример: глобальные часы

```ts
// timeModel.ts
import { signalRC } from './react';

export const timeLabel = signalRC(new Date().toLocaleTimeString());

setInterval(() => {
  timeLabel.v = new Date().toLocaleTimeString();
}, 1000);
```

```tsx
// Clock.tsx
import { timeLabel } from './timeModel';

function Clock() {
  return <div>{timeLabel.c}</div>;
}
```

`timeLabel`:

* живёт в модели;
* обновляется таймером;
* ререндерит все компоненты, где используется `.c`.

---

## Дополнительно: что там под капотом

Ниже — для тех, кому интересно, как всё устроено внутри.
Для повседневного использования достаточно понимать хуки сверху.

---

### Типы над сигналами

```ts
export type Sig<T = any> = Signal<T> | Computed<T>;

type ReactSigMeta = { c: React.JSX.Element };

export type TRSignal<T> = Signal<T> & ReactSigMeta;
export type TRComputed<T> = Computed<T> & ReactSigMeta;
```

* `Sig<T>` — «что-то, у чего есть `.v`».
* `TRSignal` / `TRComputed` — те же сигналы, но с полем `.c`.

---

### Глубокая реактивность для списков

```ts
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

export type TRMapSignal<T> = BaseMap<T> & {
  readonly v: ReadonlyArray<ReactDeep<T>>;
  map(renderFn: (item: ReactDeep<T>, index: number) => any): React.ReactElement;
};
```

Это типовая магия, которая:

* берёт `DeepSignal<T>`;
* добавляет `.c` на каждый листовой сигнал;
* описывает, как выглядит `.v` у `SignalMap` внутри React.

---

### `useSignalListener` и `renderValue`

Внутренние вспомогательные штуки:

```ts
function useSignalListener(): [notify: () => void, externalStore: <T>(s: Sig<T>) => T];
```

* делает `Set` слушателей на `useSyncExternalStore`;
* `notify()` дёргает всех;
* `externalStore(sig)` возвращает актуальное значение `sig.v` и подписывает компонент.

```ts
export function renderValue<T>(value: T): React.ReactElement {
  if (typeof value === 'object' && value !== null && 'type' in (value as any)) {
    return value as unknown as React.ReactElement;
  }
  return <>{String(value)}</>;
}
```

* если значение уже React-элемент — возвращает его;
* иначе просто оборачивает в текст.

---

### `.c` (мета-поле для сигналов)

Общий конструктор:

```ts
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
```

Каждый раз, когда ты вызываешь:

* `useSignal`,
* `useComputed`,
* `useSignalMap` (для листьев),
* `signalRC`,

на соответствующий сигнал/компьютед навешивается поле `.c`,
которое:

* знает, как подписаться на значение;
* умеет перерендериться при изменении;
* можно спокойно вставлять в JSX.

---

В итоге:

* если хочешь **локальное** состояние — `useSignal` / `useComputed`;
* если хочешь подписаться на **глобальную модель** — `useSignalValue` / `signalRC`;
* если работаешь со **списками** — `useSignalMap`;
* если нужно просто повесить реактивный `Effect` на жизненный цикл компонента — `useWatch`.

Типы и внутренности можно не трогать, но они всегда рядом, если захочется углубиться.
