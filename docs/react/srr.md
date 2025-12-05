# SSR + сигналы: один запрос на весь проект

Вся фишка в том, что **проекты грузятся один раз на сервере**, кладутся в `ssrSignal`, а дальше ты просто читаешь `sgProjects.v` в любом месте приложения — и на сервере, и на клиенте.

---

### 1. Глобальный SSR-сигнал с проектами

```ts
// api/projects/index.ts
export const sgProjects = ssrSignal<Project[]>([], '/projects');
````

Это:

* глобальное хранилище `Project[]`;
* с фиксированным id `'/projects'`, по которому значение будет:

  * записано на сервере в `__SSR_STATE__`,
  * восстановлено на клиенте из `window.__SSR_STATE__`.

---

### 2. Loader наполняет сигнал на сервере

```ts
// root.tsx
export async function loader(_args: Route.LoaderArgs) {
  await project.list();
  await employees.get();
}

// api/projects/index.ts
export const project = {
  list: async (opts?) => {
    const results = await directus.request<Project[]>(
      readItems('projects', { /* ... */ })
    );

    const withNext = addNextItem(results as any);
    sgProjects.v = withNext;       // ← кладём в сигнал
    return withNext;
  },

  get: async (id: string) => {
    const cached = sgProjects.v.find((p) => p.id === id);
    if (cached) return cached;

    const project = await directus.request<Project>(
      readItem('projects', id, { /* ... */ })
    );

    sgProjects.v = addNextItem([...sgProjects.v, project]);
    return project;
  },
};
```

`loader` просто вызывает `project.list()`, а та:

* делает один запрос в Directus;
* кладёт результат в `sgProjects.v`.

Роутер получает данные, а ты — уже заполненный сигнал.

---

### 3. Прокидка состояния в HTML

```tsx
// root.tsx
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* ... */}
        <script
          dangerouslySetInnerHTML={{
            __html: getSSRStore(),
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

`getSSRStore()` сериализует все `ssrSignal` (в том числе `/projects`) в:

```js
window['__SSR_STATE__'] = {
  "/projects": [ /* список проектов */ ],
  // ...
};
```

На клиенте `ssrSignal('/projects')` увидит это и сразу подхватит значение в `sgProjects.v`.

---

### 4. Как этим пользоваться в компонентах

Самое приятное: в большинстве случаев тебе вообще не нужен отдельный хук —
**достаточно просто прочитать `sgProjects.v`**:

```tsx
import { sgProjects } from 'api/projects';

function ProjectsList() {
  const projects = sgProjects.v; // уже готовый список

  return (
    <ul>
      {projects.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  );
}
```

Работает так:

* на сервере `projects.v` уже заполнен в `loader`;
* сервер рендерит список;
* на клиенте `ssrSignal` поднимает то же значение из `window.__SSR_STATE__`;
* `sgProjects.v` сразу доступен, без доп. запросов и без проп-дриллинга.

Если нужен **реактивный** ререндер при обновлении `sgProjects`, можно поверх этого использовать `useSignalValue(sgProjects)`, но базовый кейс — «один запрос, `sgProjects.v` везде» — уже работает.

---


### 5. Детальная страница проекта: тот же кэш, тот же сигнал

Отдельный роут под страницу проекта выглядит так:

```tsx
export async function clientLoader({ params }: Route.LoaderArgs) {
  const result = await project.get(params.slug);
  if (!result) {
    throw new Response('Not found', { status: 404 });
  }
  return result;
}

export default function Project({ loaderData: data }: Route.ComponentProps) {
  return (
    <StartPage>
      <div className={$.Project}>
        <div className={$.container}>
          {data.blocks.map((block, ind) => (
            <Switcher key={ind} {...{ block }} nextProject={data.nextItem} />
          ))}
        </div>
      </div>
    </StartPage>
  );
}
````

Главное здесь — то, **что именно дергает `clientLoader`**:

```ts
const result = await project.get(params.slug);
```

А `project.get` уже умеет работать с `sgProjects`:

```ts
get: async (id: string) => {
  const cached = sgProjects.v.find((p) => p.id === id);
  if (cached) return cached;                     // ← сначала ищем в сигнале

  const project = await directus.request<Project>(readItem('projects', id, { ... }));
  sgProjects.v = addNextItem([...sgProjects.v, project]); // ← докидываем в общий список
  return project;
},
```

Что это даёт в сумме:

* Если ты пришёл на детальную страницу **из списка**:

  * `sgProjects.v` уже заполнен (`project.list()` вызывался в корневом `loader`);
  * `project.get(slug)` просто находит нужный проект в сигнале и **не делает новый запрос**.
* Если ты открыл детальную страницу «напрямую»:

  * `project.get(slug)` один раз делает запрос в API;
  * кладёт результат в `sgProjects.v`;
  * компонент получает `loaderData` и спокойно рендерит страницу;
  * при этом общий сигнал-кэш тоже обновлён.

И самое приятное: и список, и отдельная страница, и любые другие места в приложении смотрят в **один и тот же сигнал**:

```ts
import { sgProjects } from 'api/projects';

const projects = sgProjects.v; // тот же источник правды в любом месте проекта
```

SSR поднимает начальные данные, `ssrSignal` переносит их на клиент,
а `project.list` / `project.get` просто пополняют **одну общую реактивную коллекцию**.
В итоге ты:

* делаешь минимум запросов;
* не таскаешь данные пропсами и контекстами;
* в любой точке проекта можешь взять список или конкретный проект через `sgProjects.v` и быть уверен, что это актуальное состояние.
