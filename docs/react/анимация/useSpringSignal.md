# useSpringSignal — сигнал, который “догоняет” другой сигнал пружиной

`useSpringSignal(source, opts)` нужен, когда у тебя есть **сигнал-цель** (target): он может меняться резко — от драга, скролла, кликов, переключений сцен. А в UI ты хочешь видеть не “скачок”, а **мягкое догоняющее движение**. Хук возвращает второй сигнал — **spring-сигнал**: он читает `source.v` как цель, но обновляет своё значение постепенно, как пружина — догоняет, может чуть перелететь, и потом спокойно “усаживается” в точку.

Важно, что результат остаётся **обычным сигналом**: его можно читать через `.v`, рендерить через `.c`, использовать в `computed/effect` — и при этом React-компонент не превращается в анимационный движок.


---

## Что именно анимируется

`useSpringSignal` умеет анимировать три типа значений:

* **number** — классический случай (opacity, scale, x/y, прогресс и т.п.)
* **number[]** — когда удобно двигать сразу пачку чисел (например `[x, y]`)
* **строки с единицами**: `"12px"`, `"50%"`, `"10vw"`, `"3rem"` и т.д. (поддерживаются `px | % | vw | vh | em | rem`)

Если в `source.v` прилетает что-то “неанимируемое” (объект, boolean, JSX и т.п.) — хук просто **синхронизирует значение мгновенно** (без тиков), вызывает `onSettled` и считает это “приехали”.

---

## Базовое использование: плавно догоняем число

```tsx live noInline render(<Demo />)
function Demo() {
  const raw = useSignal(0);
  const smooth = useSpringSignal(raw, { stiffness: 140, damping: 20 });

  return (
    <div>
      <button onClick={() => (raw.v += 50)}>+50</button>
      <div>raw: {raw.c}</div>
      <div>smooth: {smooth.c}</div>
    </div>
  );
}
```

`raw` прыгает сразу, а `smooth` догоняет пружиной и обновляется сам по тикам.

---

## Пример с единицами: translateY без ручного форматирования

Если тебе удобнее хранить позицию как строку с единицами:

```tsx live noInline render(<MovePx />)
function MovePx() {
  const x = useSignal('0px');
  const refDiv = useRef<HTMLDivElement>(null);
  const xSpring = useSpringSignal(x, { stiffness: 70, damping: 10});
  useWatch(() => {
    const div = refDiv.current;
    div.style.transform = `translateY(${xSpring.v})`;
    console.clear()
    console.log(xSpring.v)
  })
  return (
    <div style={{height: '340px'}}>
      <button onClick={() => (x.v = '240px')}>to 240px</button>
      <button onClick={() => (x.v = '0px')}>back</button>
      <div ref={refDiv} >
        I’m smooth
      </div>
    </div>
  );
}
```
---

## Пример с массивом: двигаем [x, y] одним сигналом

```tsx live noInline render(<DragLike />)
function DragLike() {
  const pos = useSignal<[number, number]>([0, 0]);
  const posSpring = useSpringSignal(pos, { stiffness: 160, damping: 22 });
  const refDiv = useRef<HTMLDivElement>(null);
  const refContainer = useRef<HTMLDivElement>(null);
  useSpringMouse({
    ref: refContainer,
    onMouse: (x, y) => {
      pos.v = [x, y]
    }
  })
  useWatch(() => {
    console.clear()
    console.log(posSpring.v)
    const div = refDiv.current;
    div.style.transform = `
      translate(${posSpring.v[0]}px, 
      ${posSpring.v[1]}px)
    `;
  })
  return (
    <div className={$.DragLike} ref={refContainer} >
      <div ref={refDiv} >
        Smooth box
      </div>
    </div>
  );
}
```

Тут кайф в том, что ты меняешь **один** источник (`pos`), а UI получает гладкую траекторию.

---

## Что делают опции (по-человечески)

`stiffness` и `damping` — характер пружины: жёсткость и “тормоза”. `precision` — насколько близко нужно подойти к цели, чтобы считать движение законченным. `speed` — просто ускоритель времени: больше — быстрее догоняет (внутри он масштабирует `dt`). `enabled` — переключатель анимации: когда он `false`, значение **сразу** становится равным `source.v`, пружина останавливается, и вызывается `onSettled`.

`skipFirst` — очень практичная штука: при первом запуске хук может просто синхронизировать значение без анимации. Это удобно на маунте/гидрации, чтобы не ловить “стартовый пролёт”.

