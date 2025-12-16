# Анимации на основе `<Spring>`

Все анимации в этом шаблоне (включая скролл-анимации, hover-эффекты, 3D-наклон карточек и мягкие появляющиеся блоки) построены вокруг одного компонента — [`<Spring>`](#spring).

Это ссылка на сайт с примерами: https://open-react-template-4pyf.vercel.app/  
Git репозиторий сайта: https://github.com/TheOnlyFastCoder2/open-react-template

Ключевая идея: **React-дерево остаётся максимально стабильным**.

- `<Spring>` рендерится один раз при маунте и один раз при размонтировании.
- Во время самой анимации **React не перерисовывает компонент на каждый кадр**.
- Движение реализовано через сигналы: значения (scale, opacity, rotateX, rotateY, тени и т.п.) хранятся в реактивном ядре, а эффекты аккуратно пишут их в `style` конкретного DOM-узла.

В отличие от типичных решений вроде фреймворков анимаций, которые гоняют React-state или триггерят ререндеры на каждом кадре, здесь анимируются только **числа в сигналах и инлайн-стили**.  
React занимается структурой и разметкой, а `<Spring>` — физикой движения, видимостью, откликом на курсор/скролл и отладкой (`debug` для зон видимости).

Дальше по разделу мы разбираем:

- как настраивать `spring`-профиль (scale, opacity, translate, rotateX/rotateY, тени…);
- как привязывать анимацию к видимости (`visibility`);
- как работать с фазами (`enter`, `leave`, `down`, `up`, `active`);
- как устроен `debug`-режим, который рисует горизонтальные «линии входа/выхода» для анимаций поверх страницы.

Все примеры ниже — это вариации одного и того же строительного блока `<Spring>`.

### API по-простому

```ts
type SpringPhase = 'enter' | 'leave' | 'down' | 'up' | 'default' | 'active';
type TransformStyleValue = 'flat' | 'preserve-3d';
type ReactiveLike<T> = { readonly v: T };

type SpringPropConfig = {
  values?: Partial<Record<SpringPhase, any>>;
  stiffness?: number;
  damping?: number;
  isMobile?: boolean;

  isActive?: ReactiveLike<boolean>;
  phase?: ReactiveLike<SpringPhase>;
  triggers?: ('hover' | 'enter' | 'leave' | 'up' | 'down')[];
};

const initConfig = {
  scale: 1,
  rotate: 0,
  depth: 0,
  opacity: 1,
  boxShadow: 0,
  translateY: 0,
  translateX: 0,
  shadowColor: [0, 0, 0, 0],
  perspective: 50,
  perspectiveOrigin: [50, 50],
  transformOrigin: 'center',
  rotateY: 0,
  rotateX: 0,
  transformStyle: 'flat' as TransformStyleValue,
};

export interface SpringProps {
  children?: React.ReactNode;
  spring?: Partial<Record<keyof typeof initConfig, SpringPropConfig>>;
  triggers?: ('hover' | 'enter' | 'leave' | 'up' | 'down')[];
  isActive?: ReactiveLike<boolean>;
  visibility?: Parameters<typeof useVisibilitySignal>[0];
  className?: string;
  classInner?: string;
  moveShadow?: boolean;
  isMove?: boolean;
  coverThreshold?: number;
  phases?: SpringPhase[];
  onToggle?: (v?: boolean) => void;
  index?: number;
  total?: number;
}
```

Запомнить стоит только:

- `spring` — **карта свойств** (`scale`, `opacity`, `translateX`…) → конфиг пружины;
- `triggers` — список событий указателя, на которые этот `Spring` реагирует;
- `visibility` — правила «когда считается видимым» (через `useVisibilitySignal`);
- `isActive` / `phase` — внешнее реактивное управление фазой;
- `phases + onToggle` — обратная связь: «когда элемент вошёл в нужную фазу»;
- `className` / `classInner` — классы на внешней и внутренней обёртке.

---

## 1. Самый простой пример: появление по видимости

Небольшой конфиг:

```ts
// animations.ts
export const animText = {
  spring: {
    opacity: { values: { default: 0, active: 1 }, stiffness: 100, damping: 20 },
    scale: { values: { default: 0.9, active: 1 }, stiffness: 140, damping: 70 },
  },
};
```

Использование:

```tsx
import { Spring } from './Spring';
import { animText } from './animations';

function FeaturesSection() {
  return (
    <section className="FeaturesSection">
      <div className="FeaturesSectionHeader">
        <Spring
          {...animText}
          visibility={{
            enterAt: [[0, 1]], // как только блок попал в окно
          }}
        >
          <h2 className="FeaturesSectionTitle">Built for modern product teams</h2>
        </Spring>

        <Spring
          {...animText}
          visibility={{
            enterAt: [[0, 1.05]],
            delay: 300,
          }}
        >
          <p className="FeaturesSectionSubtitle">Open AI reads and understands your files…</p>
        </Spring>
      </div>
    </section>
  );
}
```

Ментальная модель:

- пока элемент **не** в зоне `enterAt` → фаза `default` (`opacity = 0`, `scale = 0.9`);
- когда вошёл в зону видимости → фаза `active` → сигналы плавно переходят к `opacity = 1`, `scale = 1`.

---

## 2. Как устроен `spring` внутри

`spring` — это объект вида:

```ts
spring={{
  scale: {
    values: {
      default: 1,
      active:  1.1,
      enter:   1.2,
      leave:   0.9,
    },
    stiffness: 140,
    damping: 10,
    triggers: ['hover'], // реагировать на enter/leave как на hover
  },
  opacity: {
    values: { default: 0, active: 1 },
    stiffness: 80,
    damping: 20,
  },
}}
```

Каждое свойство:

- берётся из `initConfig` (поддерживаемый список);

- может задать `values` по фазам:

  - если есть `values[phase]` → берем его;
  - иначе, если есть `values.default` → используем его;
  - иначе — значение из `initConfig`;

- `stiffness` и `damping` управляют «жёсткостью» и «затуханием» пружины;

- `triggers` можно задать локально для конкретного свойства (если нужно, чтобы на hover реагировал только `scale`, а не всё подряд).

Фазы:

- **событийные**: `enter`, `leave`, `down`, `up`;
- **состояния**: `default`, `active`.

`Spring` при смене фазы делает `batch(() => { ... })` и разом обновляет все сигналы `st.*`, а `useSpringSignal` уже плавно доводит DOM до нужных значений.

---

## 3. Hover / press: `triggers` и фазовые значения

Карточка, которая слегка «дышит» на hover и при нажатии:

```tsx
function FeatureCard({ title, text }: { title: string; text: string }) {
  return (
    <Spring
      className="FeatureCard"
      triggers={['hover', 'down', 'up']}
      spring={{
        scale: {
          values: {
            leave: 1, // курсор ушёл
            enter: 1.05, // навели
            down: 0.97, // зажали кнопку
          },
          stiffness: 120,
          damping: 10,
        },
        boxShadow: {
          values: {
            leave: 0,
            enter: 10,
          },
          stiffness: 120,
          damping: 18,
        },
      }}
      phases={['leave', 'enter']}
      onToggle={(isHovered = false) => {
        console.log('hover state:', isHovered);
      }}
    >
      <div className="FeatureCardInner">
        <h3 className="FeatureCardTitle">{title}</h3>
        <p className="FeatureCardText">{text}</p>
      </div>
    </Spring>
  );
}
```

Здесь:

- `triggers={['hover', 'down', 'up']}` включает pointer-обработчики;
- `values.leave/enter/down` описывают, как должен вести себя `scale` и `boxShadow`;
- `phases + onToggle` дают простой callback о переходе `leave ↔ enter`.

---

## 4. Внешнее управление: `isActive` и реактивная логика

Здесь логика очень простая, но она размазана по двум `Spring`, поэтому кажется сложной. У тебя есть два общих сигнала на всю сетку: `activeIndex` и `isTitleActive`. Нижний `Spring`, который оборачивает `<p>`, занимается чисто «ощущением» пользователя: он реагирует на `hover / down / up`, и через `onToggle` записывает в сигналы, какая карточка сейчас под курсором и активна ли она вообще. То есть именно этот `Spring` решает: «сейчас активна карточка с индексом `i`, и состояние активности — да/нет».

Верхний `Spring`, который оборачивает заголовок, вообще ничего не знает про hover, он даже не слушает события указателя. Он просто смотрит на состояние: через `isActive` с геттером `get v()` он проверяет, совпадает ли его индекс с `activeIndex` и включён ли флаг `isTitleActive`. Если да — для этой карточки `Spring` считает себя активным и переводит анимацию в фазу `active` (в нашем случае это сдвиг заголовка по `translateX`). Если нет — держится в `default`. В результате нижний `Spring` выступает как «сенсор» (переводит жесты пользователя в сигналы), а верхний — как «витрина» (просто красиво реагирует на эти сигналы), и вся магия крутится вокруг маленького условия внутри `isActive`.

```tsx
import { useSignal } from '../react';

function FeaturesGrid({ items }: { items: { title: string; text: string }[] }) {
  const activeIndex = useSignal(-1);
  const isTitleActive = useSignal(false);

  return (
    <div className="FeaturesGrid">
      {items.map((item, i) => (
        <article key={i} className="FeaturesGridItem">
          {/* Заголовок сдвигается, если карточка активна */}
          <Spring
            isActive={{
              get v() {
                return isTitleActive.v && activeIndex.v === i;
              },
            }}
            spring={{
              translateX: {
                values: {
                  default: 0,
                  active: 16,
                },
                stiffness: 120,
                damping: 20,
              },
            }}
          >
            <h3 className="FeatureCardTitle">{item.title}</h3>
          </Spring>

          {/* Текст сам включает/выключает активность через hover */}
          <Spring
            triggers={['hover', 'down', 'up']}
            spring={{
              scale: {
                values: {
                  leave: 1,
                  enter: 1.05,
                },
                stiffness: 120,
                damping: 10,
              },
            }}
            phases={['leave', 'enter']}
            onToggle={(val = false) => {
              activeIndex.v = i;
              isTitleActive.v = val;
            }}
          >
            <p className="FeatureCardText">{item.text}</p>
          </Spring>
        </article>
      ))}
    </div>
  );
}
```

## 5. `visibility`: когда Spring «виден» и что с этим делать

`visibility` — это конфиг для `useVisibilitySignal`, который `Spring` использует внутри. Через него можно:

- задать, где элемент **входит** в активную зону (`enterAt`);
- где он из неё **выходит** (`leaveAt`);
- добавить `delay`;
- включить `debug` (об этом ниже).

Пример:

```tsx
<Spring
  spring={{
    opacity: { values: { default: 0, active: 1 } },
    translateY: { values: { default: 24, active: 0 } },
  }}
  visibility={{
    enterAt: [[0.1, 0.9]], // 10–90% высоты окна
    leaveAt: [[0.9, 1.2]], // считаем «ушёл», когда выезжает ниже 90–120%
    delay: 150,
  }}
>
  <div className="VisibilityBlock">Я появляюсь и исчезаю по скроллу</div>
</Spring>
```

Мысленно:

- `enterAt` — список промежутков по высоте viewport (0 — верх, 1 — низ, можно выходить за пределы);
- `leaveAt` — аналогично, но для выхода;
- пока элемент между `enterAt` → `visible = true` → `Spring` переключает фазу `default → active`;
- когда вышел из `leaveAt` → `visible = false` → `Spring` возвращается в `default` (или что вы настроили через `setPhase`/`coverThreshold`).

---

## 6. `debug: true` — режим линейки для visibility

Чтобы на глаз не гадать, где именно проходит граница `enterAt`/`leaveAt` (особенно на разных устройствах), в `visibility` есть флаг:

```tsx
<Spring
  spring={{
    opacity: { values: { default: 0, active: 1 } },
  }}
  visibility={{
    enterAt: [[0.1, 0.9]],
    leaveAt: [[0.9, 1.2]],
    debug: true,
  }}
>
  <div className="DebugDemoBlock">Я анимируюсь между линиями debug</div>
</Spring>
```

При `debug: true`:

- `useVisibilitySignal` рисует **горизонтальные полоски-маркеры** поверх контента;
- каждая полоска — это «endpoint» ваших зон `enterAt`/`leaveAt`;
- координаты считаются относительно окна: `0` — верх viewport, `1` — низ, отрицательные/больше 1 — выше/ниже текущего экрана.

Профит:

- открываешь страницу на десктопе / планшете / телефоне;
- видишь, **где именно** начинается зона входа/выхода;
- быстро регулируешь числа, вместо игры «на глаз»;
- можно включать только в dev-режиме.

---

## 7. Перекрытие и `coverThreshold`

Ещё одна фишка связки `Spring + visibility` — работа с перекрытием (cover):

```ts
useWatch(() => {
  if (!vis || !st.wasVisibleOnce.v) return;
  const el = vis.ref.current;
  if (!el) return;
  const isLast = index === total;
  const hide = isLast ? 0 : Math.min(1, vis.overlap.v * 2);
  const covered = !isLast && hide > coverThreshold;
  setPhase(covered || !vis.visible.v ? 'default' : 'active', st, spring);
});
```

- `vis.overlap.v` говорит, насколько элемент перекрыт другим (0–1);
- `coverThreshold` (по умолчанию ~0.35) — порог, после которого элемент считается «накрытым»;
- `Spring` может автоматически переключать фазу `active → default`, если элемент перекрыт достаточно сильно (например, в стопке карточек).

---

## 8. Движение за мышью: `isMove` и `moveShadow`

Все «tilt-эффекты» и живая подсветка карточек держатся на двух вещах:

* внутренняя логика `Spring` (`isMove`, `rotateX`, `rotateY`, `moveShadow`);
* простые стили с CSS-переменными `--mouse-x` / `--mouse-y`.

Идея простая: `Spring` не ререндерит React-дерево на каждый кадр — он **только один раз монтирует компонент**, а дальше на `mousemove`:

* обновляет сигналы `st.rotateX` / `st.rotateY` (наклон карточки);
* если включён `moveShadow`, пишет координаты указателя в CSS-переменные `--mouse-x` и `--mouse-y`.

Дальше всё делает чистый CSS: наклон — через `transform`, подсветка — через `translate(var(--mouse-x), var(--mouse-y))` у псевдоэлементов.

---

### JSX: `Spring` вокруг карточки

```tsx
import '@/app/css/workflows.css';
import Image from 'next/image';
import WorflowImg01 from '@/public/images/workflow-01.png';
import WorflowImg02 from '@/public/images/workflow-02.png';
import WorflowImg03 from '@/public/images/workflow-03.png';
import { Spring } from '@/utils/stm/react/animation/Spring';
import { animSubLabel, animText } from '@/app/animations';

const cards = [
  {
    img: WorflowImg01,
    alt: 'Workflow 01',
    label: 'Built-in Tools',
    text: "Streamline the product development flow with a content platform that's aligned across specs and insights.",
  },
  {
    img: WorflowImg02,
    alt: 'Workflow 02',
    label: 'Scale Instantly',
    text: "Streamline the product development flow with a content platform that's aligned across specs and insights.",
  },
  {
    img: WorflowImg03,
    alt: 'Workflow 03',
    label: 'Tailored Flows',
    text: "Streamline the product development flow with a content platform that's aligned across specs and insights.",
  },
];

export default function Workflows() {
  return (
    <section id="Workflows">
      <div className="wf-container">
        <div className="wf-block">
          {/* Заголовок секции */}
          <div className="wf-header">
            <div className="wf-sublabel">
              <Spring visibility={{ enterAt: [[0, 1]] }} {...animSubLabel}>
                <span className="wf-gradientText">Tailored Workflows</span>
              </Spring>
            </div>

            <Spring {...animText} visibility={{ enterAt: [[0, 1]] }}>
              <h2 className="wf-title">Map your product journey</h2>
            </Spring>

            <Spring {...animText} visibility={{ enterAt: [[0, 1]], delay: 500 }}>
              <p className="wf-desc">
                Simple and elegant interface to start collaborating with your team in minutes. It seamlessly
                integrates with your code and your favorite programming languages.
              </p>
            </Spring>
          </div>

          {/* Карточки с tilt + подсветкой */}
          <div className="wf-grid wf-group">
            {cards.map((card, i) => (
              <Spring
                key={i}
                isMove
                moveShadow
                triggers={['down']}
                classInner="wf-gridInner"
                spring={{
                  perspective: { values: { default: 700 } },
                  rotateX: { stiffness: 120, damping: 30 },
                  rotateY: { stiffness: 120, damping: 30 },
                }}
              >
                <a href="#0" className="wf-card">
                  <div className="wf-cardInner">
                    {/* Стрелка в углу */}
                    <div className="wf-cardArrow" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" width={9} height={8} fill="none">
                        <path
                          fill="#F4F4F5"
                          d="m4.92 8-.787-.763 2.733-2.68H0V3.443h6.866L4.133.767 4.92 0 9 4 4.92 8Z"
                        />
                      </svg>
                    </div>

                    {/* Картинка */}
                    <Image
                      className="wf-img"
                      src={card.img}
                      width={350}
                      height={288}
                      alt={card.alt}
                    />

                    {/* Контент */}
                    <div className="wf-cardContent">
                      <div className="wf-cardBadgeWrap">
                        <span className="wf-badge">
                          <span className="wf-gradientText">{card.label}</span>
                        </span>
                      </div>
                      <p className="wf-cardText">{card.text}</p>
                    </div>
                  </div>
                </a>
              </Spring>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
```

* `isMove` включает обработку `mousemove` / `mouseleave`: `Spring` подписывается на движение мыши над обёрткой.
* `moveShadow` говорит: «помимо наклона, ещё и прокидывай координаты в CSS-переменные».
* `spring.rotateX` / `spring.rotateY` задают пружинящие параметры вращения: `stiffness`/`damping` управляют тем, насколько быстро и плавно карточка догоняет мышь.
* `perspective` задаёт глубину 3D-сцены — видим, как хорошо ощущается наклон.

---

### CSS: внутренняя подсветка, которая ездит за мышью

```css
.wf-card {
  position: relative;
  display: block;
  height: 100%;                /* h-full */
  overflow: hidden;
  border-radius: 1rem;         /* rounded-2xl */
  background-color: #1f2937;   /* bg-gray-800 */
  padding: 1px;                /* p-px */
  text-decoration: none;
}

.wf-card::before,
.wf-card::after {
  content: "";
  pointer-events: none;
  position: absolute;
  border-radius: 9999px;       /* rounded-full */
  opacity: 0;
  filter: blur(64px);          /* blur-3xl */
  transition: opacity 500ms;   /* transition-opacity duration-500 */
  transform: translate(var(--mouse-x), var(--mouse-y));
}

.wf-card::before {
  left: -10rem;                /* -left-40 */
  top: -10rem;                 /* -top-40 */
  z-index: 10;
  width: 20rem;                /* w-80 */
  height: 20rem;               /* h-80 */
  background-color: rgba(99, 102, 241, 0.8); /* indigo-500/80 */
}

.wf-card::after {
  left: -12rem;                /* -left-48 */
  top: -12rem;                 /* -top-48 */
  z-index: 30;
  width: 16rem;                /* w-64 */
  height: 16rem;               /* h-64 */
  background-color: #6366f1;   /* indigo-500 */
}
```

Внутри самого `Spring` при включённом `isMove` на каждый `mousemove` выполняется примерно такая логика (упрощённо):

* берём `el.getBoundingClientRect()` для внешней обёртки;
* считаем `dx` и `dy` — смещение курсора от центра карточки в диапазоне примерно `[-1, 1]`;
* из этих `dx`/`dy` считаем углы `rotateX` и `rotateY` (например, ±12°) и записываем в сигналы `st.rotateX.v` / `st.rotateY.v`;
* если `moveShadow === true`, считаем координаты курсора внутри карточки и пишем их в CSS-переменные `--mouse-x` и `--mouse-y`.


А CSS-переменные `--mouse-x` / `--mouse-y` уже используются псевдоэлементами `.wf-card::before` / `.wf-card::after`:

```css
.wf-card::before,
.wf-card::after {
  transform: translate(var(--mouse-x), var(--mouse-y));
}
```

В итоге картинка выглядит так:

* сама карточка живёт в 3D-пространстве: слегка наклоняется за мышью за счёт `rotateX` / `rotateY` и `perspective`;
* внутри неё плавает мягкое световое пятно (два размазанных круга `before` / `after`), которое **строго следует за курсором** по `--mouse-x` / `--mouse-y`;
* все движения сглажены пружинами (`stiffness` / `damping`), поэтому наклон и подсветка не дёргаются, а плавно догоняют руку.

React при этом вообще не страдает: `Spring` не делает «setState на каждый кадр», не рендерит JSX в цикле — он один раз монтирует дерево и дальше работает через сигналы и `style`, как аккуратный маленький движок анимаций.

## 9. Ментальная модель Spring

Если всё упростить:

- внутри каждый `Spring` держит набор сигналов `st.*` (target-значения);
- поверх них — пружинные сигналы (через `useSpringSignal`), которые плавно догоняют цель;
- фазы (`default`, `active`, `enter`, `leave`, `down`, `up`) и внешние сигналы (`isActive`, `phase`, `visibility`) только меняют `st.*`;
- а `useWatch` переносит их в `style` (`transform`, `opacity`, `boxShadow`, `perspective` и т.д.).

Ты же снаружи работаешь простыми вещами:

- конфигом `spring` с фазами;
- `visibility` (плюс `debug`, если нужно «линейкой» померить зоны);
- `triggers` и/или `isActive`;
- обычной разметкой с классами.

В итоге `<Spring>` превращает сигналы и события в аккуратные «пружины интерфейса», не заставляя вручную писать тонну `useEffect`, подписок и анимаций.
