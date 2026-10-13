'use client';

import { Ban, CalendarCheck, Save, ShoppingBag, Truck } from 'lucide-react';
import { useState } from 'react';
import {
  chooseRestaurantAction,
  setCancelledAction,
  setHostAction,
  setNoteAction,
  setPickupAction,
} from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Hint, Input, Label, Select } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

type Option = { id: number; name: string };

export function RestaurantPicker({
  date,
  restaurantId,
  restaurants,
  hasOrders,
  disabled,
}: {
  date: string;
  restaurantId: number | null;
  restaurants: (Option & { isDefault?: boolean })[];
  hasOrders: boolean;
  disabled?: boolean;
}) {
  const { pending, execute } = useAction();
  return (
    <Label>
      Restaurant
      <Select
        value={restaurantId ?? ''}
        disabled={pending || disabled}
        onChange={(event) => {
          const next = event.target.value ? Number(event.target.value) : null;
          if (
            hasOrders &&
            !window.confirm('Beim Wechsel werden alle bisherigen Bestellungen gelöscht. Weiter?')
          ) {
            event.target.value = String(restaurantId ?? '');
            return;
          }
          execute(() => chooseRestaurantAction(date, next));
        }}
      >
        {!restaurants.some((restaurant) => restaurant.isDefault) && (
          <option value="">– noch offen –</option>
        )}
        {restaurants.map((restaurant) => (
          <option key={restaurant.id} value={restaurant.id}>
            {restaurant.name}
            {restaurant.isDefault ? ' (Standard)' : ''}
          </option>
        ))}
      </Select>
      {disabled && <Hint>Schon abgerechnet. Zum Wechseln erst die Abrechnung öffnen.</Hint>}
    </Label>
  );
}

/**
 * Delivered or fetched, for a restaurant that offers both, and who fetches it: they pay
 * the restaurant and get the food money, the drinks money still goes to the host.
 */
export function PickupPicker({
  date,
  pickup,
  pickerId,
  hostId,
  hostName,
  members,
  disabled,
}: {
  date: string;
  pickup: boolean;
  /** Who fetches it when not the host. */
  pickerId: number | null;
  hostId: number | null;
  hostName: string;
  members: Option[];
  disabled?: boolean;
}) {
  const { pending, execute } = useAction();
  const off = pending || disabled;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip
          selected={!pickup}
          disabled={off}
          onClick={() => !pickup || execute(() => setPickupAction(date, false, null))}
        >
          <Truck className="size-3.5" /> Liefern lassen
        </Chip>
        <Chip
          selected={pickup}
          disabled={off}
          onClick={() => pickup || execute(() => setPickupAction(date, true, pickerId))}
        >
          <ShoppingBag className="size-3.5" /> Abholen
        </Chip>
      </div>
      {pickup && (
        <Label>
          Wer holt ab?
          <Select
            value={pickerId ?? ''}
            disabled={off}
            onChange={(event) =>
              execute(() =>
                setPickupAction(date, true, event.target.value ? Number(event.target.value) : null)
              )
            }
          >
            <option value="">{hostName} (Gastgeber)</option>
            {members
              .filter((member) => member.id !== hostId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </Select>
          <Hint>
            Zahlt im Restaurant und bekommt das Geld fürs Essen. Ohne Liefer- und Servicegebühr,
            ohne Trinkgeld; die Getränkepauschale geht weiter an {hostName}.
          </Hint>
        </Label>
      )}
    </div>
  );
}

export function HostPicker({
  date,
  hostId,
  hostIsDefault,
  defaultHostName,
  members,
}: {
  date: string;
  hostId: number | null;
  hostIsDefault: boolean;
  defaultHostName: string | null;
  members: Option[];
}) {
  const { pending, execute } = useAction();
  return (
    <Label>
      Gastgeber
      <Select
        value={hostIsDefault ? '' : (hostId ?? '')}
        disabled={pending}
        onChange={(event) =>
          execute(() => setHostAction(date, event.target.value ? Number(event.target.value) : null))
        }
      >
        <option value="">
          {defaultHostName ? `${defaultHostName} (wie immer)` : '– Standard –'}
        </option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
    </Label>
  );
}

export function CancelToggle({
  date,
  cancelled,
  reason,
}: {
  date: string;
  cancelled: boolean;
  reason: string | null;
}) {
  const [text, setText] = useState(reason ?? '');
  const { pending, execute } = useAction();
  if (cancelled) {
    return (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => execute(() => setCancelledAction(date, false, ''))}
      >
        <CalendarCheck /> Findet doch statt
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        execute(() => setCancelledAction(date, true, text));
      }}
    >
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Grund (optional)"
        maxLength={200}
      />
      <Button type="submit" variant="outline" className="text-destructive" disabled={pending}>
        <Ban /> Freitag absagen
      </Button>
    </form>
  );
}

export function NoteEditor({ date, note }: { date: string; note: string | null }) {
  const [text, setText] = useState(note ?? '');
  const { pending, execute } = useAction();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        execute(() => setNoteAction(date, text));
      }}
    >
      <Label className="flex-1">
        Notiz für alle
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="z. B. Wir sind diesmal bei Anna"
          maxLength={300}
        />
      </Label>
      <Button type="submit" variant="outline" disabled={pending || text === (note ?? '')}>
        <Save /> Speichern
      </Button>
    </form>
  );
}
