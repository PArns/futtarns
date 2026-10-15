'use client';

import { Crown, Vote } from 'lucide-react';
import { useState } from 'react';
import type { MenuDish, OrderTarget } from '@/components/friday/dish-dialog';
import { Menu } from '@/components/friday/menu';
import { cn } from '@/lib/utils';

export type MenuOption = {
  restaurantId: number;
  name: string;
  dishes: MenuDish[];
  targets: OrderTarget[];
  defaultDishId: number | null;
  /** The Friday does not order here yet: orders count if the restaurant wins the vote. */
  ahead: boolean;
  /** What ordering here means, shown in the dish dialog. */
  hint?: string;
};

/**
 * The menus the viewer orders from: the Friday's restaurant and, while the vote runs, the
 * one they voted for, with a switch between the two. Shows the voted one first, and again
 * whenever the vote moves to another restaurant.
 */
export function MenuChoice({
  date,
  menus,
  takenBy,
}: {
  date: string;
  menus: MenuOption[];
  takenBy: Record<number, string[]>;
}) {
  const aheadId = menus.find((menu) => menu.ahead)?.restaurantId ?? null;
  const [shownId, setShownId] = useState(aheadId ?? menus[0]!.restaurantId);
  const [seenAheadId, setSeenAheadId] = useState(aheadId);
  if (aheadId !== seenAheadId) {
    setSeenAheadId(aheadId);
    if (aheadId !== null) setShownId(aheadId);
  }
  const shown = menus.find((menu) => menu.restaurantId === shownId) ?? menus[0]!;

  return (
    <div>
      {menus.length > 1 && (
        <div
          role="group"
          aria-label="Karte wählen"
          className="bg-muted/40 mb-4 grid grid-cols-2 gap-1 rounded-2xl border p-1"
        >
          {menus.map((menu) => {
            const selected = menu.restaurantId === shown.restaurantId;
            return (
              <button
                key={menu.restaurantId}
                type="button"
                aria-pressed={selected}
                onClick={() => setShownId(menu.restaurantId)}
                className={cn(
                  'flex min-w-0 flex-col items-center rounded-xl px-2 py-2 text-sm transition-colors',
                  selected
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="flex max-w-full items-center gap-1.5 font-semibold">
                  {menu.ahead ? (
                    <Vote className="text-primary size-3.5 shrink-0" />
                  ) : (
                    <Crown className="text-warning size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{menu.name}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {menu.ahead ? 'deine Wahl' : 'bisher'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <Menu
        key={shown.restaurantId}
        dishes={shown.dishes}
        mode="order"
        date={date}
        restaurantId={shown.restaurantId}
        targets={shown.targets}
        initialTargetId={shown.targets[0]!.id}
        defaultDishId={shown.defaultDishId}
        takenBy={takenBy}
        ahead={shown.ahead}
        hint={shown.hint}
      />
    </div>
  );
}
