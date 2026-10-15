'use client';

import { Save } from 'lucide-react';
import { useActionState } from 'react';
import { createRestaurantAction, updateRestaurantAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import type { Restaurant } from '@/lib/db/schema';
import { centsToInput } from '@/lib/format';
import { DEFAULT_TIP_CENTS } from '@/lib/pricing';

/**
 * A restaurant's details and fees, and which hosts it delivers to: not every restaurant
 * reaches every host's address. None ticked means it delivers to everyone.
 */
export function RestaurantForm({
  restaurant,
  members,
  deliversTo = [],
}: {
  restaurant?: Restaurant;
  /** Everyone who could host a Friday. */
  members: { id: number; name: string }[];
  deliversTo?: number[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    restaurant ? updateRestaurantAction : createRestaurantAction,
    null
  );
  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {restaurant && <input type="hidden" name="id" value={restaurant.id} />}
      <Label>
        Name
        <Input
          name="name"
          required
          defaultValue={restaurant?.name}
          placeholder="Pizzeria Da Mario"
        />
      </Label>
      <Label>
        Küche
        <Input name="cuisine" defaultValue={restaurant?.cuisine ?? ''} placeholder="Pizza, Pasta" />
      </Label>
      <Label className="sm:col-span-2">
        Lieferando-Link
        <Input
          name="lieferandoUrl"
          type="url"
          defaultValue={restaurant?.lieferandoUrl ?? ''}
          placeholder="https://www.lieferando.de/speisekarte/…"
        />
      </Label>
      <Label>
        Mindestbestellwert (€)
        <Input
          name="minOrder"
          inputMode="decimal"
          defaultValue={centsToInput(restaurant?.minOrderCents ?? null)}
          placeholder="15,00"
        />
      </Label>
      <Label>
        Liefergebühr (€)
        <Input
          name="deliveryFee"
          inputMode="decimal"
          defaultValue={centsToInput(restaurant?.deliveryFeeCents ?? null)}
          placeholder="2,99"
        />
      </Label>
      <Label>
        Kostenlose Lieferung ab (€)
        <Input
          name="freeDeliveryFrom"
          inputMode="decimal"
          defaultValue={centsToInput(restaurant?.freeDeliveryFromCents ?? null)}
          placeholder="leer = nie"
        />
      </Label>
      <Label>
        Servicegebühr (€)
        <Input
          name="serviceFee"
          inputMode="decimal"
          defaultValue={centsToInput(restaurant?.serviceFeeCents ?? null)}
          placeholder="0,99"
        />
        <Hint>Was Lieferando pro Bestellung extra nimmt.</Hint>
      </Label>
      <Label>
        Trinkgeld (€)
        <Input
          name="tip"
          inputMode="decimal"
          defaultValue={centsToInput(restaurant?.tipCents ?? DEFAULT_TIP_CENTS)}
          placeholder={centsToInput(DEFAULT_TIP_CENTS)}
        />
        <Hint>
          Für den Fahrer, geteilt durch alle, die essen. Der Gastgeber kann es pro Freitag ändern;
          beim Abholen gibt es keins.
        </Hint>
      </Label>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-semibold">Liefert zu</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {members.map((member) => (
            <label key={member.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="deliversTo"
                value={member.id}
                defaultChecked={deliversTo.includes(member.id)}
                className="accent-primary size-4"
              />
              {member.name}
            </label>
          ))}
        </div>
        <Hint>
          Wessen Adresse im Liefergebiet liegt. Keiner angehakt heißt: liefert zu allen. Bei wem es
          nicht liefert, steht es nur zur Wahl, wenn Abholen geht.
        </Hint>
      </fieldset>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="pickup"
          defaultChecked={restaurant?.pickup ?? false}
          className="accent-primary mt-0.5 size-4"
        />
        <span>
          <span className="font-semibold">Abholen geht auch</span>
          <span className="text-muted-foreground block text-xs">
            Dann kann der Gastgeber pro Freitag wählen, dass jemand das Essen holt: gleiche Preise,
            ohne Liefer- und Servicegebühr und ohne Trinkgeld.
          </span>
        </span>
      </label>
      <Label className="sm:col-span-2">
        Notizen
        <Textarea
          name="notes"
          defaultValue={restaurant?.notes ?? ''}
          className="min-h-16"
          placeholder="z. B. Pizza immer gut durch bestellen"
        />
      </Label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          <Save /> {restaurant ? 'Speichern' : 'Restaurant anlegen'}
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
