# Active - контроль жизни DOM

## Введение

Active — это маленький реактивный “привратник” для React: он решает, **когда вообще показывать кусок дерева** и **когда его пересчитать**, но делает это не через цепочку `useState/useMemo/memo`, а через твои сигналы и `useWatch`.

И это особенно приятно в модалках. Потому что “реальная боль” в React обычно выглядит так: Popup/Modal перерендерился из-за какой-нибудь мелочи → DOM пересоздался → enter-анимация снова стартанула (или наоборот сбросилась), и ты начинаешь плясать с мемоизацией. Active позволяет сделать проще: ты даёшь конкретному месту один сигнал-триггер “показываться/не показываться”, и оно живёт своей жизнью, не дёргая весь Popup.

---

## Что делает Active

Представь, что у тебя есть кусок UI, который должен появляться только “в правильный момент”. Не «когда React решит», не «когда родитель перерендерится», а по твоему правилу. Active — это именно такой шлагбаум: он читает сигналы, понимает, “да/нет”, и либо **пускает DOM внутрь**, либо **держит дверь закрытой**. В итоге у тебя появляется ощущение контроля: ты не лечишь последствия перерендеров, ты заранее ставишь привратника там, где они вредят.

---

## API (коротко)

```tsx
<Active
  sg={someSignalOrComputed}
  is={value | values[] | (v => boolean)}
  triggers={[sg1, sg2]}
  callback={(active) => {}}
  ch={() => <YourUI />}
/>
```

---

## Самый частый кейс: сцены внутри модалки, которые не мешают друг другу жить

В модалках часто есть “сцены”: сегодня показываем одну, завтра другую. И хочется, чтобы невидимая сцена **реально исчезала** — без фоновых эффектов, без лишнего DOM, без случайных ресетов анимации.

`type` хранит “какая сцена сейчас”. Каждый `Active` просто смотрит на `type.v` и решает: *мне жить или мне уйти*.

```tsx live noInline render(<App />)
function useModalViwer() {
  const isOpen = useSignal(false);
  const type = useSignal('Modal1');
  
  return {
    isOpen,type,
    Popup: () => (
      <Popup
        className={$.ModalTest}
        classNameContent={$.ModalTestContent}
        isOpen={isOpen}
        delay={400}
      >
        <Spring isActive={isOpen} spring={{
          scale: {
            values: {default:0.2, active: 1},
            damping: 4,
            stiffness: 40,
          },
          opacity: {
            values: {default:0, active: 1},
            damping: 10,
            stiffness: 40,
            speed: 3
          }
        }}>
          <DraggableHeader className={$.ModalTestHeader}>
            <Active sg={type} is={'Modal1'}>
              <div>
                <p>тут какой то текст для</p>
                <h1>Modal1</h1>
              </div>
            </Active>
            <Active sg={type} is={'Modal2'}>
              <div>
                <p>тут какой то текст для</p>
                <h1>Modal2</h1>
              </div>
            </Active>
          </DraggableHeader>
        </Spring>
      </Popup>
     
    ),
  };
}
function App () {
  const { Popup, isOpen, type } = useModalViwer();
  return (
   <>
    <Popup/>
     <div className={$.ModalWins}>
       <div className={$.header}>
         <button onClick={() => (isOpen.v = true)}>toOpen</button>
         <button onClick={() => (isOpen.v = false)}>toClose</button>
 
         <button onClick={() => (type.v = 'Modal1')}>Modal1</button>
         <button onClick={() => (type.v = 'Modal2')}>Modal2</button>
       </div>
     </div>
   </>
  )
}
```

Смысл простой: ты не “условно рендеришь где-то сверху”, ты **точечно отдаёшь конкретному месту** правило жизни. И оно не зависит от того, что там дернулось рядом.

---

## Пример по делу: “галочка живёт отдельно” (и не заставляет тебя писать условия руками)

Чекбокс — идеальная сцена для `Active`, потому что тут постоянно хочется сделать “переключалку”, но без ручных `?: null` и без лишней возни в JSX. В этом примере сигнал `isActive` отвечает за состояние, а `Active` превращает это состояние в **контроль жизни DOM**: когда `isActive` `true` — в разметку реально монтируется только `SVGSun`, когда `false` — только `SVGMoon`. То есть иконки не “прячутся стилями”, а буквально появляются и исчезают как отдельные узлы. Параллельно `useWatch` спокойно занимается контейнером (классы/стили/атрибуты) и не смешивается с логикой “что рисовать” — `Active` берёт на себя именно это решение, делая переключение чище и предсказуемее.

```tsx live noInline render(<CheckBox />)
interface CheckBoxProps {
  className?: string;
  onClick?: (v: boolean, e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

function CheckBox({ className, onClick }: CheckBoxProps) {
  const isActive = useSignal(false);
  const ref = useRef<HTMLDivElement>(null);

  useWatch(() => {
    const active = isActive.v;
    const el = ref.current;
    if (!el) return;
    el.classList.toggle($.active, active);
    console.log('active', active);
  });
  return (
    <div
      ref={ref}
      className={ `${$.CheckBox} ${className}` }
      data-button="data-button"
      onClick={(el) => {
        isActive.v = !isActive.v;
        onClick?.(isActive.v, el);
      }}
    >
      <div className={$.inner}>
        <div className={$.box}>
          <Active sg={isActive} is={true}>
            <SVGSun className={$.icon} />
          </Active>
          <Active sg={isActive} is={false}>
            <SVGMoon className={$.icon} />
          </Active>
        </div>
      </div>
    </div>
  );
}

```

---

## triggers: когда условие зависит не только от `sg`

Иногда “пора показывать” зависит от одного сигнала, но **пересчитываться** нужно ещё и по другим событиям. Тут `triggers` как колокольчик: Active просто читает их `.v`, и этого достаточно, чтобы они стали зависимостями.

```tsx
<Active
  sg={type}
  is={'Modal1'}
  triggers={[viewportMove]} // любой сигнал/компьютед
  ch={() => <Modal1 />}
/>
```

---

## Пример из жизни форм: ошибка “согласия” появляется только после submit или после “touched”

Это один из самых полезных паттернов: пользователь ещё не трогал поле — не бесим его ошибками. Но как только он попытался отправить форму или уже “потрогал” чекбокс — показываем сообщение.

Тут `sg` — значение чекбокса, а `triggers` — “сабмитнули форму” и “поле тронули”.

```tsx
<Active
  sg={field.sg.value}
  triggers={[form.isSubmitted, consentTouched]}
  is={() => {
    const checked = !!field.sg.value.v;
    return !checked && (form.isSubmitted.v || consentTouched.v);
  }}
  ch={() => <p className={$.error}>{t('contact.agreementError')}</p>}
/>
```

Выглядит как правило, а работает как механизм: меняется галочка — Active решает; нажали submit — Active пересчитывается; отметили touched — Active пересчитывается. И всё это без ручных `useState`-флагов вокруг ошибки.

---

## Мини-итог

Active — это про контроль над жизнью DOM: ты ставишь реактивный “шлагбаум” там, где React чаще всего делает больно (модалки, сцены, условные узлы, ошибки форм), и перестаёшь лечить симптомы мемоизацией. `sg` даёт состояние, `is` даёт правило, `triggers` — дополнительные поводы пересчитать, а `ch={() => ...}` делает это чисто и без лишней суеты.
