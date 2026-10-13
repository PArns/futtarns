'use client';

import { Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/format';
import { groupByCategory } from '@/lib/menu/groups';

export type MenuPreviewDish = {
  id: number;
  category: string | null;
  name: string;
  description: string | null;
  priceCents: number;
};

/** Long enough that finding the pizza needs a search field. */
const SEARCH_FROM = 12;

/** A restaurant's menu to look at while voting: headings, dishes and prices, nothing to tap. */
export function MenuPreview({ dishes }: { dishes: MenuPreviewDish[] }) {
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
              {group.dishes.map((dish) => (
                <li key={dish.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{dish.name}</span>
                    {dish.description && (
                      <span className="text-muted-foreground line-clamp-2 block text-xs">
                        {dish.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatEuro(dish.priceCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
