'use client';

import type { ReactNode } from 'react';
import { useOrderFlash } from '@/components/friday/order-event';
import { cn } from '@/lib/utils';

/**
 * Glows around the viewer's order once a dish is ordered, so on a desktop, where the order
 * rides along beside the menu, the eye goes to the dish that just arrived. The glow is a
 * layer of its own: the glass card under it must not move.
 */
export function OrderGlow({ children, className }: { children: ReactNode; className?: string }) {
  const just = useOrderFlash(1200);
  return (
    <div className={cn('relative', className)}>
      {children}
      <span
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 rounded-xl', just && 'order-glow')}
      />
    </div>
  );
}
