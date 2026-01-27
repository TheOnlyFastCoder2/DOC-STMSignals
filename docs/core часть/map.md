# SignalMap API

## Введение

`signalMap.ts` — это глава про списки, где “обычный массив” перестаёт быть просто массивом и становится **живой коллекцией**.

Идея простая: у тебя есть `T[]` (например, список задач). Ты хочешь, чтобы UI и логика реагировали **точечно**: поменялся `todo.done` — проснулась только та часть, которая это читает, а не “перерендери всё и молись”. Вот ровно для этого `signalMap` и существует.

Он делает две вещи:

1. **Оживляет элементы**: превращает каждый `T` в `DeepSignal<T>` (вложенные поля становятся сигналами).
2. **Даёт удобный контейнер**: `SignalMap<T>` — это и список с методами (push/move/splice…), и одновременно `Signal`, на который можно подписаться.

---

## DeepSignal — когда объект “оживает” по ключам

`DeepSignal<T>` — это тип (не класс), который описывает результат “deep-обёртки”:

* примитивы и “встроенные штуки” (`Date`, `Map`, `Set`, `Promise`, функции, typed arrays и т.п.) считаются **листом** → оборачиваются в `Signal<T>`
* **plain object** (прототип `Object.prototype` или `null`) разворачивается по enumerable-ключам → `{ [K]: DeepSignal<T[K]> }`
* **массивы** разворачиваются по элементам → `ReadonlyArray<DeepSignal<U>>`
* всё остальное (например, инстансы классов) — тоже лист → `Signal<T>`

В итоге ты можешь делать так:

```ts live noInline
type Todo = { id: string; title: string; done: boolean };

const list = signalMap<Todo>([{ id: 'a', title: 'Milk', done: false }]);

list.at(0)!.title.v = 'Oat milk';
list.at(0)!.done.v = true;
```

---

## Два полезных инструмента: wrapItemInSignals и deepUnwrap

### `wrapItemInSignals(item, onLeaf?, seen?, modeOrOpts?)`

Это низкоуровневая “машинка оживления”: берёшь любое значение `item` и получаешь `DeepSignal<T>`, где примитивы и “листовые” сущности становятся `Signal`, plain-объекты разворачиваются по ключам, массивы — по элементам. В `SignalMap` она используется под капотом, но иногда её приятно вытащить на свет — когда тебе нужно оживить **один объект**, а не целый список, или когда хочется тонко контролировать процесс оборачивания.

Самый частый сценарий — “у меня есть settings/config/state-объект, хочу реактивность по полям, но не хочу заводить отдельный контейнер”. Тогда просто заворачиваешь и работаешь с полями как с сигналами:

```ts live noInline
const settings = wrapItemInSignals({
  theme: 'dark',
  flags: { newUI: true },
});

settings.theme.v = 'light';
settings.flags.newUI.v = false;
console.log(settings)
```

А теперь две ручки, ради которых эта функция вообще заслуживает отдельного абзаца.

`onLeaf` — это твой “коллектор листьев”. Он вызывается каждый раз, когда внутри wrap’а создаётся **листовой** `Signal(...)`: то есть для примитивов, дат, мап/сетов, инстансов классов, функций — всего, что не разворачивается по ключам. Это полезно, когда ты хочешь собрать все leaf-сигналы и, например, навесить на них общий дебаг, метрики или сделать “одной кнопкой сбросить всё состояние”.

Пример: собираем все leaf-сигналы и выводим снимок одним эффектом (и да — это реально удобно для отладки сложных деревьев):

```ts live noInline
const leaves: any[] = [];

const user = wrapItemInSignals(
  {
    id: 'u1',
    profile: { name: 'Alice', age: 20 },
    flags: { pro: true },
  },
  (sg) => {
    leaves.push(sg);
  }
);

effect(() => {
  // читаем .v у всех листьев → строим зависимости на всё дерево
  console.log('leaf snapshot:', leaves.map((s) => s.v));
});

user.profile.name.v = 'Bob';  // эффект проснётся
user.flags.pro.v = false;     // и тут тоже
```

