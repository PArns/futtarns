'use client';

import { Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { setItemQuantityAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import type { OrderItem } from '@/lib/db/schema';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

export function ItemRow({ item, editable }: { item: OrderItem; editable: boolean }) {
  const { pending, execute } = useAction();
  const details = [
    ...(item.category ? [item.category] : []),
    ...item.options.map((option) => option.choiceName),
    ...(item.note ? [`„${item.note}“`] : []),
  ];
  return (
    <li
      className={cn(
        // As tall with or without the +/- buttons, so the rows of neighbouring cards line up.
        'flex min-h-12 items-center gap-2 py-2 max-sm:min-h-15',
        pending && 'opacity-60'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {item.quantity > 1 && <span className="text-primary tabular-nums">{item.quantity}×</span>}
          <span className="truncate">{item.name}</span>
          {item.isDefault && (
            <span title="Standardgericht, weil bis zum Bestellschluss nichts gewählt war">
              <Sparkles className="text-warning size-3.5" />
            </span>
          )}
        </div>
        {details.length > 0 && (
          <p className="text-muted-foreground truncate text-xs">{details.join(' · ')}</p>
        )}
      </div>
      {editable && (
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Eins weniger"
            disabled={pending}
            onClick={() => execute(() => setItemQuantityAction(item.id, item.quantity - 1))}
          >
            {item.quantity > 1 ? <Minus /> : <Trash2 />}
          </Button>
          {item.quantity < 20 && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Eins mehr"
              disabled={pending}
              onClick={() => execute(() => setItemQuantityAction(item.id, item.quantity + 1))}
            >
              <Plus />
            </Button>
          )}
        </div>
      )}
      <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
        {formatEuro(item.unitPriceCents * item.quantity)}
      </span>
    </li>
  );
}
