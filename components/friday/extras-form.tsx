'use client';

import { Save } from 'lucide-react';
import { useState } from 'react';
import { setExtrasAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Hint, Input, Label } from '@/components/ui/input';
import { centsToInput } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { DEFAULT_TIP_CENTS } from '@/lib/pricing';

const TIP_CHOICES = [150, 250, 350, 500];

/** Tip and drinks fee for one Friday; empty fields mean the usual amounts. */
export function ExtrasForm({
  date,
  tipCents,
  drinksFeeCents,
  defaultDrinksFeeCents,
}: {
  date: string;
  tipCents: number | null;
  drinksFeeCents: number | null;
  defaultDrinksFeeCents: number;
}) {
  const [tip, setTip] = useState(centsToInput(tipCents));
  const [drinks, setDrinks] = useState(centsToInput(drinksFeeCents));
  const { pending, execute } = useAction();
  const shownTip = tip || centsToInput(DEFAULT_TIP_CENTS);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        execute(() => setExtrasAction(date, tip, drinks));
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Label>
          Trinkgeld (€)
          <Input
            value={tip}
            onChange={(event) => setTip(event.target.value)}
            inputMode="decimal"
            placeholder={centsToInput(DEFAULT_TIP_CENTS)}
          />
          <span className="flex flex-wrap gap-1.5">
            {TIP_CHOICES.map((cents) => (
              <Chip
                key={cents}
                selected={shownTip === centsToInput(cents)}
                onClick={() => setTip(centsToInput(cents))}
              >
                {centsToInput(cents)} €
              </Chip>
            ))}
          </span>
        </Label>
        <Label>
          Getränkepauschale (€)
          <Input
            value={drinks}
            onChange={(event) => setDrinks(event.target.value)}
            inputMode="decimal"
            placeholder={centsToInput(defaultDrinksFeeCents)}
          />
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          <Save /> Speichern
        </Button>
        <Hint>Leer heißt: wie immer. 0 schaltet Trinkgeld oder Getränkepauschale ab.</Hint>
      </div>
    </form>
  );
}
