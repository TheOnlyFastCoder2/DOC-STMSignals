import React from 'react';
import * as indexSignals from '../../_stm/index';
import * as indexSignalsMap from '../../_stm/signalMap';
import * as indexSignalsRC from '../../_stm/react/react';

// import Draggable from '../../_stm/react/Draggable';

import $ from './styles.modules.css';
import { toNotify } from '../../components/Notifications';
import DraggableHeader from '@site/src/components/Draggable';

import Popup from '../../_stm/react/Popup';
import { Active } from '../../_stm/react/Active';

import { Spring } from '../../_stm/react/animation/Spring';
import useSpringSignal from '../../_stm/react/animation/useSpringSignal';
import { useSpringMouse } from '../../_stm/react/animation/useSpringMouse';

import SVGSun from './assets/icons/sun.svg';
import SVGMoon from './assets/icons/moon.svg';

const ReactLiveScope: unknown = {
  React,
  ...React,
  ...indexSignals,
  ...indexSignalsRC,
  ...indexSignalsMap,
  Active,
  toNotify,
  SVGSun,
  SVGMoon,
  useSpringMouse,
  useSpringSignal,
  Popup,
  $,
  Spring,
  DraggableHeader,
};

export default ReactLiveScope;
