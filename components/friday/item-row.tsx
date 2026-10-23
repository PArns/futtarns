'use client';

import { Check, Minus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { setItemPriceAction, setItemQuantityAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrderItem } from '@/lib/db/schema';
import { centsToInput, formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

export function ItemRow({
  item,
  editable,
  prices = false,
}: {
  item: OrderItem;
  editable: boolean;
  /** The viewer runs the Friday and may change what this line costs. */
  prices?: boolean;
}) {
  const { pending, execute } = useAction();
  // The price of one, changed for this order only: a large pizza where the menu lists the small.
  const [price, setPrice] = useState<string | null>(null);
  const details = [
    ...(item.category ? [item.category] : []),
    ...item.options.map((option) => option.choiceName),
    ...(item.note ? [`„${item.note}“`] : []),
  ];
  const total = formatEuro(item.unitPriceCents * item.quantity);
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
      {prices && price !== null ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            execute(
              () => setItemPriceAction(item.id, price),
              () => setPrice(null)
            );
          }}
        >
          <Input
            autoFocus
            inputMode="decimal"
            aria-label={item.quantity > 1 ? 'Preis pro Stück' : 'Preis'}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className="w-20 text-right tabular-nums"
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label="Preis speichern"
            disabled={pending || !price.trim()}
          >
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Abbrechen"
            disabled={pending}
            onClick={() => setPrice(null)}
          >
            <X />
          </Button>
        </form>
      ) : (
        <>
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
          {prices ? (
            <button
              type="button"
              title="Preis für diese Bestellung ändern"
              disabled={pending}
              onClick={() => setPrice(centsToInput(item.unitPriceCents))}
              className="decoration-muted-foreground/50 hover:text-primary w-16 shrink-0 text-right text-sm font-semibold tabular-nums underline decoration-dotted underline-offset-4"
            >
              {total}
            </button>
          ) : (
            <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
              {total}
            </span>
          )}
        </>
      )}
    </li>
  );
}
