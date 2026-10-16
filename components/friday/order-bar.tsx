'use client';

import { Check, ChevronUp } from 'lucide-react';
import { useOrderFlash } from '@/components/friday/order-event';
import { formatEuro } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * On phones the viewer's order and amount stay in view at the bottom while they scroll
 * the menu; a tap jumps to „Deine Bestellung“. Right after an order it bounces and names
 * the dish, so a tap that worked is seen as one.
 */
export function OrderBar({
  summary,
  amountCents,
  amountLabel,
}: {
  /** What they get, e.g. `Margherita, Tiramisu` or `Noch nichts ausgesucht`. */
  summary: string;
  amountCents: number;
  /** `bis jetzt`, `offen` or `bezahlt`. */
  amountLabel: string;
}) {
  const just = useOrderFlash(2600);
  return (
    <a
      href="#bestellung"
      className={cn(
        'bg-background/90 border-border fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-md transition-colors sm:hidden',
        just && 'border-success/60'
      )}
    >
      <span className={cn('min-w-0 flex-1', just && 'order-bump')}>
        {just ? (
          <span className="text-success flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase">
            <Check className="size-3.5 shrink-0" /> Bestellt
          </span>
        ) : (
          <span className="text-muted-foreground block text-[11px] font-semibold tracking-wider uppercase">
            Deine Bestellung
          </span>
        )}
        <span className="block truncate text-sm font-semibold">{just ? just.name : summary}</span>
      </span>
      <span className={cn('shrink-0 text-right', just && 'order-bump')}>
        <span className="block text-base font-extrabold tabular-nums">
          {formatEuro(amountCents)}
        </span>
        <span className="text-muted-foreground block text-[11px]">{amountLabel}</span>
      </span>
      <ChevronUp className="text-primary size-5 shrink-0" />
    </a>
  );
}