`seen` — это “память ссылок” (WeakMap), которая спасает от двух вещей: **shared refs** и **циклов**. Если один и тот же объект встречается в нескольких местах, `seen` гарантирует, что он будет обёрнут **один раз**, и все места будут ссылаться на одну и ту же deep-обёртку (а значит — на одни и те же сигналы). И если структура вдруг содержит самоссылки, `seen` не даст wrap’у уйти в бесконечность.

Пример shared refs: один объект используется в двух местах, но после wrap’а это всё ещё “один персонаж”, а не два клона:

```ts live noInline
const shared = { x: 1 };
const src = { a: shared, b: shared };

const seen = new WeakMap<object, unknown>();
const wrapped = wrapItemInSignals(src, undefined, seen);

console.log(wrapped.a === wrapped.b); // true
wrapped.a.x.v = 999;
console.log(wrapped.b.x.v); // 999
```

Пример циклов: объект указывает на себя, и мы всё равно остаёмся в живых — и wrap, и дальнейшие операции работают корректно:

```ts live noInline
type Node = { name: string; next?: Node };

const n: Node = { name: 'A' };
n.next = n; // цикл

const seen = new WeakMap<object, unknown>();
const w = wrapItemInSignals(n, undefined, seen);

w.name.v = 'B';
console.log(w.next!.name.v); // 'B'

const raw = deepUnwrap(w);
console.log(raw.name); // 'B'
```

Если хочется “стабильной личности” для обёрток между разными вызовами `wrapItemInSignals`, можно использовать один и тот же `seen` как общий кеш — это ровно та же идея, что и `nodeCache` в `SignalMap`: один объект по ссылке → одна обёртка по ссылке.

```ts live noInline
const _cache = new WeakMap<object, unknown>();

const a = { x: 1 };
const w1 = wrapItemInSignals(a, undefined, _cache);
const w2 = wrapItemInSignals(a, undefined, _cache);

console.log(w1 === w2); // true
```
`wrapModeOrOpts` — это правило, по которому библиотека решает, где заканчивается “внутренний мир” объекта и начинается “атом”. В режиме `'deep'` она лезет внутрь plain-объектов и массивов, превращая поля и элементы в маленькие сигналы, чтобы всё реагировало точечно. А если ты говоришь `'object'`, `'array'` или `'object+array'`, ты как бы ставишь табличку “не разбирай, держи целиком” — и объект/массив становится одним `Signal`. В варианте `WrapOptions` это уже не просто переключатель, а набор договорённостей: `isLeaf` позволяет точечно объявить “вот это значение — атом”.

`stampIds` включает простую вещь: каждой созданной обёртке (и leaf-сигналам, и deep-объектам/массивам) проставляется скрытый стабильный числовой id. Он нужен не для реактивности, а для “узнавания” узлов: удобно делать ключи для списков, keyed-эффекты, отладку и любые сценарии, где ты хочешь различать элементы не по index, а по постоянному идентификатору. Если id уже был — он переиспользуется; если не был — создаётся и дальше живёт вместе с обёрткой.
```ts live noInline
// modeOrOpts можно передать строкой leafMode:
const a = wrapItemInSignals(
  { tags: ['a', 'b'], meta: { x: 1 } },
  undefined,
  undefined,
  'array'
);

// tags станет одним Signal<string[]>, а meta развернётся глубоко:
a.tags.v.push('c');     // tags — leaf Signal
a.meta.x.v = 2;         // meta.x — deep Signal


// или можно передать WrapOptions:
const b = wrapItemInSignals(
  { meta: { secret: true, x: 1 }, items: [{ id: 1 }] },
  undefined,
  undefined,
  {
    leafMode: 'deep',
    isLeaf: (v) => !!v && typeof v === 'object' && (v as any).secret === true,
    stampIds: true,
  }
);

// meta станет одним Signal (из-за isLeaf), а items развернётся
b.meta.v;               // meta — leaf Signal
b.items[0].id.v = 2;    // items[0].id — deep Signal
```
---

