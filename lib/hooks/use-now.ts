import { useSyncExternalStore } from 'react';

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * The current time, ticking every second while anything reads it; one shared clock for
 * every countdown. `serverNow` is what the server rendered with, so hydration matches.
 */
export function useNow(serverNow: number): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => serverNow
  );
}
