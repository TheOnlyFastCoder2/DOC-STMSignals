# `<Active>` — маленький реактивный помощник

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
```

Здесь `<Active>` работает как «охранник видимости»:

> Покажи иконку только тогда, когда `isCheck.v === true`.

---

## Сигнатура `<Active>`

```ts
const isUndefined = Symbol('undefined');

type Sg = TRSignal<any> | Signal<any> | TRComputed<any>;

interface ActiveProps<T> {
  sg?: Sg | typeof isUndefined; // главный сигнал (можно не передавать)
  triggers?: Sg[]; // дополнительные сигналы
  is?: T | T[] | ((v: T) => boolean) | typeof isUndefined;
  callback?: (v: boolean) => void;
  children: React.ReactNode | (() => React.ReactNode);
  ch?: React.ReactNode | (() => React.ReactNode); // явный контент (предпочтительно в примерах)
}
```

Внутри:

- `sg` — основная реактивная «опора»;
- `triggers` — дополнительные сигналы, которые тоже должны дергать эффект;
- `is` — условие показа (или «режим работы»);
- `ch` / `children` — то, что нужно отрендерить (обычно в доке используем именно `ch`).

---

## Режим 1: «охранник видимости» (`sg` + `is`)

Это тот же паттерн, что у `Checker` или ошибки формы:

```tsx
<Active sg={isCheck} is={true} ch={<Svg className={$.icon} />} />
```

Или с функцией:

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

Логика: `<Active>` сам считает `result: boolean` и рендерит `ch`, только если `result === true`.

---

## Режим 2: «просто подписчик» (`sg` + `triggers`, без `is`)

Кейс с тегами, теперь в «чистой» версии через `ch`:

```tsx
{
  tags.map(([tag, isActive], index) => (
    <Active
      key={index}
      sg={isActive}
      triggers={[tag]}
      ch={() => (
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
        >
          {tag.v}
        </Button>
      )}
    />
  ));
}
```

Что тут важно:

- `sg={isActive}` — основной сигнал «выделен/не выделен»;
- `triggers={[tag]}` — доп. сигнал с текстом тега (меняется при смене языка);
- `is` не передан → `<Active>` **не скрывает** `ch`, он просто:

  - подписывается на `isActive` и `tag`;
  - при изменении любого из них дергает `setState`, тем самым заставляя React перерисовать кнопку.

Внутри `ch` мы читаем `isActive.v` и `tag.v` и всегда получаем актуальные данные.

---

## Режим 3: «подписаться только на triggers» (без `sg`)

Можно использовать `<Active>` даже без `sg`:

```tsx
<Active triggers={[someSignal]} ch={() => <Block value={someSignal.v} />} />
```

В этом случае:

- `<Active>` будет слушать только `triggers`;
- при любом изменении сигналов в `triggers` просто форсит ререндер `Block`;
- видимость не контролируется — `Block` всегда рендерится.

---

## Связка с `useSignalMap` и `replaceAll`

Тот самый сценарий с переводами:

```ts
const { t } = useTranslation();
const tags = useSignalMap<MapTags>(contactTags(t));

useLayoutEffect(() => {
  const newValues = contactTags(t);
  tags.replaceAll(newValues);
}, [t]);
```

- `useSignalMap` даёт реактивный список сигналов;
- `replaceAll` меняет содержимое при смене языка;
- `triggers={[tag]}` в `<Active>` гарантирует, что изменения текста тега («внутри» списка) доедут до React-дерева и перерисуют кнопки.

И `ch={() => <Button ... />}` — просто удобный способ передать рендер-функцию в `<Active>` без лишнего шума с `children`.
