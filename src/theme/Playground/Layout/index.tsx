import React, { PropsWithChildren, useId, type ReactNode } from 'react';
import { useThemeConfig } from '@docusaurus/theme-common';
import PlaygroundPreview from '@theme/Playground/Preview';
import PlaygroundEditor from '@theme/Playground/Editor';

import type { ThemeConfig } from '@docusaurus/theme-live-codeblock';
import { signal } from '@site/src/_stm';

function useLiveCodeBlockThemeConfig() {
  const themeConfig = useThemeConfig() as unknown as ThemeConfig;
  return themeConfig.liveCodeBlock;
}

export const qtyChange = signal<number>(0);
export default function PlaygroundLayout(): ReactNode {
  const { playgroundPosition } = useLiveCodeBlockThemeConfig();

  return (
    <>
      {playgroundPosition === 'top' ? (
        <>
          <PlaygroundPreview />
          <PlaygroundEditor />
        </>
      ) : (
        <>
          <PlaygroundEditor />
          <PlaygroundPreview />
        </>
      )}
    </>
  );
}
