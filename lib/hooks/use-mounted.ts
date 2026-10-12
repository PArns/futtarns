import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False during server render and hydration, true afterwards, without an extra paint. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
