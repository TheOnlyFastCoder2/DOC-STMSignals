import React, { type ReactNode } from 'react';
import { LiveError, LivePreview } from 'react-live';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { ErrorBoundaryErrorMessageFallback } from '@docusaurus/theme-common';
import ErrorBoundary from '@docusaurus/ErrorBoundary';
import Translate from '@docusaurus/Translate';
import PlaygroundHeader from '@theme/Playground/Header';

import $ from './styles.module.css';
import { usePlayground } from '../Provider';

function Loader() {
  return <div>Loading...</div>;
}

function PlaygroundLivePreview(): ReactNode {
  return (
    <BrowserOnly fallback={<Loader />}>
      {() => (
        <>
          <ErrorBoundary fallback={(params) => <ErrorBoundaryErrorMessageFallback {...params} />}>
            <LivePreview />
          </ErrorBoundary>
          <LiveError />
        </>
      )}
    </BrowserOnly>
  );
}

export default function PlaygroundPreview(): ReactNode {
  const { isRenderCall } = usePlayground();
  const clIsRenderCall = isRenderCall ? $.isRenderCall : '';
  return (
    <>
      <PlaygroundHeader>
        <Translate
          id="theme.Playground.result"
          description="The result label of the live codeblocks"
        >
          Result
        </Translate>
      </PlaygroundHeader>
      <div className={`${$.playgroundPreview} ${clIsRenderCall}`}>
        <PlaygroundLivePreview />
        <PlaygroundConsole />
      </div>
    </>
  );
}

function PlaygroundConsole(): ReactNode {
  const { consoleBuffer } = usePlayground();
  consoleBuffer.itemKey = (item, index) => item.v + index;
  return (
    <div className={$.console}>
      {consoleBuffer.map((line, i) => {
        return (
          <div key={i} className={$.consoleLine}>
            {i}: {line.v}
          </div>
        );
      })}
    </div>
  );
}

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

let activeConsoleTarget: null | ((type: string, args: any[]) => void) = null;

console.log = (...args) => {
  activeConsoleTarget?.('log', args);
  originalConsole.log(...args);
};

console.warn = (...args) => {
  activeConsoleTarget?.('warn', args);
  originalConsole.warn(...args);
};

console.error = (...args) => {
  activeConsoleTarget?.('error', args);
  originalConsole.error(...args);
};
