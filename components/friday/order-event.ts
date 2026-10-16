'use client';

import { useEffect, useRef, useState } from 'react';

/** A dish the viewer just ordered, for the parts of the page that show it to react. */
export type OrderedDish = { dishId: number; name: string };

const ORDERED = 'freitach:ordered';

export function announceOrder(dish: OrderedDish) {
  window.dispatchEvent(new CustomEvent<OrderedDish>(ORDERED, { detail: dish }));
}

/**
 * The dish ordered last on this page, for `ms` after each order and null otherwise, so an
 * animation plays once per order. `match` picks the orders that concern the caller.
 */
export function useOrderFlash(ms: number, match?: (dish: OrderedDish) => boolean) {
  const [flash, setFlash] = useState<OrderedDish | null>(null);
  const matchRef = useRef(match);
  useEffect(() => {
    matchRef.current = match;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const listener = (event: Event) => {
      const dish = (event as CustomEvent<OrderedDish>).detail;
      if (matchRef.current && !matchRef.current(dish)) return;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      // Off for a frame first, so an order right after the last one plays it again.
      setFlash(null);
      frame = requestAnimationFrame(() => setFlash(dish));
      timer = setTimeout(() => setFlash(null), ms);
    };
    window.addEventListener(ORDERED, listener);
    return () => {
      window.removeEventListener(ORDERED, listener);
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [ms]);
  return flash;
}
