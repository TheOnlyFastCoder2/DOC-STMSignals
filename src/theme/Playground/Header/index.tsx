import React, { Activity, PropsWithChildren } from 'react';
import clsx from 'clsx';

import $ from './styles.module.css';
import { Play, Trash, RotateCcw } from 'lucide-react';
import { usePlayground } from '../Provider';

interface Props extends PropsWithChildren {
  isFirst: boolean;
}

export default function PlaygroundHeader({ isFirst, children }: Props) {
  const { clear, toPlayNext, toResetNext } = usePlayground();
  return (
    <div className={clsx($.playgroundHeader)}>
      {children}
      <Activity mode={isFirst ? 'visible' : 'hidden'}>
        <div className={$.iconsContainer}>
          <Trash className={`${$.trashIcon} ${$.icon}`} onClick={clear} />
          <Play className={`${$.playIcon} ${$.icon}`} onClick={toPlayNext} />
          <RotateCcw className={`${$.resetIcon} ${$.icon}`} onClick={toResetNext} />
        </div>
      </Activity>
    </div>
  );
}
