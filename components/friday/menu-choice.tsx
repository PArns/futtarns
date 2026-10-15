'use client';

import { Crown, Vote } from 'lucide-react';
import { useState } from 'react';
import type { MenuDish, OrderTarget } from '@/components/friday/dish-dialog';
import { Menu } from '@/components/friday/menu';
import { Chip } from '@/components/ui/chip';

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
        <div role="group" aria-label="Karte wählen" className="mb-4 flex flex-wrap gap-1.5">
          {menus.map((menu) => (
            <Chip
              key={menu.restaurantId}
              selected={menu.restaurantId === shown.restaurantId}
              onClick={() => setShownId(menu.restaurantId)}
            >
              {menu.ahead ? (
                <Vote className="text-primary size-3.5" />
              ) : (
                <Crown className="text-warning size-3.5" />
              )}
              {menu.name}
              <span className="text-muted-foreground font-normal">
                {menu.ahead ? 'deine Wahl' : 'bisher'}
              </span>
            </Chip>
          ))}
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
