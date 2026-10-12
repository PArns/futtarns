'use client';

import { Archive, ArchiveRestore, Plus, Save } from 'lucide-react';
import { useActionState, useState } from 'react';
import { archiveDishAction, saveDishAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import type { Dish } from '@/lib/db/schema';
import { centsToInput, formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { formatOptionGroups, parseOptionGroups } from '@/lib/menu/options';

const OPTIONS_HELP =
  'Eine Zeile pro Gruppe: „Größe (1): Normal | Groß +2,50“ oder „Extras (0-3): Käse +1 | Salami +1,50“.';

/** Adds a dish or edits one, including its option groups in the one-line-per-group format. */
export function DishForm({
  restaurantId,
  dish,
  onDone,
}: {
  restaurantId: number;
  dish?: Dish;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (previous, form) => {
      const result = await saveDishAction(previous, form);
      if (result.ok) onDone?.();
      return result;
    },
    null
  );
  const [options, setOptions] = useState(dish ? formatOptionGroups(dish.optionGroups) : '');
  const preview = parseOptionGroups(options);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.6fr_0.8fr]">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      {dish && <input type="hidden" name="dishId" value={dish.id} />}
      <Label>
        Kategorie
        <Input name="category" defaultValue={dish?.category ?? ''} placeholder="Pizza" />
      </Label>
      <Label>
        Name
        <Input name="name" required defaultValue={dish?.name} placeholder="Margherita" />
      </Label>
      <Label>
        Preis (€)
        <Input
          name="price"
          required
          inputMode="decimal"
          defaultValue={centsToInput(dish?.priceCents ?? null)}
          placeholder="8,50"
        />
      </Label>
      <Label className="sm:col-span-3">
        Beschreibung
        <Input
          name="description"
          defaultValue={dish?.description ?? ''}
          placeholder="Tomatensauce, Mozzarella"
        />
      </Label>
      <Label className="sm:col-span-3">
        Auswahl und Extras
        <Textarea
          name="options"
          value={options}
          onChange={(event) => setOptions(event.target.value)}
          className="min-h-20 font-mono text-xs"
          placeholder={'Größe (1): Normal | Groß +2,50\nExtras (0-3): Käse +1 | Salami +1,50'}
        />
        <Hint>{OPTIONS_HELP}</Hint>
        {options.trim() && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {preview.groups.map((group) => (
              <span
                key={group.id}
                className="border-primary/30 bg-primary/10 rounded-full border px-2 py-0.5 text-xs"
              >
                {group.name}:{' '}
                {group.choices
                  .map(
                    (choice) =>
                      `${choice.name}${choice.priceCents ? ` +${formatEuro(choice.priceCents)}` : ''}`
                  )
                  .join(', ')}
              </span>
            ))}
            {preview.errors.map((error) => (
              <span key={error} className="text-error text-xs">
                {error}
              </span>
            ))}
          </div>
        )}
      </Label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {dish ? <Save /> : <Plus />} {dish ? 'Speichern' : 'Gericht hinzufügen'}
        </Button>
        {state && (
          <span className={state.ok ? 'text-success text-sm' : 'text-error text-sm'}>
            {state.ok ? state.message : state.error}
          </span>
        )}
      </div>
    </form>
  );
}

export function ArchiveDishButton({
  restaurantId,
  dishId,
  archived,
}: {
  restaurantId: number;
  dishId: number;
  archived: boolean;
}) {
  const { pending, execute } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={archived ? 'Wieder auf die Karte' : 'Von der Karte nehmen'}
      title={archived ? 'Wieder auf die Karte' : 'Von der Karte nehmen'}
      disabled={pending}
      onClick={() => execute(() => archiveDishAction(restaurantId, dishId, !archived))}
    >
      {archived ? <ArchiveRestore /> : <Archive />}
    </Button>
  );
}
