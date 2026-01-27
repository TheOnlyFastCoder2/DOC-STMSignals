import React from 'react';
import * as indexSignals from '../../_stm/index';
import * as indexSignalsMap from '../../_stm/signalMap';
import * as indexSignalsRC from '../../_stm/react/react';
import { Active } from '../../_stm/react/Active';
import { toNotify } from '../../components/Notifications';

const ReactLiveScope: unknown = {
  React,
  ...React,
  ...indexSignals,
  ...indexSignalsRC,
  ...indexSignalsMap,
  Active,
  toNotify,
};

export default ReactLiveScope;
