---
sidebar_position: 1
---

# Реактивность в React

## Введение

React-версия — это мостик между вашим **Reactive Core** и **рендером React**, без “магии сторов” и без ручного `setState` на каждое движение. Идея простая: сигналы и computed живут своей жизнью, а React узнаёт об изменениях через `useSyncExternalStore` — то есть так, как React “любит” (и как надо для concurrent).

Главная фишка, ради которой это вообще приятно писать: у каждого Signal/Computed появляется **`.c`** — готовый React-элемент. Его можно просто вставить в JSX, и он сам будет подписываться и перерисовываться.

```tsx
function Counter() {
  const count = useSignal(0);
  const doubled = useComputed(() => count.v * 2);

  return (
    <button onClick={() => (count.v += 1)}>
      count: {count.c} / doubled: {doubled.c}
    </button>
  );
}
```

---

## Что такое `.c` и почему это удобно

`.c` — это просто готовый React-элемент, “прикрученный” прямо к сигналу или computed. Внутри он подписывается на изменения через `useSyncExternalStore`, читает значение безопасно через `safeSnapshot` (поэтому если computed упал, React-дерево не падает вместе с ним), и в конце превращает результат в JSX через `renderValue`. В итоге ты можешь читать `.v`, когда нужна логика, а можешь вставлять `.c`, когда нужно отображение — и оно будет обновляться само, без лишних обёрток и `useState`.

---

## `renderValue(value)` — как библиотека превращает значение в JSX

`renderValue` — это “последний переводчик” между данными и UI. Если ему прилетает `ErrorSnapshot` вида `{ __stmError: ... }`, он аккуратно рисует сообщение об ошибке. Если прилетает уже готовый React-элемент, он просто отдаёт его как есть. А если это обычное значение (строка, число, boolean и т.д.), он делает из него текст через `String(value)` и рендерит. Это удобно, потому что все сигналы/компьютеды отображаются одинаково и предсказуемо — ты не пишешь бойлерплейт “а вдруг там ошибка?” в каждом компоненте.

```tsx
const name = useSignal('Alice');
return <div>Hello, {name.c}</div>;
```

---

## `useSignal(initialValue)` — локальное состояние компонента, но реактивное

`useSignal` создаёт writable `Signal`, живущий ровно столько же, сколько живёт компонент. Плюс сразу добавляет `.c`, чтобы сигнал можно было рендерить напрямую. Это ощущается как обычный локальный state, только вместо `setState` ты пишешь в `sig.v`, а всё остальное (derived, эффекты, зависимости) строится поверх сигнального графа.

```tsx
function Form() {
  const query = useSignal('');

  return (
    <div>
      <input value={query.v} onChange={(e) => (query.v = e.target.value)} />
      <div>typed: {query.c}</div>
    </div>
  );
}
```

---

## `useSignalValue(sg)` — подписка на существующий сигнал/компьютед

Если сигнал создан где-то снаружи (в модуле, сервисе, контексте), `useSignalValue` даёт “React-подписку” на него и возвращает текущее значение (или `ErrorSnapshot`). Когда ты не владеешь сигналом, но хочешь показывать его в UI — это оно.

```tsx
export const userName = signal('Alice');

function Header() {
  const v = useSignalValue(userName);
  if (isErrorSnapshot(v)) return renderValue(v);
  return <div>User: {v}</div>;
}
```

---

## `signalRC(initialValue)` — сигнал с `.c`, но без хука

Иногда сигнал хочется создать вне компонента (как модульный store), но всё равно иметь `.c` для удобного рендера. `signalRC` делает именно это: создаёт Signal и сразу подцепляет к нему реактовскую подписку и `.c`.

```tsx
export const counter = signalRC(0);

function App() {
  return <button onClick={() => (counter.v += 1)}>{counter.c}</button>;
}
```

---

## `useComputed(fn)` — derived-значение, которое рендерится само

`useComputed` создаёт `Computed`, добавляет ему `.c` и следит, чтобы React обновлялся, когда computed меняется. По ощущениям это “как `useMemo`”, только deps не нужны: зависимости строятся автоматически по чтениям `.v`, а ошибки computed переживаются безопасно через `safeSnapshot`.

```tsx
function Price() {
  const amount = useSignal(2);
  const price = useSignal(10);

  const total = useComputed(() => amount.v * price.v);

  return (
    <div>
      total: {total.c}
      <button onClick={() => (amount.v += 1)}>+1</button>
    </div>
  );
}
```

---

## `useWatch(fn, deps?, priorityOrMode?, opts?)` — эффект, но реактивный

`useWatch` — это “React-friendly мост” к `Effect` из ядра. Он создаёт `Effect`, аккуратно диспоузит его при размонтировании/смене deps, и при этом зависимости строятся реактивно — через чтение `.v` внутри эффекта, а не через ручной deps-массив.

