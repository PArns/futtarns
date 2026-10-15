'use client';

import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import type { MenuDish } from '@/components/friday/dish-dialog';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/format';
import { groupByCategory } from '@/lib/menu/groups';

/** Long enough that finding the pizza needs a search field. */
const SEARCH_FROM = 12;

/**
 * A restaurant's menu on the ballot: headings, dishes and prices. With `onPick` every dish
 * can be tapped to order it.
 */
export function MenuPreview({
  dishes,
  onPick,
}: {
  dishes: MenuDish[];
  onPick?: (dish: MenuDish) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = useDeferredValue(query).trim().toLowerCase();
  const groups = useMemo(
    () =>
      groupByCategory(
        dishes.filter(
          (dish) =>
            !needle ||
            dish.name.toLowerCase().includes(needle) ||
            dish.description?.toLowerCase().includes(needle)
        )
      ),
    [dishes, needle]
  );

  return (
    <div className="space-y-3">
      {dishes.length >= SEARCH_FROM && (
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Auf der Karte suchen"
            aria-label="Auf der Karte suchen"
            className="pl-9"
          />
        </div>
      )}
      <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
        {groups.length === 0 && <p className="text-muted-foreground text-sm">Nichts gefunden.</p>}
        {groups.map((group) => (
          <div key={group.key}>
            {group.name && (
              <div className="text-primary mb-1 text-[11px] font-bold tracking-[0.14em] uppercase">
                {group.name}
              </div>
            )}
            <ul className="divide-border/40 divide-y">
              {group.dishes.map((dish) => {
                const content = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{dish.name}</span>
                      {dish.description && (
                        <span className="text-muted-foreground line-clamp-2 block text-xs">
                          {dish.description}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {dish.optionGroups.length > 0 && (
                        <span className="text-muted-foreground">ab </span>
                      )}
                      {formatEuro(dish.priceCents)}
                    </span>
                  </>
                );
                return (
                  <li key={dish.id}>
                    {onPick ? (
                      <button
                        type="button"
                        onClick={() => onPick(dish)}
                        className="group flex w-full items-center gap-3 py-1.5 text-left text-sm"
                      >
                        {content}
                        <span className="border-primary/30 bg-primary/10 text-primary group-hover:bg-primary flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors group-hover:text-white">
                          <Plus className="size-3.5" />
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-baseline gap-3 py-1.5 text-sm">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
