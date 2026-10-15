'use client';

import { Plus, Search, Users } from 'lucide-react';
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
import { byDishName, categoriesOf, groupByCategory } from '@/lib/menu/groups';

const ALL = '__all__';
const TAKEN = '__taken__';
const NAMES_SHOWN = 3;

function whoTook(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  return names.length > NAMES_SHOWN ? `${shown} +${names.length - NAMES_SHOWN}` : shown;
}

/** The restaurant's menu: search, category chips and a card per dish that opens the dialog. */
export function Menu({
  dishes,
  mode,
  date,
  restaurantId,
  targets,
  initialTargetId,
  defaultDishId,
  takenBy = {},
  ahead = false,
  hint,
}: {
  dishes: MenuDish[];
  mode: 'order' | 'default';
  date?: string;
  restaurantId: number;
  targets: OrderTarget[];
  initialTargetId: number;
  defaultDishId?: number | null;
  /** Who already picked a dish this Friday, by dish id. */
  takenBy?: Record<number, string[]>;
  /** The Friday does not order here yet: orders count if the restaurant wins the vote. */
  ahead?: boolean;
  /** What ordering here means, shown in the dish dialog. */
  hint?: string;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [opened, setOpened] = useState<OpenedDish | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const deferredCategory = useDeferredValue(category);

  const categories = useMemo(() => categoriesOf(dishes), [dishes]);

  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return dishes.filter(
      (dish) =>
        (deferredCategory === ALL ||
          (deferredCategory === TAKEN
            ? Boolean(takenBy[dish.id])
            : dish.category === deferredCategory)) &&
        (!needle ||
          dish.name.toLowerCase().includes(needle) ||
          dish.description?.toLowerCase().includes(needle))
    );
  }, [dishes, deferredQuery, deferredCategory, takenBy]);
  const takenCount = dishes.filter((dish) => takenBy[dish.id]).length;

  const groups = useMemo(() => {
    // „Alles“ and „Was die anderen nehmen“ read like the menu: one heading per category.
    if (deferredCategory !== ALL && deferredCategory !== TAKEN) {
      return [{ key: '', name: null, dishes: [...visible].sort(byDishName) }];
    }
    return groupByCategory(visible, categories);
  }, [visible, deferredCategory, categories]);

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
        {(categories.length > 1 || takenCount > 0) && (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <Chip selected={category === ALL} onClick={() => setCategory(ALL)}>
              Alles
            </Chip>
            {takenCount > 0 && (
              <Chip selected={category === TAKEN} onClick={() => setCategory(TAKEN)}>
                <Users className="size-3.5" /> Was die anderen nehmen
              </Chip>
            )}
            {categories.map((name) => (
              <Chip key={name} selected={category === name} onClick={() => setCategory(name)}>
                {name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.key}>
            {group.name && (
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
                {group.name}
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {group.dishes.length}
                </span>
                <span className="bg-border h-px flex-1" aria-hidden />
              </h3>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.dishes.map((dish) => (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => {
                    setOpenCount(openCount + 1);
                    setOpened({ dish, instance: openCount + 1 });
                  }}
                  className="group bg-card/60 hover:border-primary/50 relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors sm:items-start sm:py-3"
                >
                  {/* Name and price share a line, so a phone shows twice the dishes. */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="group-hover:text-primary min-w-0 truncate text-[15px] font-bold transition-colors">
                        {dish.name}
                      </span>
                      {dish.id === defaultDishId && (
                        <span className="border-primary/30 bg-primary/10 text-primary shrink-0 rounded-full border px-1.5 text-[10px] font-bold tracking-wider uppercase">
                          Standard
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                        {dish.optionGroups.length > 0 && (
                          <span className="text-muted-foreground font-normal">ab </span>
                        )}
                        {formatEuro(dish.priceCents)}
                      </span>
                    </div>
                    {dish.description && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs sm:line-clamp-2">
                        {dish.description}
                      </p>
                    )}
                    {takenBy[dish.id] && (
                      <p className="text-primary mt-1 flex items-center gap-1 text-xs font-medium">
                        <Users className="size-3 shrink-0" />
                        <span className="truncate">{whoTook(takenBy[dish.id]!)}</span>
                      </p>
                    )}
                  </div>
                  <span className="border-primary/30 bg-primary/10 text-primary group-hover:bg-primary flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors group-hover:text-white sm:size-8">
                    <Plus className="size-4" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {visible.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">Nichts gefunden.</p>
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
        ahead={ahead}
        hint={hint}
      />
    </div>
  );
}
