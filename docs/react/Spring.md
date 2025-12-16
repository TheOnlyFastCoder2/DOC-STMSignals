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

* `spring` — **карта свойств** (`scale`, `opacity`, `translateX`…) → конфиг пружины;
* `triggers` — список событий указателя, на которые этот `Spring` реагирует;
* `visibility` — правила «когда считается видимым» (через `useVisibilitySignal`);
* `isActive` / `phase` — внешнее реактивное управление фазой;
* `phases + onToggle` — обратная связь: «когда элемент вошёл в нужную фазу»;
* `className` / `classInner` — классы на внешней и внутренней обёртке.

---

## 1. Самый простой пример: появление по видимости

Небольшой конфиг:

```ts
// animations.ts
export const animText = {
  spring: {
    opacity: { values: { default: 0, active: 1 }, stiffness: 100, damping: 20 },
    scale:   { values: { default: 0.9, active: 1 }, stiffness: 140, damping: 70 },
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
            enterAt: [[0, 1]],  // как только блок попал в окно
          }}
        >
          <h2 className="FeaturesSectionTitle">
            Built for modern product teams
          </h2>
        </Spring>

        <Spring
          {...animText}
          visibility={{
            enterAt: [[0, 1.05]],
            delay: 300,
          }}
        >
          <p className="FeaturesSectionSubtitle">
            Open AI reads and understands your files…
          </p>
        </Spring>
      </div>
    </section>
  );
}
```

Ментальная модель:

* пока элемент **не** в зоне `enterAt` → фаза `default` (`opacity = 0`, `scale = 0.9`);
* когда вошёл в зону видимости → фаза `active` → сигналы плавно переходят к `opacity = 1`, `scale = 1`.

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

* берётся из `initConfig` (поддерживаемый список);

* может задать `values` по фазам:

  * если есть `values[phase]` → берем его;
  * иначе, если есть `values.default` → используем его;
  * иначе — значение из `initConfig`;

* `stiffness` и `damping` управляют «жёсткостью» и «затуханием» пружины;

* `triggers` можно задать локально для конкретного свойства (если нужно, чтобы на hover реагировал только `scale`, а не всё подряд).

Фазы:

* **событийные**: `enter`, `leave`, `down`, `up`;
* **состояния**: `default`, `active`.

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
            leave: 1,    // курсор ушёл
            enter: 1.05, // навели
            down:  0.97, // зажали кнопку
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

* `triggers={['hover', 'down', 'up']}` включает pointer-обработчики;
* `values.leave/enter/down` описывают, как должен вести себя `scale` и `boxShadow`;
* `phases + onToggle` дают простой callback о переходе `leave ↔ enter`.

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

`visibility` — это конфиг для `useVisibilitySignal`, который `Spring` использует внутри.
Через него можно:

* задать, где элемент **входит** в активную зону (`enterAt`);
* где он из неё **выходит** (`leaveAt`);
* добавить `delay`;
* включить `debug` (об этом ниже).

Пример:

```tsx
<Spring
  spring={{
    opacity: { values: { default: 0, active: 1 } },
    translateY: { values: { default: 24, active: 0 } },
  }}
  visibility={{
    enterAt: [[0.1, 0.9]],   // 10–90% высоты окна
    leaveAt: [[0.9, 1.2]],   // считаем «ушёл», когда выезжает ниже 90–120%
    delay: 150,
  }}
>
  <div className="VisibilityBlock">
    Я появляюсь и исчезаю по скроллу
  </div>
</Spring>
```

Мысленно:

* `enterAt` — список промежутков по высоте viewport (0 — верх, 1 — низ, можно выходить за пределы);
* `leaveAt` — аналогично, но для выхода;
* пока элемент между `enterAt` → `visible = true` → `Spring` переключает фазу `default → active`;
* когда вышел из `leaveAt` → `visible = false` → `Spring` возвращается в `default` (или что вы настроили через `setPhase`/`coverThreshold`).

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
  <div className="DebugDemoBlock">
    Я анимируюсь между линиями debug
  </div>
