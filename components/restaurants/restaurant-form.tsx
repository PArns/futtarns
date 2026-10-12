'use client';

import { Save } from 'lucide-react';
import { useActionState } from 'react';
import { createRestaurantAction, updateRestaurantAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import type { Restaurant } from '@/lib/db/schema';
import { centsToInput } from '@/lib/format';

export function RestaurantForm({ restaurant }: { restaurant?: Restaurant }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    restaurant ? updateRestaurantAction : createRestaurantAction,
    null
  );
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
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
