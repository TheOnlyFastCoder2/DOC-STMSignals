# signalMap

`signalMap.ts` — это слой поверх ядра v6.3.5, который решает одну конкретную задачу:

> «Дай мне **реактивный список** сложных объектов,  
> и позволь удобно ходить по нему, менять его и вешать эффекты на каждый элемент отдельно».

Внутри он строит дерево `Signal`/`Computed` поверх обычного массива `T[]`,  
а снаружи ты работаешь с привычным API наподобие `Array`, плюс несколько мощных утилит.

---

## Зачем это вообще нужно

Обычный `signal<T[]>` хорош, пока `T` — простые значения.  
Но как только в массиве живут объекты, вложенные структуры и т.п.,  
начинается боль:

- или ты следишь за иммутабельностью вручную;
- или дергаешь `signal.v = [...signal.v]` на любой чих;
- или всё становится «слишком крупно» и не хватает точечных реакций.

`SignalMap<T>` делает иначе:

- каждый элемент массива оборачивается в **глубокую структуру сигналов** (`DeepSignal<T>`);
- список сам по себе тоже — сигнал (`Signal<ReadonlyArray<DeepSignal<T>>>`);
- есть готовые методы для перемещения, вставки, удаления и т.п.;
- есть специальные эффекты `effectMap` и `effectEach` для прохода по списку с реактивностью.

---

## Типы и идея DeepSignal

### `Primitive`

