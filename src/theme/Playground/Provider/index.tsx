import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LiveProvider } from 'react-live';
import { usePrismTheme } from '@docusaurus/theme-common';

import type { Props } from '@theme/Playground/Provider';
import { TRMapSignal, useSignalMap } from '@site/src/_stm/react/react';

export interface PlaygroundCtx {
  consoleBuffer: TRMapSignal<string, 'deep'>;
  isRenderCall: boolean;
  clear: () => void;
  toPlayNext: () => void;
  toResetNext: () => void;
}

export const PlaygroundContext = createContext<PlaygroundCtx | null>(null);

export const usePlayground = () => {
  const ctx = useContext(PlaygroundContext);
  if (!ctx) throw new Error('usePlayground must be used inside PlaygroundProvider');
  return ctx;
};

/* ----------------- helpers ----------------- */

const formatArg = (a: any) => {
  if (typeof a === 'string') return a;
  if (typeof a === 'number' || typeof a === 'boolean' || a == null) return String(a);
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a, null, 2);
  } catch {
    return String(a);
  }
};
const formatArgs = (args: any[]) => args.map(formatArg).join(' ');

/** extracts `render(...)` from metastring like: ```tsx live noInline render(<Counter />) */
const extractRenderCall = (meta?: string): string | null => {
  if (!meta) return null;

  const start = meta.indexOf('render(');
  if (start === -1) return null;

  let i = start + 'render('.length;
  let depth = 1;

  for (; i < meta.length; i++) {
    const ch = meta[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return meta.slice(start, i + 1); // "render(<Counter />)"
    }
  }
  return null;
};

export default function PlaygroundProvider({ code, children, ...props }: Props) {
  const prismTheme = usePrismTheme();
  const noInline = props.metastring?.includes('noInline') ?? false;

  const renderCall = extractRenderCall(props.metastring);
  const tail = renderCall ? `${renderCall};` : `render(null);`;

  const consoleBuffer = useSignalMap<string>([]);
  const id = useId();

  const lastSrcRef = useRef<string>(code?.replace(/\n$/, '') ?? '');
  const [codeOverride, setCodeOverride] = useState<string>(() => code?.replace(/\n$/, '') ?? '');
  const [runKey, setRunKey] = useState(0);

  const prevPropCodeRef = useRef<string>(codeOverride);
  const nextPropCode = code?.replace(/\n$/, '') ?? '';
  if (prevPropCodeRef.current !== nextPropCode) {
    prevPropCodeRef.current = nextPropCode;
    setCodeOverride(nextPropCode);
    lastSrcRef.current = nextPropCode;
  }

  const localConsole = useMemo(() => {
    const raw = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      clear: console.clear?.bind(console),
    };

    return {
      log: (...args: any[]) => {
        consoleBuffer.push(formatArgs(args));
        raw.log(...args);
      },
      warn: (...args: any[]) => {
        consoleBuffer.push('⚠️ ' + formatArgs(args));
        raw.warn(...args);
      },
      error: (...args: any[]) => {
        consoleBuffer.push('❌ ' + formatArgs(args));
        raw.error(...args);
      },
      clear: () => {
        consoleBuffer.clear();
        raw.clear?.();
      },
    };
  }, [consoleBuffer]);

  const scope = useMemo(() => {
    return { ...(props as any).scope, console: localConsole };
  }, [props, localConsole]);

  const clear = () => localConsole.clear();

  const toPlayNext = () => {
    consoleBuffer.clear();
    setCodeOverride(lastSrcRef.current);
    setRunKey((k) => k + 1);
  };

  const toResetNext = () => {
    consoleBuffer.clear();
    const base = code?.replace(/\n$/, '') ?? '';
    lastSrcRef.current = base;
    setCodeOverride(base);
    setRunKey((k) => k + 1);
  };

  useEffect(() => {
    return () => {
      toResetNext();
      consoleBuffer.clear();
    };
  }, []);

  return (
    <PlaygroundContext.Provider
      value={{
        consoleBuffer,
        isRenderCall: !!renderCall,
        clear,
        toPlayNext,
        toResetNext,
      }}
    >
      <LiveProvider
        key={`${id}:${runKey}`}
        theme={prismTheme}
        noInline={noInline}
        {...props}
        scope={scope}
        code={codeOverride}
        transformCode={(src) => {
          consoleBuffer.clear();
          lastSrcRef.current = src;

          return `${src}\n${tail}`;
        }}
      >
        {children}
      </LiveProvider>
    </PlaygroundContext.Provider>
  );
}