`onTick` вызывается на каждом тике обновления. `onSettled` вызывается когда пружина “уселась” в цель (или когда анимация отключена/значение неанимируемое и произошёл мгновенный sync).

---

## Прогресс: когда хочется знать “насколько доехали”

`onProgress(value, percent)` даёт текущий value и процент 0..1. Пружина может колебаться, и чтобы прогресс не “прыгал назад”, есть `monotonicProgress`: когда он `true`, процент не убывает даже если значение перелетело цель и вернулось.

```tsx live noInline render(<WithProgress />)
function WithProgress() {
  const x = useSignal(0);
  const p = useSignal(0);
  const refDiv = useRef<HTMLDivElement>(null);
  const smooth = useSpringSignal(x, {
    monotonicProgress: true,
    onSettled: () =>  x.v = 0,
    onProgress: (value, percent) => {
      p.v = percent * 100;
      refDiv.current.style.transform = `translateX(${value}px)`;
    }
  });

  return (
    <div>
      <button onClick={() => (x.v = x.v + 300)}>go</button>
      <div>progress:{p.c}%</div>
      <div ref={refDiv}>→</div>
    </div>
  );
}
```

---

## “Отключи анимацию” по сигналу

`enabled` принимает не только boolean, но и “сигналоподобное” `{ get v(): boolean }`, так что его удобно связывать с настройками “reduce motion”.

```tsx live noInline render(<MagneticCard />)
function MagneticCard() {
  const enabled = useSignal<boolean>(true);
  const target = useSignal<number[]>([0, 0, 0, 0, 0, 0]);
  const smooth = useSpringSignal(target, {
     enabled, stiffness: 10, damping: 2
  });

  const ref = useRef<HTMLDivElement>(null);
  const refContainer = useRef<HTMLDivElement>(null);
  useSpringMouse({
    mouseStrength:  2,
    onMouse: (...args) => {
      target.v = args
    }
  })
  useWatch(() => {
    const el = ref.current;
    if (!el) return;
    const [x, y, nx, ny, ry, rx] = smooth.v;

    el.style.perspective = "400px";
    el.style.transform = `
      translate3d(${nx * 1.2}px, ${ny * 1.2}px, 0)
      rotateY(${ry * 2}deg)
      rotateX(${rx * 2}deg)
    `;

     // 1) угол градиента от наклона
     const angle = 120 + ry * 35 + rx * 35;
   
     // 2) сдвиг градиента от направления (nx/ny обычно -1..1)
     const posX = 50 + nx * 35;
     const posY = 50 + ny * 35;
   
     // 3) оттенки (hue) тоже завяжем на движение/наклон
     const baseHue = 220 + nx * 60 + ny * 40 + ry * 10;
   
     const h1 = ((baseHue + 0) % 360 + 360) % 360;
     const h2 = ((baseHue + 70) % 360 + 360) % 360;
     const h3 = ((baseHue + 140) % 360 + 360) % 360;
     
     el.style.backgroundImage = `linear-gradient(${angle}deg,
       hsl(${h1} 90% 60%),
       hsl(${h2} 90% 60%),
       hsl(${h3} 90% 60%)
     )`;
   
     el.style.backgroundSize = "220% 220%";
     el.style.backgroundPosition = `${posX}% ${posY}%`;
     el.style.willChange = "transform, background-position, background-image";
  })
  return (
   <>
     <button 
      children={<>анимация выключена {enabled.c}</>}
      onClick={() => enabled.v = !enabled.v}
     />
     <div ref={refContainer} >
       <div
         ref={ref}
         style={{
           width: 220,
           height: 140,
           borderRadius: 16,
           background: "#111",
         }}
       />
     </div>
   </>
  );
}
```

Когда `reduce motion` включён — значение просто синхронизируется без тиков, но твой код и разметка не меняются.

---

## Мини-итог

`useSpringSignal` — это “мягкий двойник” твоего сигнала: источник может быть резким и техническим, а UI получает плавный результат, оставаясь при этом в мире сигналов. Это особенно хорошо там, где React-рендер не должен становиться частью анимационной логики: модалки, draggable, viewport-события, любые “прыгающие” значения, которые хочется превратить в спокойное движение.

Если хочешь — я могу прямо в эту доку добавить один короткий практический кейс “draggable → spring → style” под твой `viewport-move` / `Draggable`, чтобы было совсем один-в-один как в проекте.