```ts
export type Primitive = string | number | boolean | symbol | bigint | null | undefined;
````

Просто набор примитивов, с которыми мы обращаемся как с «листами» (конечными значениями).

---

### `Builtin`

```ts
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
```

`Builtin` — это всё, что мы считаем **готовым листом**,
и не разворачиваем дальше по полям:

* примитивы;
* стандартные классы вроде `Date`, `RegExp`, `Map`, `Set`, typed-массивы;
* функции и промисы.

> Важно: **массивы `T[]` сюда не входят** — их мы считаем контейнерами, а не листами.

---

### `Leaf<T>` и `asLeaf`

```ts
export type Leaf<T> = T & { readonly __asLeaf: unique symbol };
export const asLeaf = <T>(x: T): Leaf<T> => x as Leaf<T>;
```

Иногда хочется насильно сказать типам:

> «Вот это — **лист**, не разворачивай его дальше».

`Leaf<T>` — чисто типовой бренд. Рантайм по-прежнему смотрит на реальный объект,
но для типов:

* `Leaf<Foo>` означает «оборачивай это в `Signal<Foo>` целиком».

Полезно, если ты хочешь, чтобы какой-нибудь сложный тип **не** разрезали на кусочки в `DeepSignal`.

---

### `DeepSignal<T>`

```ts
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
```

Это главный тип всего файла. Интуиция такая:

* `Leaf<X>` → `Signal<X>`;
* любой `Builtin` → `Signal<T>`;
* массивы → массив `DeepSignal`-элементов;
* обычные объекты → объект такой же структуры, но каждый ключ тоже превращён в `DeepSignal`;
* всё остальное → `Signal<T>`.

То есть `DeepSignal<T>` как будто проходит по твоему типу `T` и заворачивает всё в `Signal`/дерево сигналов, сохраняя форму.

---

## Обёртка и развёртка

### `wrapItemInSignals`

```ts
export function wrapItemInSignals<T>(
  item: T,
  onLeaf?: (sg: Signal<any>) => void,
  seen: WrapCache = new WeakMap()
): DeepSignal<T>;
```

Глубоко оборачивает данные в сигналы:

* plain-объекты → рекурсивно по полям;
* массивы → рекурсивно по элементам;
* всё остальное (`Builtin`, кастомные классы и т.п.) → один `Signal<T>`.

Пара важных деталей:

* параметр `onLeaf` — коллбек, который будет вызван для **каждого листового сигнала**;
* `seen` — `WeakMap` для борьбы с циклами и shared-ссылками (один и тот же объект в нескольких местах будет обёрнут согласованно).

Обычно ты напрямую это не вызываешь — этим занимается сам `SignalMap`.

---

### `deepUnwrap`

```ts
export function deepUnwrap<T>(x: DeepSignal<T>, seen: WrapCache = new WeakMap()): T;
```

Обратная операция:

* снимает `.v` с сигналов;
* проходит по массивам и объектам;
* возвращает «сырые» данные в форме исходного `T`.

Удобно для:

* логирования;
* `JSON.stringify(list)` (внутри `SignalMap.toJSON`);
* создания снапшотов состояния.

---

## Вспомогательное: `WrapCache`

```ts
type WrapCache = WeakMap<object, unknown>;
```

Кеш для обёрток:
ключ — исходный объект/массив, значение — готовая обёртка `DeepSignal`-структуры.

Если передать общий `nodeCache` в `SignalMap`, разные операции (`replaceAll`, `replaceAt` и т.п.) смогут переиспользовать уже созданные обёртки для одних и тех же объектов. Это помогает сохранять стабильность ссылок и не перетряхивать весь граф без нужды.

---

## Класс `SignalMap<T>`

```ts
export class SignalMap<T> extends Signal<ReadonlyArray<DeepSignal<T>>> { ... }
```

`SignalMap` — это:

* сам по себе `Signal` от списка;
* внутри — массив `DeepSignal<T>`;
* снаружи — удобные методы наподобие обычного массива и спец-эффекты.

### Конструктор

```ts
constructor(
  initial: readonly T[] = [],
  onLeaf?: (sg: Signal<any>) => void,
  nodeCache?: WrapCache
);
```

Параметры:

* `initial` — начальный массив, можно `readonly`;
* `onLeaf` — коллбек, который будет вызван для каждого создаваемого «листового» `Signal`;
* `nodeCache` — общий `WrapCache`, чтобы сохранять идентичность обёрток между разными операциями.

Внутри конструктор превращает `initial` в массив `DeepSignal<T>` через `wrapItemInSignals` и складывает его в `this.v`.

---

### Чтение и обход списка

#### `length`

```ts
get length(): number;
```

Количество элементов в списке.
Просто шорткат до `this.v.length`.

---

#### `at(index)`

```ts
at(index: number): DeepSignal<T> | undefined;
```

Возвращает элемент по индексу (поддерживает отрицательные индексы «с конца»).
Если индекса нет — `undefined`.

---

#### `toArray()`

```ts
toArray(): DeepSignal<T>[];
```

Возвращает **копию** внутреннего массива `DeepSignal<T>`.
Полезно, если нужно слегка потрогать порядок или пробежать по элементам, не трогая сам `SignalMap`.

---

#### `toJSON()`

```ts
toJSON(): T[];
```

Возвращает **чистый массив данных `T[]`**, без сигналов,
через `deepUnwrap`.

Это удобно тем, что:

* `JSON.stringify(list)` автоматически дернёт `toJSON`;
* можно логировать и отправлять состояние, не думая о сигналах.

---

#### Итерирование и методы высшего порядка

Поддерживаются:

* `*[Symbol.iterator]()` — делает `SignalMap` совместимым с `for..of`:

  ```ts
  for (const item of users) {
    // item: DeepSignal<User>
  }
  ```

* `forEach(fn)` — как у обычного массива, но с `DeepSignal<T>`;

* `map(fn)` — собирает новый массив из результатов;

* `some(fn)` / `every(fn)` — булевые проверки;

* `find(fn)` — поиск первого подходящего элемента;

* `findIndex(fn)` — поиск индекса.

Все они работают поверх **текущего снимка** `this.v`.

---

## Эффекты по списку

### `effectMap`

```ts
effectMap(
  fn: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => void,
  priority: Priority = 'normal'
): Effect
```

Простой способ повесить эффект на «весь список целиком»:

* при любом изменении `SignalMap` эффект заново пробежит по всем элементам;
* в `fn` ты получаешь элемент, его индекс и массив.

Хорошо подходит для случаев:

* когда нужно один раз «отрисовать» или «синхронизировать» что-то по всей коллекции;
* когда не нужен отдельный lifecycle на каждый элемент.

Если нужен полноценный lifecycle-режим (mount/unmount на элемент) — смотри `effectEach`.

---

### `effectEach`

```ts
effectEach<K extends PropertyKey>(
  getKey: (item: DeepSignal<T>, index: number) => K,
  fn: (item: DeepSignal<T>, index: number) => void | (() => void),
  priority: Priority = 'normal'
): Effect
```

Это более продвинутый режим, похожий на `map` по списку эффектов:

* для каждого элемента создаётся **свой** `Effect`;
* `getKey` возвращает ключ, по которому этот эффект идентифицируется;
* при добавлении/удалении/замене элементов старые эффекты корректно `dispose`-ятся, новые создаются.

Паттерн использования:

```ts
const list = new SignalMap<User>(initialUsers);

