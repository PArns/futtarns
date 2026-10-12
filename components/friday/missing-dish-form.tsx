'use client';

import { PlusCircle } from 'lucide-react';
import { useState } from 'react';
import { addMissingDishAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/** For a dish the menu is missing: name and price, saved for everyone and ordered at once. */
export function MissingDishForm({ restaurantId, date }: { restaurantId: number; date?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const { pending, execute } = useAction();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border text-muted-foreground hover:border-primary/50 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm font-semibold transition-colors"
      >
        <PlusCircle className="size-4" /> Gericht fehlt? Selbst eintragen
      </button>
    );
  }

  return (
    <form
      className="border-primary/40 bg-primary/5 space-y-3 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        execute(
          () => addMissingDishAction({ restaurantId, name, price, description, date }),
          () => {
            setName('');
            setPrice('');
            setDescription('');
            setOpen(false);
          }
        );
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
        <Label>
          Gericht
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            autoFocus
          />
        </Label>
        <Label>
          Preis (€)
          <Input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            required
            inputMode="decimal"
            placeholder="8,50"
          />
        </Label>
      </div>
      <Label>
        Beschreibung (optional)
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
        />
      </Label>
      <p className="text-muted-foreground text-xs">
        Wird für alle auf die Karte gesetzt{date ? ' und gleich für dich bestellt' : ''}.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {date ? 'Eintragen und bestellen' : 'Eintragen'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