</Spring>
```

При `debug: true`:

* `useVisibilitySignal` рисует **горизонтальные полоски-маркеры** поверх контента;
* каждая полоска — это «endpoint» ваших зон `enterAt`/`leaveAt`;
* координаты считаются относительно окна: `0` — верх viewport, `1` — низ, отрицательные/больше 1 — выше/ниже текущего экрана.

Профит:

* открываешь страницу на десктопе / планшете / телефоне;
* видишь, **где именно** начинается зона входа/выхода;
* быстро регулируешь числа, вместо игры «на глаз»;
* можно включать только в dev-режиме.

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

* `vis.overlap.v` говорит, насколько элемент перекрыт другим (0–1);
* `coverThreshold` (по умолчанию ~0.35) — порог, после которого элемент считается «накрытым»;
* `Spring` может автоматически переключать фазу `active → default`, если элемент перекрыт достаточно сильно (например, в стопке карточек).

---

## 8. Движение за мышью: `isMove` и `moveShadow`

Если нужно сделать «tilt-эффект» карточки:

```tsx
<Spring
  className="TiltCard"
  classInner="TiltCardInner"
  isMove
  moveShadow
  spring={{
    depth: {
      values: { default: 10, active: 20 },
    },
  }}
>
  <div className="TiltCardContent">
    Кручу-верчу, карточку наклоняю
  </div>
