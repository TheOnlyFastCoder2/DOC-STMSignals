export function subscribeMediaQuery(
  mq: MediaQueryList,
  onChange: (mq: MediaQueryList) => void
): () => void {
  const handler = () => onChange(mq);

  if ('addEventListener' in mq) {
    mq.addEventListener('change', handler as EventListener);
    return () => mq.removeEventListener('change', handler as EventListener);
  } else {
    // старые браузеры
    // @ts-ignore
    mq.addListener(handler);
    // @ts-ignore
    return () => mq.removeListener(handler);
  }
}