### `deepUnwrap(x, seen?)`

Это обратная сторона медали: берёт `DeepSignal<T>` и возвращает чистый `T` — удобно для логов, JSON, тестов, отправки на сервер.

Когда может понадобиться: ты хочешь сериализовать состояние, сделать snapshot в тесте, или просто вывести “нормальные данные”, а не лес `.v`.

```ts live noInline
const list = signalMap<Todo>([{ id: 'a', title: 'Milk', done: false }]);
const raw = deepUnwrap(list.at(0));
console.log(raw); // { id: 'a', title: 'Oat milk', done: true }
```

---

## SignalMap — живой список поверх Signal

`SignalMap<T>` наследуется от `Signal<ReadonlyArray<DeepSignal<T>>>`. То есть он одновременно:

* **Signal**: чтение `list.v` внутри effect/computed строит зависимость на состав списка;
* **список**: у него есть методы уровня массива, но без мутирования `list.v` руками.

### Конструктор и параметры


```ts
new SignalMap<T, M>(
  initial: readonly T[] = [],
  onLeaf?: (sg: Signal<any>) => void,
  nodeCache?: WeakMap<object, unknown>,
  wrapModeOrOpts: M | WrapOptions<M> = 'deep' as M
)
```

`initial` — исходный массив `T[]`. `onLeaf` — коллбек, который вызывается каждый раз, когда внутри deep-обёртки создаётся листовой `Signal` (удобно для дебага, метрик, навешивания `.c` в React-обвязке и т.п.). `nodeCache` — общий `WeakMap`, который прокидывается внутрь `wrapItemInSignals` как `seen`: он сохраняет identity обёрток по ссылкам, поэтому один и тот же исходный объект будет получать одну и ту же “обёртку” между разными операциями. `wrapModeOrOpts` — политика оборачивания: можно передать строковый `leafMode` (`'deep' | 'object' | 'array' | 'object+array'`) или `WrapOptions` (например, `isLeaf` и `stampIds`).

---

### Про `list.v` и dev-freeze (важно для нервов)

В dev-режиме массив, который кладётся в `list.v`, замораживается (`Object.freeze(arr.slice())`). Это сделано специально, чтобы ты случайно не сделал `list.v.push(...)` и не устроил себе призрачные баги.

Правильный стиль: **меняем список методами `SignalMap`, а не мутируем `list.v` вручную**.

---

# Полный API SignalMap: все методы и когда они нужны

Ниже — все публичные методы из файла. Я буду делать так: сначала **когда метод реально нужен**, потом короткий пример.

---

## Чтение и удобства

**`length`**
Нужен, когда ты реагируешь на размер списка: “пусто/не пусто”, показать бейдж, заблокировать кнопку. Если читаешь `list.length` внутри effect/computed — ты подписываешься на изменения состава списка.

```ts
effect(() => console.log('len =', list.length));
```

**`at(index)`**
Нужен, когда ты берёшь элемент по индексу, особенно с отрицательными индексами (`-1` = последний). Удобно для “последний добавленный”, “предыдущий/следующий”.

```ts
const last = list.at(-1);
```

**`toArray()`**
Нужен, когда ты хочешь получить копию текущего массива обёрток и работать с ним как с обычным массивом (не рискуя мутировать `list.v`).

```ts
const snapshot = list.toArray();
```

**`toJSON()`**
Нужен для сериализации/логов/тестов. Возвращает `T[]`, снимая обёртки через `deepUnwrap`. Плюс `JSON.stringify(list)` автоматически использует `toJSON`.

```ts
console.log(list.toJSON());
console.log(JSON.stringify(list));
```

**`[Symbol.iterator]()`**
Нужен, чтобы работал `for..of`. Самый “чистый” способ пробежаться по списку без лишней возни.

```ts
for (const item of list) console.log(item);
```

---

## Array-like методы

**`forEach(fn)`**
Нужен для прохода “с побочкой”: логирование, сбор статистики, пуш в стороннюю структуру.

```ts
list.forEach((it, i) => console.log(i, it));
```

