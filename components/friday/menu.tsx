'use client';

import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  DishDialog,
  type MenuDish,
  type OpenedDish,
  type OrderTarget,
} from '@/components/friday/dish-dialog';
import { MissingDishForm } from '@/components/friday/missing-dish-form';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/format';

const ALL = '__all__';

/** The restaurant's menu: search, category chips and a card per dish that opens the dialog. */
export function Menu({
  dishes,
  mode,
  date,
  restaurantId,
  targets,
  initialTargetId,
  defaultDishId,
}: {
  dishes: MenuDish[];
  mode: 'order' | 'default';
  date?: string;
  restaurantId: number;
  targets: OrderTarget[];
  initialTargetId: number;
  defaultDishId?: number | null;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [opened, setOpened] = useState<OpenedDish | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const deferredCategory = useDeferredValue(category);

  const categories = useMemo(
    () => [
      ...new Set(
        dishes.map((dish) => dish.category).filter((name): name is string => Boolean(name))
      ),
    ],
    [dishes]
  );

  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return dishes.filter(
      (dish) =>
        (deferredCategory === ALL || dish.category === deferredCategory) &&
        (!needle ||
          dish.name.toLowerCase().includes(needle) ||
          dish.description?.toLowerCase().includes(needle))
    );
  }, [dishes, deferredQuery, deferredCategory]);

  if (dishes.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground bg-muted/30 rounded-xl border p-6 text-center text-sm">
          Für dieses Restaurant sind noch keine Gerichte eingetragen.
        </p>
        <MissingDishForm restaurantId={restaurantId} date={mode === 'order' ? date : undefined} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Gericht suchen …"
            className="pl-9"
          />
        </div>
        {categories.length > 1 && (
          <div className="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-1">
            {[ALL, ...categories].map((name) => (
              <Chip key={name} selected={category === name} onClick={() => setCategory(name)}>
                {name === ALL ? 'Alles' : name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((dish) => (
          <button
            key={dish.id}
            type="button"
            onClick={() => {
              setOpenCount(openCount + 1);
              setOpened({ dish, instance: openCount + 1 });
            }}
            className="group bg-card/60 hover:border-primary/50 relative flex items-start gap-3 rounded-xl border p-3 text-left transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="group-hover:text-primary truncate text-[15px] font-bold transition-colors">
                  {dish.name}
                </span>
                {dish.id === defaultDishId && (
                  <span className="border-primary/30 bg-primary/10 text-primary shrink-0 rounded-full border px-1.5 text-[10px] font-bold tracking-wider uppercase">
                    Standard
                  </span>
                )}
              </div>
              {dish.description && (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                  {dish.description}
                </p>
              )}
              <p className="mt-1.5 text-sm font-semibold tabular-nums">
                {dish.optionGroups.length > 0 && (
                  <span className="text-muted-foreground font-normal">ab </span>
                )}
                {formatEuro(dish.priceCents)}
              </p>
            </div>
            <span className="border-primary/30 bg-primary/10 text-primary group-hover:bg-primary flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors group-hover:text-white">
              <Plus className="size-4" />
            </span>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="text-muted-foreground col-span-full py-6 text-center text-sm">
            Nichts gefunden.
          </p>
        )}
      </div>

      <div className="mt-3">
        <MissingDishForm restaurantId={restaurantId} date={mode === 'order' ? date : undefined} />
      </div>

      <DishDialog
        opened={opened}
        onClose={() => setOpened(null)}
        mode={mode}
        date={date}
        restaurantId={restaurantId}
        targets={targets}
        initialTargetId={initialTargetId}
      />
    </div>
  );
}
