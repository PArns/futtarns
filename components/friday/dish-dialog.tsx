'use client';

import { Check, Minus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { addItemAction, saveDefaultAction } from '@/app/actions';
import { announceOrder } from '@/components/friday/order-event';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import type { OptionGroup } from '@/lib/menu/options';
import { cn } from '@/lib/utils';

export type MenuDish = {
  id: number;
  category: string | null;
  name: string;
  description: string | null;
  priceCents: number;
  optionGroups: OptionGroup[];
};

export type OrderTarget = { id: number; name: string; isSelf: boolean };

export type OpenedDish = { dish: MenuDish; instance: number };

type Props = {
  opened: OpenedDish | null;
  onClose: () => void;
  mode: 'order' | 'default';
  date?: string;
  restaurantId: number;
  targets: OrderTarget[];
  initialTargetId: number;
  /** The Friday does not order here yet: the order counts if the restaurant wins the vote. */
  ahead?: boolean;
  /** Ordered from the ballot, so it is the viewer's vote for this restaurant, too. */
  vote?: boolean;
  /** A line above the button on what ordering here means. */
  hint?: string;
  /** How many of each dish (by id) the viewer already has from this restaurant. */
  ordered?: Record<number, number>;
};

function initialSelection(groups: OptionGroup[]): Record<string, string[]> {
  // A group that needs exactly one answer starts on its first choice, usually the base size.
  return Object.fromEntries(
    groups.map((group) => [
      group.id,
      group.min === 1 && group.max === 1 ? [group.choices[0]!.id] : [],
    ])
  );
}

/**
 * Picks options, amount and a note for one dish, then orders it or saves it as the
 * member's default for this restaurant.
 */
export function DishDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { opened, onClose } = props;
  // The last dish stays rendered after closing, so the dialog fades out with its content.
  const [shown, setShown] = useState(opened);
  if (opened && opened !== shown) setShown(opened);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (opened && !dialog.open) dialog.showModal();
    if (!opened && dialog.open) dialog.close();
  }, [opened]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="glass-tile text-foreground m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border p-0 opacity-0 shadow-2xl transition-[opacity,display,overlay] transition-discrete duration-200 backdrop:transition-[opacity,display,overlay] backdrop:transition-discrete backdrop:duration-200 open:opacity-100 starting:open:opacity-0"
    >
      {shown && (
        <DishForm
          key={shown.instance}
          {...props}
          dish={shown.dish}
          close={() => ref.current?.close()}
        />
      )}
    </dialog>
  );
}

