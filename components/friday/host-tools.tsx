'use client';

import { Ban, CalendarCheck, CirclePause, Save, ShoppingBag, Truck } from 'lucide-react';
import { useState } from 'react';
import {
  chooseRestaurantAction,
  setCancelledAction,
  setHostAction,
  setNoteAction,
  setPausedAction,
  setPickupAction,
} from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Hint, Input, Label, Select } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';
import { VOTE_CLOSE_HOUR } from '@/lib/vote';

type Option = { id: number; name: string };

export function RestaurantPicker({
  date,
  restaurantId,
  restaurants,
  hasOrders,
  disabled,
  voting,
}: {
  date: string;
  restaurantId: number | null;
  restaurants: (Option & { isDefault?: boolean })[];
  hasOrders: boolean;
  disabled?: boolean;
  /** The group is still voting; picking one here ends the vote. */
  voting?: boolean;
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
            {restaurant.isDefault ? ' (Stammlokal)' : ''}
          </option>
        ))}
      </Select>
      {disabled && <Hint>Schon abgerechnet. Zum Wechseln erst die Abrechnung öffnen.</Hint>}
      {voting && !disabled && (
        <Hint>
          Die Restaurantwahl läuft bis Freitag, {VOTE_CLOSE_HOUR}:00. Wählst du hier selbst, ist sie
          vorbei.
        </Hint>
      )}
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
  delivers = true,
}: {
  date: string;
  pickup: boolean;
  /** Who fetches it when not the host. */
  pickerId: number | null;
  hostId: number | null;
  hostName: string;
  members: Option[];
  disabled?: boolean;
  /** The restaurant delivers to the host; if not, the food has to be fetched. */
  delivers?: boolean;
}) {
  const { pending, execute } = useAction();
  const off = pending || disabled;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip
          selected={!pickup}
          disabled={off || !delivers}
          title={delivers ? undefined : `Liefert nicht zu ${hostName}`}
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

/** What a host picker's value means: the default host (``), nobody, or a member's id. */
export function hostChoice(value: string): number | 'none' | null {
  return value === 'none' ? 'none' : value ? Number(value) : null;
}

export function HostPicker({
  date,
  hostId,
  hostIsDefault,
  noHost,
  canClear,
  defaultHostName,
  members,
}: {
  date: string;
  hostId: number | null;
  hostIsDefault: boolean;
  /** Put at nobody's place: the group sorts out who takes it over. */
  noHost: boolean;
  /** Admins may put a Friday at nobody's place. */
  canClear: boolean;
  defaultHostName: string | null;
  members: Option[];
}) {
  const { pending, execute } = useAction();
  return (
    <Label>
      Gastgeber
      <Select
        value={noHost ? 'none' : hostIsDefault ? '' : (hostId ?? '')}
        disabled={pending}
        onChange={(event) => execute(() => setHostAction(date, hostChoice(event.target.value)))}
      >
        <option value="">
          {defaultHostName ? `${defaultHostName} (wie immer)` : '– Standard –'}
        </option>
        {(canClear || noHost) && (
          <option value="none" disabled={!canClear}>
            Bei niemandem (macht das unter euch aus)
          </option>
        )}
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
      {noHost && (
        <Hint>
          Keiner ist Gastgeber. Wer aus der Stammtruppe kann, übernimmt den Freitag auf seiner
          Seite.
        </Hint>
      )}
    </Label>
  );
}

/**
 * Calls the Friday off, or pauses it: the evening takes place, but without the app (they
 * fetch something themselves). Both share the reason; either one is taken back with a tap.
 */
export function CancelToggle({
  date,
  cancelled,
  paused,
  reason,
}: {
  date: string;
  cancelled: boolean;
  paused: boolean;
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
        <CalendarCheck /> {paused ? 'Doch mit Bestellsystem' : 'Findet doch statt'}
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Grund (optional), z. B. „Wir holen Döner“"
        aria-label="Grund"
        maxLength={200}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => execute(() => setPausedAction(date, true, text))}
        >
          <CirclePause /> Ohne Bestellsystem
        </Button>
        <Button
          variant="outline"
          className="text-destructive"
          disabled={pending}
          onClick={() => execute(() => setCancelledAction(date, true, text))}
        >
          <Ban /> Freitag absagen
        </Button>
      </div>
      <Hint>
        Ohne Bestellsystem: Der Abend findet statt, aber hier wird nicht bestellt, gezahlt oder
        erinnert. Alle bekommen einmal Bescheid.
      </Hint>
    </div>
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
