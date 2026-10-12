'use client';

import { Save } from 'lucide-react';
import { useState } from 'react';
import { setExtrasAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { centsToInput } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';

/** Tip and drinks fee for one Friday; empty fields mean the usual rule. */
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
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        execute(() => setExtrasAction(date, tip, drinks));
      }}
    >
      <Label>
        Trinkgeld (€)
        <Input
          value={tip}
          onChange={(event) => setTip(event.target.value)}
          inputMode="decimal"
          placeholder="10 % automatisch"
        />
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
      <Button type="submit" variant="outline" disabled={pending}>
        <Save /> Speichern
      </Button>
      <Hint className="sm:col-span-3">
        Leer heißt: wie immer. 0 bei der Getränkepauschale schaltet sie für diesen Freitag ab.
      </Hint>
    </form>
  );
}
