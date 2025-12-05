## `<Active>` — маленький реактивный помощник

### Пример для понимания: чекбокс `Checker`

```tsx
interface Props {
  onChange?: (v: boolean) => void;
  initValue?: boolean;
  isError?: Signal<boolean>;
}

export default function Checker({ initValue = false, isError }: Props) {
  const isCheck = useSignal(initValue);
  const refDiv = useRef<HTMLDivElement>(null);

  useWatch(() => {
    refDiv.current?.toggleAttribute?.('active', isCheck.v);
    refDiv.current?.toggleAttribute?.('error', isError?.v);
  }, [isError]);

  const onClick = () => (isCheck.v = !isCheck.v);

  return (
    <div className={$.Checker} onClick={onClick} ref={refDiv}>
      <Active sg={isCheck} is={true}>
        <Svg className={$.icon} />
      </Active>
    </div>
  );
}
````

Что тут происходит по-человечески:

* `isCheck` — сигнал, который хранит, поставлен ли чекбокс.
* `useWatch` следит за сигналами и просто переключает атрибуты `active` / `error` на DOM-элементе.
* Внутри `div` мы рендерим:

  ```tsx
  <Active sg={isCheck} is={true}>
    <Svg className={$.icon} />
  </Active>
  ```

  То есть:

  > «Покажи иконку галочки **только тогда**, когда `isCheck.v === true`».

Это самый простой и честный пример: `<Active>` как маленький «охранник видимости» вокруг кусочка JSX.

---

## Что такое `<Active>` в целом

Сигнатура:

```ts
type Sg = TRSignal<any> | Signal<any> | TRComputed<any>;

interface ActiveProps<T> {
  sg: Sg;                                   // основной сигнал
  triggers?: Sg[];                          // дополнительные сигналы
  is?: T | T[] | ((v: T) => boolean) | typeof isUndefined;
  callback?: (v: boolean) => void;          // опциональный колбэк
  children: React.ReactNode | (() => React.ReactNode);
}
```

На уровне идей:

* `sg` — **главный реактивный источник**, вокруг которого крутится логика.
* `triggers` — «дополнительные поводы» пересчитать (ещё сигналы).
* `is` — *как* мы решаем, показывать детей или нет.
* `children` — контент, который либо всегда рендерится, либо показывается по условию.

Внутри `<Active>` поднимается `useWatch`, который:

1. читает все `triggers` и `sg`;
2. при их изменении заново прогоняет условие и, если надо, дергает `setState`;
3. это приводит к обычному React-ререндеру.

---

### Два режима работы `<Active>`

### 1. «Охранник видимости» (`Checker`, ошибка формы, и т.д.)

Когда ты передаёшь `is`, `<Active>` ведёт себя как условный рендер:

```tsx
<Active sg={isCheck} is={true}>
  <Svg />
</Active>
```

Или более сложный случай:

```tsx
<Active
  sg={field.sg.value}
  triggers={[form.isSubmitted, consentTouched]}
  is={() => {
    const val = field.sg.value.v as boolean;
    const shouldShowError = !val && (form.isSubmitted.v || consentTouched.v);
    checked.v = shouldShowError;
    return shouldShowError;
  }}
>
  <p className={$.error}>{t('contact.agreementError')}</p>
</Active>
```

Логика простая:

* читаем `sg.v` (и что нужно в `is`);
* считаем `result: boolean`;
* если `result === true` — рендерим `children`, иначе `null`;
* (опционально) зовём `callback(result)`.

То есть `<Active>` берёт на себя «if» вокруг разметки.

---

### 2. «Просто подписчик и форсер ререндера»

Если `is` *не* передан — `<Active>` никого не скрывает.
Он делает одну вещь: **слушает сигналы и перерисовывает детей**, когда они меняются.

Это как раз кейс с тегами:

```tsx
{tags.map(([tag, isActive], index) => (
  <Active
    key={index}
    sg={isActive}
    triggers={[tag]}
  >
    {() => (
      <Button
        onClick={() => {
          isActive.v = !isActive.v;
          tags.forEach(([_, isActive], ind) => {
            if (ind === index) return;
            isActive.v = false;
          });
        }}
        className={$.tag}
        variant="tag"
        size="sm"
        isActive={isActive.v as boolean}
        children={tag.v}
      />
    )}
  </Active>
))}
```

Здесь:

* `sg={isActive}` — выделен тег или нет;
* `triggers={[tag]}` — текст тега (зависит от языка).

`<Active>`:

* всегда рендерит детей;
* но следит и за `isActive`, и за `tag`;
* если меняется только `tag.v` (например, при смене языка) — он форсит ререндер, и кнопка получает новый текст.

Без `triggers={[tag]}` текст бы не обновился, пока не щёлкнешь по тегу.

---

## Коротко про `useSignalMap` и `replaceAll`

Чтобы картинка была полной, смотрим на верхний слой:

```ts
const { t } = useTranslation();
const tags = useSignalMap<MapTags>(contactTags(t));

useLayoutEffect(() => {
  const newValues = contactTags(t);
  tags.replaceAll(newValues);
}, [t]);
```

* `contactTags(t)` возвращает обычный массив `[label, isActive, id]`.
* `useSignalMap` превращает его в реактивный список: каждый элемент — набор сигналов.
* когда меняется язык `t`, `replaceAll`:

  * перезаписывает данные;
  * обновляет `tag.v` у элементов;
  * дергает подписчиков (в том числе `<Active>`).

Дальше всё складывается:

* `useSignalMap` + `replaceAll` меняют данные (например, тексты на другой язык);
* `<Active>` с `sg` и `triggers` следит за нужными сигналами и делает так, чтобы React-дерево вовремя перерисовалось;
* по месту ты просто пишешь JSX (`<Button ... />`) и читаешь `.v` у сигналов, не думая о том, кто за чем следит под капотом.

```