</Spring>
```

* `isMove` включает обработку `mousemove`/`mouseleave`;
* `Spring` считает, где находится курсор внутри блока, и обновляет сигналы `rotateX`/`rotateY`;
* `moveShadow` дополнительно пишет координаты в CSS-переменные `--mouse-x` / `--mouse-y` на внутренний элемент (`classInner`), чтобы можно было рисовать динамическую подсветку чистым CSS;
* на тач-устройствах всё это отключается (`(hover: hover)`).

---

здесь фокус простой: `Spring` превращает обычную карточку в живой 3D-объект, который и наклоняется за курсором, и таскает за собой мягкое световое пятно внутри. Снаружи ты просто пишешь `isMove moveShadow` и немного настроек для `perspective`, `rotateX` и `rotateY`, а всё остальное делает сам компонент.

Когда мышь движется по карточке, `Spring` берёт её `getBoundingClientRect()`, вычисляет смещение курсора от центра (dx, dy в диапазоне примерно от -1 до 1). Визуально это выглядит так, будто карточка чуть наклоняется в сторону точки, где сейчас курсор — как физический объект, лежащий на столе.

Параллельно, если передан флаг `moveShadow`, `Spring` на каждом движении мыши пишет координаты курсора относительно карточки в CSS-переменные `--mouse-x` и `--mouse-y`. В стилях самой карточки псевдоэлементы `before` и `after` позиционируются через `translate-x-[var(--mouse-x)]` и `translate-y-[var(--mouse-y)]`. В результате размазанный круглый градиент (подсветка) не просто присутствует — он реально едет за курсором внутри карточки, создавая эффект живой внутренней тени/свечения, которое всегда «под мышью». Все эти движения пружинятся через `stiffness` и `damping`: наклон и подсветка не дёргаются, а плавно догоняют руку пользователя.

```tsx
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
    <section>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pb-12 md:pb-20">
          {/* Section header */}
          <div className="mx-auto max-w-3xl pb-12 text-center md:pb-20">
            <div className="inline-flex items-center gap-3 pb-3 before:h-px before:w-8 before:bg-linear-to-r before:from-transparent before:to-indigo-200/50 after:h-px after:w-8 after:bg-linear-to-l after:from-transparent after:to-indigo-200/50">
              <Spring visibility={{ enterAt: [[0, 1]] }} {...animSubLabel}>
                <span className="inline-flex bg-linear-to-r from-indigo-500 to-indigo-200 bg-clip-text text-transparent">
                  Tailored Workflows
                </span>
              </Spring>
            </div>
            <Spring {...animText} visibility={{ enterAt: [[0, 1]] }}>
              <h2 className="animate-[gradient_6s_linear_infinite] bg-[linear-gradient(to_right,var(--color-gray-200),var(--color-indigo-200),var(--color-gray-50),var(--color-indigo-300),var(--color-gray-200))] bg-[length:200%_auto] bg-clip-text pb-4 font-nacelle text-3xl font-semibold text-transparent md:text-4xl">
                Map your product journey
              </h2>
            </Spring>
            <Spring {...animText} visibility={{ enterAt: [[0, 1]], delay: 500 }}>
              <p className="text-lg text-indigo-200/65">
                Simple and elegant interface to start collaborating with your team in minutes. It seamlessly integrates
                with your code and your favorite programming languages.
              </p>
            </Spring>
          </div>

          {/* Spotlight items */}
          <div className="group mx-auto grid max-w-sm items-start gap-6 lg:max-w-none lg:grid-cols-3">
            {cards.map((card, i) => (
              <Spring
                key={i}
                isMove
                moveShadow
                triggers={['down']}
                classInner="group mx-auto grid max-w-sm items-start gap-6 lg:max-w-none"
                spring={{
                  perspective: { values: { default: 700 } },
                  rotateX: { stiffness: 120, damping: 30 },
                  rotateY: { stiffness: 120, damping: 30 },
                }}
              >
                <a
                  key={i}
                  href="#0"
                  className="group/card relative h-full overflow-hidden rounded-2xl bg-gray-800 p-px
                before:pointer-events-none before:absolute before:-left-40 before:-top-40 before:z-10 before:h-80 before:w-80 
                before:translate-x-[var(--mouse-x)] before:translate-y-[var(--mouse-y)] before:rounded-full 
                before:bg-indigo-500/80 before:opacity-0 before:blur-3xl before:transition-opacity before:duration-500
                after:pointer-events-none after:absolute after:-left-48 after:-top-48 after:z-30 after:h-64 after:w-64 
                after:translate-x-[var(--mouse-x)] after:translate-y-[var(--mouse-y)] after:rounded-full 
                after:bg-indigo-500 after:opacity-0 after:blur-3xl after:transition-opacity after:duration-500 
                hover:after:opacity-20 group-hover:before:opacity-100"
                >
                  <div className="relative z-20 h-full overflow-hidden rounded-[inherit] bg-gray-950 after:absolute after:inset-0 after:bg-linear-to-br after:from-gray-900/50 after:via-gray-800/25 after:to-gray-900/50">
                    {/* Arrow */}
                    <div
                      className="absolute right-6 top-6 flex h-8 w-8 items-center justify-center rounded-full border border-gray-700/50 bg-gray-800/65 text-gray-200 opacity-0 transition-opacity group-hover/card:opacity-100"
                      aria-hidden="true"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width={9} height={8} fill="none">
                        <path
                          fill="#F4F4F5"
                          d="m4.92 8-.787-.763 2.733-2.68H0V3.443h6.866L4.133.767 4.92 0 9 4 4.92 8Z"
                        />
                      </svg>
                    </div>

                    {/* Image */}
                    <Image className="inline-flex" src={card.img} width={350} height={288} alt={card.alt} />

                    {/* Content */}
                    <div className="p-6">
                      <div className="mb-3">
                        <span
                          className="btn-sm relative rounded-full bg-gray-800/40 px-2.5 py-0.5 text-xs font-normal
                      before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent
                      before:[background:linear-gradient(to_bottom,--theme(--color-gray-700/.15),--theme(--color-gray-700/.5))_border-box]
                      before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)]
                      hover:bg-gray-800/60"
                        >
                          <span className="bg-linear-to-r from-indigo-500 to-indigo-200 bg-clip-text text-transparent">
                            {card.label}
                          </span>
                        </span>
                      </div>
                      <p className="text-indigo-200/65">{card.text}</p>
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


## 9. Ментальная модель Spring

Если всё упростить:

* внутри каждый `Spring` держит набор сигналов `st.*` (target-значения);
* поверх них — пружинные сигналы (через `useSpringSignal`), которые плавно догоняют цель;
* фазы (`default`, `active`, `enter`, `leave`, `down`, `up`) и внешние сигналы (`isActive`, `phase`, `visibility`) только меняют `st.*`;
* а `useWatch` переносит их в `style` (`transform`, `opacity`, `boxShadow`, `perspective` и т.д.).

Ты же снаружи работаешь простыми вещами:

* конфигом `spring` с фазами;
* `visibility` (плюс `debug`, если нужно «линейкой» померить зоны);
* `triggers` и/или `isActive`;
* обычной разметкой с классами.

В итоге `<Spring>` превращает сигналы и события в аккуратные «пружины интерфейса», не заставляя вручную писать тонну `useEffect`, подписок и анимаций.