```tsx
function Logger() {
  const count = useSignal(0);

  useWatch(() => {
    console.log('count changed:', count.v);
  });

  return <button onClick={() => (count.v += 1)}>{count.c}</button>;
}
```

---

## `isErrorSnapshot(x)` — маленький хелпер для computed-ошибок

`safeSnapshot` возвращает либо значение, либо `{ __stmError: ... }`. `isErrorSnapshot` — это guard, чтобы быстро понять, что прилетело, и показать fallback.

```tsx
const v = useSignalValue(someComputed);
if (isErrorSnapshot(v)) return renderValue(v);
return <div>{v}</div>;
```

---
## `useSignalMap(initialValue, deps?)` — список, который обновляется точечно

А вот теперь самое вкусное: списки. `useSignalMap` создаёт `SignalMap`, “реактифицирует” leaf-сигналы внутри элементов (чтобы у каждого поля появился `.c`) и даёт методу списка `.map(renderFn)`. Важно, как это ощущается в UI: для `done` ты передаёшь в компонент конкретное значение и компонент реагирует на него обычным React-путём (props → render). А для `title.c` ты передаёшь уже готовый маленький изолированный реактивный кусочек UI, который сам подписан на `todo.title` и обновляется внутри себя — поэтому изменение текста не требует перерендеривать весь компонент строки.

И вот большой пример, где видно, что это не “демка ради демки”, а реально рабочая модель списка: добавлять/удалять, reverse, менять активный элемент, править title по текущему индексу — и всё это без `useState` и без ручных подписок. Важный момент: `title` мы прокидываем как `todo.title.c`, чтобы обновление текста происходило внутри встроенного реактивного мини-компонента, а не через перерендер всего компонента `TodoItem`.

```tsx
import { useRef } from 'react';
import { useSignal, useSignalMap } from 'shared/utils/_stm/react/react';

interface Todo {
  title: string;
  done: boolean;
  id: string;
}

export default function TodoApp() {
  const refInput = useRef<HTMLInputElement>(null);

  const activeIndex = useSignal(0);
  const todos = useSignalMap<Todo>([]);

  const createTask = (name = `New Task ${todos.length}`): Todo => {
    return { id: `${performance.now()}`, title: name, done: false };
  };

  const addTodo = () => todos.push(createTask());
  const removeTodo = () => todos.pop();
  const reverseTodos = () => todos.reverse();

  // ключи для React: стабильные, по id
  todos.itemKey = (todo) => todo.id.v;

  return (
    <div>
      <h3>Todos</h3>

      <button onClick={addTodo}>Добавить задачу</button>
      <button onClick={removeTodo}>Удалить задачу</button>
      <button onClick={reverseTodos}>reverse задачи</button>

      {todos.map((todo, index) => {
        return (
          <TodoItem
            isDone={todo.done.v}
            title={todo.title.c}
            remove={() => todos.removeAt(index)}
            replace={() => todos.replaceAt(index, createTask('sdfsdfsdfsdf'))}
            setActive={() => {
              todo.done.v = !todo.done.v;
              activeIndex.v = index;

              todos.forEach((item, _i) => {
                if (index === _i) return;
                item.done.v = false;
              });
            }}
          />
        );
      })}

      <input
        ref={refInput}
        type="text"
        onChange={({ currentTarget }) => {
          const idx = activeIndex.v;
          const list = todos.v;
          if (!list[idx]) return;

          list[idx].title.v = currentTarget.value;
        }}
      />
    </div>
  );
}

interface TodoItemProps {
  isDone: boolean;
  title: React.JSX.Element;
  setActive: () => void;
  remove: () => void;
  replace: () => void;
}

const TodoItem = ({ isDone, title, setActive, remove, replace }: TodoItemProps) => {
  return (
    <div style={{ background: isDone ? 'red' : 'green' }}>
      <h4>{title}</h4>

      <input
        type="checkbox"
        checked={isDone}
        onChange={() => {
          setActive();
        }}
      />

      <button onClick={remove}>удалить</button>
      <button onClick={replace}>заменить</button>
    </div>
  );
};
```
---

## Мини-резюме: что ты получаешь

Сигналы и computed, которые можно рендерить прямо как `{sig.c}`. Подписку “по-реактовски” через `useSyncExternalStore`, то есть корректно для concurrent. Ошибки computed не валят UI — у тебя всегда есть безопасный snapshot и понятный fallback. Эффекты пишутся реактивно через `useWatch`. А списки через `useSignalMap` становятся тем местом, где обновляется ровно то, что должно обновляться — и никто не притворяется, что `map()` это повод перерисовать вселенную.
