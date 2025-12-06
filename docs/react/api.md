# React-слой поверх ядра

Этот файл — мост между **реактивным ядром** и **React**.  
Он даёт:

- сигналы, которые умеют «жить» в React-компонентах;
- хуки `useSignal`, `useComputed`, `useSignalValue`;
- обёртку над `SignalMap` — `useSignalMap`;
- удобное свойство `.c` у сигналов/компьютедов, которое сразу готово к рендеру в JSX.

Идея простая: **ядро отвечает за реактивность, React — за рендер**,  
а этот слой аккуратно синхронизирует одно с другим.

---

## Базовые типы

### `Sig<T>`

`````ts
export type Sig<T = any> = Signal<T> | Computed<T>;
````### `renderValue`

```ts
export function renderValue<T>(value: T): React.ReactElement;
`````

Простой рендер-утилита:

- если `value` уже похоже на `ReactElement` (`value.type` существует) — возвращает его как есть;
- иначе оборачивает в фрагмент и приводит к строке:

```tsx
return <>{String(value)}</>;
```

---

## Хук `useSignal`

```ts
export function useSignal<T>(initialValue: T): TRSignal<T>;
```

Создаёт **локальный сигнал** внутри React-компонента и подписывает компонент на его изменения.

Как это выглядит снаружи:

```tsx
function Counter() {
  const count = useSignal(0); // TRSignal<number>

  return (
    <div>
      {count.c}
      <button onClick={() => (count.v += 1)}>+</button>
    </div>
  );
}
```

Что важно:

- сигнал живёт в `useRef` и создаётся только один раз на маунт;
- отдельный `Effect` из ядра следит за `sig.v` и вызывает `notify()`;
- компонент подписан через `useSyncExternalStore`, поэтому любое изменение `sig.v` вызывает ререндер.

---

## Хук `useSignalValue`

```ts
export function useSignalValue<T>(sg: Sig<T>): T;
```

Это хук «подпишись на **уже существующий** сигнал/компьютед и верни его значение».

Пример:

```ts
const globalCount = signal(0);

function SomeComponent() {
  const value = useSignalValue(globalCount);

  return <div>Глобальный счётчик: {value}</div>;
}
```

Здесь:

- `useSignalValue` не создаёт новый сигнал, а использует тот, что ты передал;
- внутри создаётся эффект, который трогает `sg.v` и дергает `notify`;
- компонент подписывается на этот сигнал через `useSyncExternalStore`.

---

## Фабрика `signalRC`

```ts
export function signalRC<T>(initialValue: T): TRSignal<T>;
```

Создаёт **standalone-сигнал с готовым `.c`**, без хуков:

- это удобно, когда у тебя есть глобальное состояние вне React;
- но иногда нужно уметь его рендерить как React-компонент.

```tsx
const counter = signalRC(0);

