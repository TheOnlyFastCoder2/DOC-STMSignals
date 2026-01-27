import React from 'react';
import Notifications from '../components/Notifications';
import { onError } from '../_stm';
onError(() => {});
export default function Root({ children }) {
  return (
    <>
      <Notifications />
      {children}
    </>
  );
}