**`map(fn)`**
Нужен, когда ты строишь производный массив (например, список заголовков для UI).

```ts
const titles = list.map((t: any) => t.title.v);
```

**`some(fn)`**
Нужен для проверки “есть ли хоть один…”. Классика: есть ли незавершённые, есть ли выбранные.

```ts
const hasUndone = list.some((t: any) => !t.done.v);
```

**`every(predicate)`**
Нужен для “все ли…”. Например: “все завершены”.

```ts
const allDone = list.every((t: any) => t.done.v);
```

**`find(predicate)`**
Нужен, когда ты хочешь получить сам элемент-обёртку по условию (обычно по id), чтобы дальше менять его поля.

```ts
const a = list.find((t: any) => t.id.v === 'a');
if (a) a.done.v = true;
```

**`findIndex(predicate)`**
Нужен, когда важна позиция: подсветка строки, скролл к элементу, удаление по индексу.

```ts
const idx = list.findIndex((t: any) => t.id.v === 'b');
```

---

## Реактивные проходы по списку

**`effectMap(fn, priority = 'normal')`**
Нужен, когда ты хочешь **один общий effect**, который на каждом изменении списка проходит элементы. Это “дёшево и просто”, но без индивидуального lifecycle для каждого элемента.

```ts
list.effectMap((item: any, i) => {
  console.log('row', i, item.title.v);
}, 'normal');
```

**`effectEach(getKey, fn, priority = 'normal')`**  
Он создаёт **отдельный child-effect для каждого элемента**, и каждый child подписывается **только на те свойства элемента**, которые ты читаешь внутри `fn` (например, `item.title.v` или `item.done.v`). Плюс у каждого элемента есть свой cleanup — как маленький `useEffect`, но без React.

```ts
list.effectEach(
  (item: any) => item.id.v,        // ключ элемента (стабильный id)
  (item: any, index) => {
    const unsub = subscribe(item.id.v);
    return () => unsub();          // cleanup при уходе элемента
  },
  'normal'
);
```


## Перестановки и “движение” элементов

**`move(from, to, rel = 0)`**

`move` умеет два режима. По умолчанию (`rel = 0`) он просто **меняет местами** элементы с индексами `from` и `to` (swap). Если `rel !== 0`, то он делает настоящее перемещение: **вырезает** элемент `from` и **вставляет** его относительно `to` — `rel = -1` означает “вставить перед `to`”, `rel = 1` — “вставить после `to`” (и в целом можно сдвигать на несколько позиций). Индексы корректируются автоматически, чтобы вставка была правильной даже если элемент переносится “вперёд по массиву”.

```ts
list.move(0, 3);        // swap (rel=0)
list.move(0, 3, -1);    // переместить 0 перед 3
list.move(0, 3, 1);     // переместить 0 после 3
```

---
**`moveById(fromId, targetId, rel = 0, key = 'id')`**

`moveById` работает так же, как `move`, только вместо индексов ты передаёшь идентификаторы. Он находит в списке элемент `fromId` и элемент-цель `targetId` по полю `key` (по умолчанию это `id`), а затем вызывает `move` с найденными индексами. Если `targetId` равен `null` или цель не нашлась — элемент отправляется в конец.

```ts
list.moveById('a', 'b');        // переместить A относительно B (как в move)
list.moveById('a', null);       // A в конец

list.moveById('a', 'b', -1, 'key'); // искать по item.key вместо item.id
```
---

## Добавление и удаление элементов (как у массива, но безопасно)

**`push(...items)`**
Нужен для “добавить в конец” (Add item / Append row).

```ts
list.push({ id: 'c', title: 'Ship', done: false });
```

**`unshift(...items)`**
Нужен для “добавить в начало” (новые сверху, prepend).

```ts
list.unshift({ id: 'z', title: 'Urgent', done: false });
```

**`pop()`**
Нужен для стека/undo/“убрать последний”.

```ts
const last = list.pop();
```

**`shift()`**
Нужен для очереди/“взять первый”.

```ts
const first = list.shift();
```