function App() {
  return (
    <div>
      {counter.c}
      <button onClick={() => (counter.v += 1)}>+</button>
    </div>
  );
}
```

Под капотом:

- у сигнала создаётся собственный набор слушателей;
- `Effect` следит за `sig.v` и уведомляет всех подписчиков;
- `.c` — это мемо-компонент на `useSyncExternalStore`, который слушает этот сигнал.

---

## Хук `useComputed`

```ts
export function useComputed<T>(fn: () => T): TRComputed<T>;
```

Создаёт `Computed` внутри компонента и подписывает его на ядро так же, как `useSignal`.

Пример:

```tsx
function Sum({ a, b }: { a: Sig<number>; b: Sig<number> }) {
  const sum = useComputed(() => a.v + b.v);

  return <div>Сумма: {sum.c}</div>;
}
```

Особенности:

- вычисление живёт в `useRef`, не пересоздаётся на каждый рендер;
- отдельный `Effect` следит за `comp.v` и вызывает `notify`;
- у результата тоже есть `.c`.

---

## `useWatch`

```ts
export function useWatch(fn: () => void, deps: DependencyList = []);
```

Хук, который создаёт **ядровой `Effect`** и привязывает его к жизненному циклу React-компонента.

### Как пользоваться

Обычно — без второго аргумента:

```tsx
function Example({ userId }: { userId: Sig<string> }) {
  useWatch(() => {
    // Чтение userId.v делает эффект реактивным к этому сигналу
    console.log('userId изменился:', userId.v);
  });

  return null;
}
```

- при маунте создаётся `Effect`;
- всё, что ты читаешь через `.v` внутри `fn`, становится его зависимостью;
- при изменении этих сигналов `fn` вызывается снова;
- при анмаунте `Effect` диспоузится.

### Когда нужны `deps`

`deps` — редкий случай, когда нужно пересоздавать **сам** `Effect` по правилам React:

```tsx
useWatch(() => {
  // ...какой-то код, зависящий от mode
}, [mode]);
```

В повседневной работе достаточно `useWatch(fn)` без deps — реактивность обеспечивается самим ядром через чтение `.v`.

## Хук `useSignalMap`

```ts
export function useSignalMap<T>(
  initialValue: readonly T[],
  deps: DependencyList = []
): TRMapSignal<T>;
```

React-обёртка над `SignalMap<T>`.

Даёт:

- `TRMapSignal<T>` с `v: ReadonlyArray<ReactDeep<T>>`;
- `map(renderFn)` → JSX, автоматически подписанный на изменения списка;
- на каждом листовом `Signal` внутри списка есть `.c`.

Пример:

```tsx
type Todo = { id: number; text: string; done: boolean };

function useTodos() {
  return useSignalMap<Todo>([
    { id: 1, text: 'Купить хлеб', done: false },
    { id: 2, text: 'Выучить ядро', done: true },
  ]);
}

function TodoList() {
  const todos = useTodos();

  return todos.map((todo) => (
    <label key={todo.id.v}>
      <Active sg={todo.done}>
        <input
          type="checkbox"
          checked={todo.done.v}
          onChange={(e) => (todo.done.v = e.target.checked)}
        />
      </Active>
      {todo.text.c}
    </label>
  ));
}
```

Что делает `useSignalMap` внутри:

- создаёт `SignalMap<T>` один раз;
- для каждого **листового сигнала** внутри:

  - вешает на него `.c` через `definedComponent`;
  - поднимает маленький `effect`, который следит за `leaf.v` и вызывает `leafNotify`;

- для самого списка:

  - создаёт `effect`, который следит за `mapSignal.v` и вызывает `listNotify`;
  - под `.map` создаёт компонент `Map`, который подписан через `useSyncExternalStore` на состояние списка и рендерит `state.map(renderFn)`.

Параметр `deps`:

- контролирует, когда нужно «снести» и пересоздать эффект, который подписывает компонент на список;
- позволяет привязать жизненный цикл `SignalMap` к жизненному циклу React-компонента (например, когда начальное значение зависит от пропсов).

---

## Краткий итог

React-слой делает три вещи:

1. **Дружит сигнал и React-рендер** — через `useSyncExternalStore` и внутренние `Effect`.
2. Даёт удобные **хуки** (`useSignal`, `useComputed`, `useSignalValue`, `useSignalMap`) вместо ручной подписки.
3. Добавляет к сигналам и спискам маленький бонус в виде `.c`, чтобы их можно было рендерить прямо в JSX без лишней обвязки.

Ты по-прежнему думаешь в терминах **сигналов и эффектов**, но React-компоненты при этом живут с

Просто «любой реактивный узел», с которым работает этот слой — либо `Signal<T>`, либо `Computed<T>`. Удобно для общих утилит.

---

### `ReactSigMeta` и `.c`

```ts
type ReactSigMeta = { c: React.JSX.Element };
```

Это маленький «хвостик» к сигналу: поле `c`, в котором уже лежит **готовый React-элемент**, подписанный на этот сигнал.

- Для `TRSignal<T>` / `TRComputed<T>` `.c` — это компонент, который:

  - подписывается на сигнал через `useSyncExternalStore`;
  - при каждом изменении сигнала сам перерисовывается;
  - внутри рендерит актуальное значение (или то, что ты ему вернул).

---

### `TRSignal<T>` и `TRComputed<T>`

```ts
export type TRSignal<T> = Signal<T> & ReactSigMeta;
export type TRComputed<T> = Computed<T> & ReactSigMeta;
```

Это те же `Signal` / `Computed`, только уже **React-готовые**:

- их можно использовать как обычные сигналы (`.v`);
- у них есть `.c`, который можно прямо воткнуть в JSX:

```tsx
const count = signalRC(0);

