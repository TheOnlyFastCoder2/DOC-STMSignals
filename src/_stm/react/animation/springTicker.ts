import { effect, signal, untracked } from '../../index';
import { flushDomCommits, hasDomCommits } from './domBatcher';

type Stepper = (dt: number) => boolean;

const jobs = new Set<Stepper>();

let isVisible = true;
let SPRING_SPEED = 1;

const FIXED_STEP = 1 / 60;
const MAX_DT = 0.053; // ✅ лучше для мобил
const MIN_STEPS = 1;
const MAX_STEPS = 6;

// ✅ стартовый лимит
let MAX_SIM_STEPS_PER_FRAME = 6;

// EMA по времени кадра
let emaCost = 0;
const EMA_A = 0.12;

// пороги (подбираются отлично)
const TOO_SLOW_MS = 12; // кадр тяжёлый
const VERY_FAST_MS = 6; // кадр лёгкий

let lastT = 0;
let acc = 0;

export const springFrame = signal(0);

export function setSpringSpeed(speed: number) {
  SPRING_SPEED = Math.max(0.1, Math.min(6, speed));
}

// ✅ хороший универсал
// setSpringSpeed(2);

// ✅ работа есть либо в springs, либо в DOM commits
function anyWork() {
  return jobs.size > 0 || hasDomCommits();
}

function runJobs(dt: number) {
  for (const step of jobs) {
    const keep = step(dt);
    if (!keep) jobs.delete(step);
  }
}

// ✅ RAF scheduler
let rafPending = false;
function scheduleNextFrame() {
  if (rafPending) return;
  rafPending = true;

  requestAnimationFrame(() => {
    rafPending = false;
    runner.markDirty();
  });
}

// ✅ адаптация лимита шагов под нагрузку
function adaptSteps(costMs: number) {
  emaCost = emaCost ? emaCost * (1 - EMA_A) + costMs * EMA_A : costMs;

  if (emaCost > TOO_SLOW_MS && MAX_SIM_STEPS_PER_FRAME > MIN_STEPS) {
    MAX_SIM_STEPS_PER_FRAME--;
  } else if (emaCost < VERY_FAST_MS && MAX_SIM_STEPS_PER_FRAME < MAX_STEPS) {
    MAX_SIM_STEPS_PER_FRAME++;
  }
}

const runner = effect(
  () => {
    const t0 = performance.now();

    if (!isVisible || !anyWork()) {
      lastT = 0;
      acc = 0;
      return;
    }

    const now = performance.now();
    const rawDt = Math.min(MAX_DT, lastT ? (now - lastT) / 1000 : FIXED_STEP);
    lastT = now;

    acc += rawDt * SPRING_SPEED;

    let steps = 0;
    let didSimulate = false;

    untracked(() => {
      while (acc >= FIXED_STEP && steps < MAX_SIM_STEPS_PER_FRAME) {
        didSimulate = true;

        if (jobs.size) runJobs(FIXED_STEP);

        acc -= FIXED_STEP;
        steps++;

        if (!jobs.size) break;
      }

      // ✅ если не успели — не копим долг бесконечно
      if (steps >= MAX_SIM_STEPS_PER_FRAME) {
        acc = 0;
      }
    });

    if (didSimulate) springFrame.v++;

    // ✅ flush DOM после симуляции
    flushDomCommits();

    // ✅ след кадр
    if (anyWork()) scheduleNextFrame();
    else {
      lastT = 0;
      acc = 0;
    }

    // ✅ подстроим лимиты по фактической стоимости кадра
    const cost = performance.now() - t0;
    adaptSteps(cost);
  },
  'high',
  { lazy: true }
);

export function startSpring(step: Stepper) {
  jobs.add(step);
  scheduleNextFrame();
  return () => jobs.delete(step);
}

export function isSpringRunning(step: Stepper) {
  return jobs.has(step);
}

// ✅ зовёшь это из domBatcher.requestDomCommit()
export function kickSpring() {
  if (anyWork()) scheduleNextFrame();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    isVisible = document.visibilityState === 'visible';
    lastT = 0;
    acc = 0;
    if (isVisible && anyWork()) scheduleNextFrame();
  });
}