**`splice(start, deleteCount?, ...items)`**
Нужен для хирургии: удалить/вставить/заменить кусок. `start` поддерживает отрицательные значения.

```ts
list.splice(1, 1, { id: 'x', title: 'Inserted', done: false });
```

**`removeRef(item)`** — удалить элемент по ссылке на wrapper

`removeRef` нужен, когда у тебя на руках уже есть **сама обёртка элемента** (то, что вернул `list.at()` / `list.find()` / итерация), и ты хочешь удалить её из списка **без поиска индекса вручную**. Он просто находит позицию этого wrapper’а в текущем `list.v` и делает обычный `removeAt(idx)`. Если элемент уже не в списке — ничего не произойдёт.

```ts
const item = list.find((t: any) => t.id.v === 'b');
if (item) list.removeRef(item);
```

---

## Сортировки

**`sort(compareFn?)`**
Нужен для сортировки по полям. Важно: сортируем обёртки, значит в `compareFn` обычно читаем `.v`. Есть оптимизация: если порядок ссылок не поменялся — лишнего присваивания не будет.

```ts
list.sort((a: any, b: any) => a.title.v.localeCompare(b.title.v));
```

**`reverse()`**
Нужен, чтобы быстро инвертировать порядок (новые/старые).

```ts
list.reverse();
```

---

## Точечные апдейты

**`setAt(index, updater)`**
Нужен, когда ты хочешь обновить поля существующего элемента **без пересборки deep-обёртки**, но при этом “пнуть” список новой ссылкой массива (чтобы подписчики на список заметили изменение композиции снапшота).

```ts
list.setAt(0, (item: any) => {
  item.title.v = 'Updated';
});
```

**`replaceAt(index, value)`**
Нужен, когда ты хочешь полностью заменить элемент на новое значение `T` (новая обёртка). Если используется общий `nodeCache`, обёртки для тех же ссылок могут переиспользоваться.

```ts
list.replaceAt(0, freshValue);
```

**`with(index, value)`**
Нужен как “иммутабельный replaceAt”, но с цепочечностью: возвращает `this`.

```ts
list.with(1, freshValue).reverse();
```

**`insertAt(index, value)`**
Нужен, когда вставляешь элемент в конкретное место (между двумя строками, в середину).

```ts
list.insertAt(1, value);
```

**`removeAt(index)`**
Нужен, когда удаляешь по индексу и хочешь вернуть удалённый элемент (для undo/анимаций/логики).

```ts
const removed = list.removeAt(2);
```

---

## Массовые операции по списку

**`filterInPlace(predicate)`**
Нужен, когда хочешь отфильтровать список, но **сохранить существующие wrapper’ы** для элементов, которые остаются (это важно для стабильности и подписок).

```ts
list.filterInPlace((it: any) => !it.done.v);
```

**`clear()`**
Нужен для “сбросить в пустоту”. Если список уже пуст — ничего не делает.

```ts
list.clear();
```

**`replaceAll(items)`**
Нужен, когда пришли новые данные целиком (сервер, фильтр, смена проекта). Есть оптимизация: если длина и ссылки совпали — присваивания не будет.

```ts
list.replaceAll(nextItems);
```

---

## Поле `itemKey?`

В классе есть поле:

```ts
public itemKey?: (item: DeepSignal<T>, index: number) => React.Key;
```

Оно не используется самим `SignalMap` (это просто “кармашек”), но часто удобно как единая договорённость “как строим ключи” для UI-рендера/таблиц.

Когда может понадобиться: ты хочешь хранить правило ключей рядом со списком, чтобы не дублировать логику в компонентах.

```ts
list.itemKey = (item: any) => item.id.v;
```

---

## Фабрика `signalMap(...)`

Фабрика просто создаёт `new SignalMap(...)`, но её удобнее читать в коде и проще типизировать.

```ts
export const signalMap = <T>(
  initial: readonly T[] = [],
  onLeaf?: (sg: Signal<any>) => void,
  nodeCache?: WeakMap<object, unknown>
) => new SignalMap<T>(initial, onLeaf, nodeCache);
```

---