function DishForm({
  dish,
  mode,
  date,
  restaurantId,
  targets,
  initialTargetId,
  ahead = false,
  vote = false,
  hint,
  ordered = {},
  close,
}: Omit<Props, 'opened' | 'onClose'> & { dish: MenuDish; close: () => void }) {
  const [selection, setSelection] = useState(() => initialSelection(dish.optionGroups));
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [targetId, setTargetId] = useState(initialTargetId);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const { pending, execute } = useAction();
  // Taken before the first re-render, so a double click cannot send the order twice.
  const sending = useRef(false);

  const target = targets.find((entry) => entry.id === targetId);
  // Ordering something the viewer already has is most likely a tap too many, so say so.
  const already = mode === 'order' && target?.isSelf ? (ordered[dish.id] ?? 0) : 0;
  const extras = dish.optionGroups.flatMap((group) =>
    group.choices.filter((choice) => selection[group.id]?.includes(choice.id))
  );
  const unit = dish.priceCents + extras.reduce((sum, choice) => sum + choice.priceCents, 0);

  function toggle(group: OptionGroup, choiceId: string) {
    setSelection((current) => {
      const picked = current[group.id] ?? [];
      if (group.max === 1)
        return {
          ...current,
          [group.id]: picked.includes(choiceId) && group.min === 0 ? [] : [choiceId],
        };
      if (picked.includes(choiceId))
        return { ...current, [group.id]: picked.filter((id) => id !== choiceId) };
      if (picked.length >= group.max) return current;
      return { ...current, [group.id]: [...picked, choiceId] };
    });
  }

  function submit() {
    if (sending.current) return;
    sending.current = true;
    const done = () => {
      sending.current = false;
    };
    if (mode === 'default') {
      execute(
        () => saveDefaultAction({ restaurantId, dishId: dish.id, selection, note }).finally(done),
        close
      );
      return;
    }
    execute(
      () =>
        addItemAction({
          date: date!,
          memberId: targetId,
          restaurantId,
          vote,
          dishId: dish.id,
          selection,
          quantity,
          note,
          saveAsDefault: saveAsDefault && Boolean(target?.isSelf),
          again: already > 0,
        }).finally(done),
      () => {
        close();
        announceOrder({ dishId: dish.id, name: dish.name });
      }
    );
  }

  return (
    <form
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex max-h-[85dvh] flex-col"
    >
      <div className="border-border/50 flex items-start gap-3 border-b p-5">
        <div className="min-w-0 flex-1">
          {dish.category && (
            <div className="text-primary mb-1 text-[11px] font-bold tracking-[0.14em] uppercase">
              {dish.category}
            </div>
          )}
          <h3 className="text-xl leading-tight font-extrabold tracking-tight">{dish.name}</h3>
          {dish.description && (
            <p className="text-muted-foreground mt-1 text-sm">{dish.description}</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="Schließen">
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {dish.optionGroups.map((group) => {
          const picked = selection[group.id] ?? [];
          const rule =
            group.min === group.max
              ? `${group.min} wählen`
              : group.min === 0
                ? `bis zu ${group.max}`
                : `${group.min}–${group.max} wählen`;
          return (
            <fieldset key={group.id}>
              <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-sm font-semibold">
                {group.name}
                <span className="text-muted-foreground text-xs font-normal">{rule}</span>
              </legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {group.choices.map((choice) => {
                  const active = picked.includes(choice.id);
                  const full = !active && group.max > 1 && picked.length >= group.max;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={full}
                      onClick={() => toggle(group, choice.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                        active
                          ? 'border-primary/60 bg-primary/15 font-semibold'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      {/* A circle where one is picked, a box where several can be. */}
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center border',
                          group.max === 1 ? 'rounded-full' : 'rounded-[4px]',
                          active
                            ? 'border-primary bg-primary text-white'
                            : 'border-muted-foreground/60'
                        )}
                      >
                        {active &&
                          (group.max === 1 ? (
                            <span className="size-1.5 rounded-full bg-white" />
                          ) : (
                            <Check className="size-3" strokeWidth={3} />
                          ))}
                      </span>
                      <span className="min-w-0 flex-1">{choice.name}</span>
                      {choice.priceCents !== 0 && (
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {choice.priceCents > 0 ? '+' : ''}
                          {formatEuro(choice.priceCents)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <Label>
          Notiz fürs Restaurant
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="z. B. ohne Zwiebeln"
            maxLength={200}
          />
        </Label>

        {mode === 'order' && targets.length > 1 && (
          <Label>
            Für
            <Select value={targetId} onChange={(event) => setTargetId(Number(event.target.value))}>
              {targets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.isSelf ? `Mich (${entry.name})` : entry.name}
                </option>
              ))}
            </Select>
          </Label>
        )}

        {mode === 'order' && target?.isSelf && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(event) => setSaveAsDefault(event.target.checked)}
              className="accent-primary size-4"
            />
            Als mein Standard bei diesem Restaurant merken
          </label>
        )}
      </div>

      {hint && (
        <p className="border-border/50 text-muted-foreground border-t px-5 pt-3 text-xs">{hint}</p>
      )}
      {already > 0 && (
        <p
          className={cn(
            'text-success flex items-center gap-1.5 px-5 pt-3 text-sm font-semibold',
            !hint && 'border-border/50 border-t'
          )}
        >
          <Check className="size-4 shrink-0" />
          Hast du schon bestellt{already > 1 ? ` (${already}×)` : ''}. Noch mal?
        </p>
      )}
      <div
        className={cn(
          'flex items-center gap-3 px-5 pb-5',
          hint || already > 0 ? 'pt-3' : 'border-border/50 border-t pt-4'
        )}
      >
        {mode === 'order' && (
          <div className="border-border flex items-center rounded-xl border">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setQuantity((n) => Math.max(1, n - 1))}
              aria-label="Weniger"
            >
              <Minus />
            </Button>
            <span className="w-6 text-center font-semibold tabular-nums">{quantity}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setQuantity((n) => Math.min(20, n + 1))}
              aria-label="Mehr"
            >
              <Plus />
            </Button>
          </div>
        )}
        <Button
          type="submit"
          size="xl"
          className="h-auto min-h-12 min-w-0 flex-1 flex-wrap gap-x-1.5 gap-y-0 py-2"
          disabled={pending}
        >
          <span>
            {mode === 'default'
              ? 'Als Standard merken'
              : already > 0
                ? 'Noch mal bestellen'
                : ahead
                  ? 'Vorbestellen'
                  : 'Bestellen'}
          </span>
          <span className="tabular-nums opacity-90">
            {formatEuro(unit * (mode === 'order' ? quantity : 1))}
          </span>
        </Button>
      </div>
    </form>
  );
}
