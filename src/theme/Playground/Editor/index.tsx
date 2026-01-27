import React, { type ReactNode } from 'react';
import { LiveEditor } from 'react-live';
import useIsBrowser from '@docusaurus/useIsBrowser';
import Translate from '@docusaurus/Translate';
import PlaygroundHeader from '@theme/Playground/Header';

import styles from './styles.module.css';

export default function PlaygroundEditor(): ReactNode {
  const isBrowser = useIsBrowser();

  return (
    <>
      {/*@ts-expect-error*/}
      <PlaygroundHeader isFirst>
        <Translate
          id="theme.Playground.liveEditor"
          description="The live editor label of the live codeblocks"
        >
          Live Editor
        </Translate>
      </PlaygroundHeader>
      <LiveEditor
        // We force remount the editor on hydration,
        // otherwise dark prism theme is not applied
        key={String(isBrowser)}
        className={styles.playgroundEditor}
      />
    </>
  );
}