list.effectEach(
  user => user.id.v, // или user.id, если это не сигнал
  (user, index) => {
    // этот эффект живёт пока жив этот user с этим ключом
    console.log('mount user', user.id.v, 'at index', index);

    return () => {
      console.log('unmount user', user.id.v);
    };
  }
);
```

Что оно гарантирует:

* при **удалении** элемента его индивидуальный эффект вызовет `cleanup` и будет уничтожен;
* при **замене** элемента с тем же ключом старый эффект гасится, создаётся новый;
* при **перестановке** элементов индекс, который попадает в `fn`, всегда актуальный;
* при `dispose()` внешнего эффекта, возвращённого `effectEach`, гасится всё дерево разом.

Рекомендация: `key` должен быть стабильным примитивом (`string | number | symbol`), обычно это `id`.

---

## Мутирующие операции

Все мутирующие методы соблюдают один принцип:

> внутренний массив **копируется**, затем модифицируется,
> а наружу через `this.v` попадает **новый** `ReadonlyArray<DeepSignal<T>>`.

Это помогает:

* держать `SignalMap` совместимым с иммутабельным мышлением;
* при этом переиспользовать сами `DeepSignal`-элементы там, где это возможно.

Ниже — группы методов и их смысл.

### Перемещения

#### `move(from, to)`

```ts
move(from: number, to: number): void;
```

Перемещает элемент по индексу `from` на позицию `to`.
Если индексы некорректные — ничего не делает.

---

#### `moveById(fromId, beforeId)`

```ts
moveById(fromId: string, beforeId: string | null): void;
```

Специализированный вариант для структур с полем `id` (сигналом):

* ищет элемент, у которого `(item as any).id.v === fromId`;
* если `beforeId === null` — перемещает его в конец;
* иначе ищет элемент с `id === beforeId` и ставит «перед ним» (по сути, на его индекс).

Полезно для drag’n’drop по id.

---

### Добавление и удаление

#### `push(...items)`

```ts
push(...items: T[]): number;
```

Добавляет элементы в конец, оборачивая их в `DeepSignal`.
Возвращает новую длину.

---

#### `unshift(...items)`

```ts
unshift(...items: T[]): number;
```

Добавляет элементы в начало.

---

#### `pop()`

```ts
pop(): DeepSignal<T> | undefined;
```

Удаляет последний элемент и возвращает его обёртку.

---

#### `shift()`

```ts
shift(): DeepSignal<T> | undefined;
```

Удаляет первый элемент и возвращает его.

---

#### `splice(start, deleteCount?, ...items)`

```ts
splice(start: number, deleteCount?: number, ...items: T[]): DeepSignal<T>[];
```

Аналог `Array.prototype.splice`, но:

* возвращает массив **обёрнутых** удалённых элементов;
* вставляемые элементы `items` автоматически оборачиваются через `wrap`.

---

### Порядок

#### `sort(compareFn?)`

```ts
sort(compareFn?: (a: DeepSignal<T>, b: DeepSignal<T>) => number): this;
```

Сортирует массив по переданной функции сравнения.

Если после сортировки порядок по ссылкам не изменился — `this.v` не переустанавливается.

---

#### `reverse()`

```ts
reverse(): this;
```

Переворачивает порядок элементов.

---

### Точечные обновления

#### `setAt(index, updater)`

```ts
setAt(index: number, updater: (item: DeepSignal<T>) => void): void;
```

Обновляет **существующий элемент** на месте, **не пересобирая его обёртку**:

* `updater` получает `DeepSignal<T>`, может менять внутренние сигналы;
* сам список всё равно получает новый массив (`arr.slice()`),
  чтобы подписчики на длину/итерацию увидели обновление.

---

#### `replaceAt(index, value)`

```ts
replaceAt(index: number, value: T): void;
```

Полностью заменяет элемент новым значением `T` (с новой обёрткой `DeepSignal<T>`).

Если `nodeCache` позволяет, старые обёртки для одинаковых по ссылке объектов могут быть переиспользованы.

---

#### `with(index, value)`

```ts
with(index: number, value: T): this;
```

Иммутабельный стиль обновления «как в `Array.prototype.with`»:

* возвращает `this` для чейнинга;
* если элемент по ссылке не меняется — ничего не делает.

---

#### `insertAt(index, value)`

```ts
insertAt(index: number, value: T): void;
```

Вставляет новый элемент на нужную позицию. Индекс аккуратно приводится в диапазон `[0, length]`.

---

#### `removeAt(index)`

```ts
removeAt(index: number): DeepSignal<T> | undefined;
```

Удаляет элемент по индексу и возвращает его обёртку, либо `undefined`.

---

### Массовые операции

#### `filterInPlace(predicate)`

```ts
filterInPlace(
  predicate: (item: DeepSignal<T>, index: number, array: ReadonlyArray<DeepSignal<T>>) => boolean
): void;
```

Логически: `filter + пересборка списка`.

Физически:

* создаётся новый массив `next`, в который попадают только те элементы, для которых `predicate` вернул `true`;
* если длина изменилась — список обновляется.

---

#### `clear()`

```ts
clear(): void;
```

Полностью очищает список (делает его пустым).
Если список уже пуст — ничего не делает.

---

#### `replaceAll(items)`

```ts
replaceAll(items: readonly T[]): void;
```

Полностью заменяет внутренний список:

* каждый элемент `T` оборачивается через `wrap` (`DeepSignal<T>`);
* если новый массив по ссылкам совпадает со старым, обновление не происходит.

При наличии `nodeCache` это помогает переиспользовать обёртки для уже известных объектов.

---

## Фабрика `signalMap`

```ts
export const signalMap = <T>(
  initial: readonly T[] = [],
  onLeaf?: (sg: Signal<any>) => void,
  nodeCache?: WrapCache
) => new SignalMap<T>(initial, onLeaf, nodeCache);
```

Просто удобный способ создать `SignalMap` без `new`:

```ts
const users = signalMap<User>([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]);

users.effectEach(
  u => u.id.v,
  (u) => {
    console.log('mount user', u.id.v, u.name.v);
    return () => console.log('unmount user', u.id.v);
  }
);
```

---

## Как о нём думать

`SignalMap` — это не просто «реактивный массив».
Это **реактивная коллекция сложных сущностей**, у которых:

* поля сами по себе сигналы (`DeepSignal`);
* список умеет менять порядок, фильтровать, заменять элементы;
* можно вешать эффекты как на весь список, так и на каждый элемент с отдельным lifecycle.

Он хорошо ложится на случаи вроде:

* списки задач, пользователей, карточек;
* таблицы, которые нужно сортировать/фильтровать;
* динамические UI-коллекции с монтированием/размонтированием виджетов под каждый элемент.

И, главное, тебе не нужно вручную строить дерево сигналов —
`SignalMap` делает это за тебя, сохраняя привычное ощущение работы с обычным массивом.

