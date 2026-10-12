'use client';

import { Flame } from 'lucide-react';
import { useState } from 'react';
import { setFlatAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { centsToInput } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

const QUICK = [1000, 1500, 2000];

/** Switches a Friday to one price for everyone, e.g. a barbecue. */
export function FlatForm({
  date,
  title,
  priceCents,
  hasOrders,
  disabled,
}: {
  date: string;
  title: string | null;
  priceCents: number | null;
  hasOrders: boolean;
  disabled?: boolean;
}) {
  const [name, setName] = useState(title ?? 'Grillen');
  const [price, setPrice] = useState(centsToInput(priceCents) || '15');
  const { pending, execute } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          hasOrders &&
          !window.confirm('Die bisherigen Bestellungen werden dabei gelöscht. Weiter?')
        )
          return;
        execute(() => setFlatAction(date, name, price));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Label>
          Was gibt’s?
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            disabled={disabled}
          />
        </Label>
        <Label>
          Pro Person (€)
          <Input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            disabled={disabled}
          />
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK.map((cents) => (
          <button
            key={cents}
            type="button"
            disabled={disabled}
            onClick={() => setPrice(centsToInput(cents))}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-semibold tabular-nums max-sm:h-9',
              price === centsToInput(cents)
                ? 'border-primary/60 bg-primary/15'
                : 'border-border text-muted-foreground'
            )}
          >
            {cents / 100} €
          </button>
        ))}
        <Button type="submit" size="sm" className="ml-auto" disabled={pending || disabled}>
          <Flame /> Pauschale setzen
        </Button>
      </div>
    </form>
  );
}
