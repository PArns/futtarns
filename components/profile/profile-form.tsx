'use client';

import { Save } from 'lucide-react';
import { useActionState } from 'react';
import { updateProfileAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Select, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import { formatPhone } from '@/lib/phone';

export function ProfileForm({
  name,
  phone,
  paypalMe,
  address,
  defaultRestaurantId,
  restaurants,
}: {
  name: string;
  phone: string | null;
  paypalMe: string | null;
  address: string | null;
  defaultRestaurantId: number | null;
  restaurants: { id: number; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateProfileAction,
    null
  );
  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Label>
        Name
        <Input name="name" defaultValue={name} required maxLength={60} />
      </Label>
      <Label>
        Handynummer
        <Input value={phone ? formatPhone(phone) : 'keine'} readOnly disabled />
        <Hint>Damit meldest du dich an. Ändern kann sie ein Admin.</Hint>
      </Label>
      <Label>
        PayPal.me-Name
        <Input name="paypalMe" defaultValue={paypalMe ?? ''} placeholder="deinname" />
        <Hint>Nur nötig, wenn du Gastgeber bist und das Geld bekommst.</Hint>
      </Label>
      <Label>
        Dein Restaurant als Gastgeber
        <Select name="defaultRestaurantId" defaultValue={defaultRestaurantId ?? ''}>
          <option value="">– keins, ich such jedes Mal aus –</option>
          {restaurants.map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </Select>
        <Hint>Hier bestellen wir an deinen Freitagen, solange keiner ein anderes aussucht.</Hint>
      </Label>
      <Label className="sm:col-span-2">
        Lieferadresse
        <Textarea
          name="address"
          defaultValue={address ?? ''}
          placeholder={'Straße 1\n12345 Stadt'}
          className="min-h-[4.5rem]"
        />
        <Hint>Wohin geliefert wird, wenn du Gastgeber bist.</Hint>
      </Label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          <Save /> Speichern
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
