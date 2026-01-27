import React, {type ReactNode} from 'react';

import type {Props} from '@theme/Playground/Container';

import styles from './styles.module.css';

export default function PlaygroundContainer({children}: Props): ReactNode {
  return <div className={styles.playgroundContainer}>{children}</div>;
}