function App() {
  return (
    <div>
      {count.c}
      <button onClick={() => (count.v += 1)}>+</button>
    </div>
  );
}
```

---

### `ReactDeep<T>`

```ts
type Reactify<S> = S extends Signal<infer U>
  ? TRSignal<U>
  : S extends Computed<infer U>
  ? TRComputed<U>
  : S extends ReadonlyArray<infer U>
  ? ReadonlyArray<Reactify<U>>
  : S extends object
  ? { [K in keyof S]: Reactify[S[K]] }
  : S;

export type ReactDeep<T> = Reactify<DeepSignal<T>>;
```

`ReactDeep<T>` — это «DeepSignal, но с `.c` на каждом листе».

Если `DeepSignal<T>` строит дерево сигналов, то `ReactDeep<T>` добавляет к каждому листовому сигналу ещё и React-представление.

---

### `TRMapSignal<T>`

```ts
type BaseMap<T> = Omit<SignalMap<T>, 'map' | 'v'>;

export type TRMapSignal<T> = BaseMap<T> & {
  readonly v: ReadonlyArray<ReactDeep<T>>;
  map(renderFn: (item: ReactDeep<T>, index: number) => any): React.ReactElement;
};
```

Это `SignalMap<T>`, адаптированный под React:

- его `v` — это массив `ReactDeep<T>` (каждый элемент уже с `.c`);
- у него есть метод `map(renderFn)`, который возвращает **React-элемент**:

  - под капотом создаётся мемоизированный компонент;
  - он подписан на список;
  - и при каждом изменении списка заново прогоняет `renderFn` по `state`.

Пример:

```tsx
function UserList() {
  const users = useSignalMap([{ id: 1, name: 'Alice' }]);

  return users.map((user) => <div key={user.id.v}>{user.name.c}</div>);
}
```

---

## Внутренний слушатель: `useSignalListener`

```ts
function useSignalListener(): [() => void, <T>(s: Signal<T> | Computed<T>) => T];
```

Хук, который даёт:

- `notify()` — функция, которая «пинает» всех подписчиков;
- `externalStore(sig)` — обёртку над `useSyncExternalStore`, привязанную к одному набору слушателей.

Внутри:

- хранится `Set` слушателей;
- `useSyncExternalStore` подписывается на добавление/удаление этих слушателей;
- при вызове `notify()` все слушатели дергаются, и React понимает, что нужно перерендерить.

Ты этим хелпером напрямую не пользуешься — он лежит под `useSignal`, `useComputed`, `useSignalMap` и т.д.

---

## Конструктор `.c`: `definedComponent`

```ts
function definedComponent(externalStore: ExternalStore, sig: Sig) { ... }
```

Берёт сигнал/компьютед и:

1. создаёт `memo`-компонент, который подписывается на `sig.v` через `externalStore`;
2. внутри рендерит `renderValue(value)`;
3. вешает этот компонент на `sig.c` через `Object.defineProperty`.

После этого любой `sig` с такой обработкой можно просто рендерить как `{sig.c}`.

---

воей обычной жизнью, просто «слушая» реактивное ядро.
