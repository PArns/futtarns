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

const ALL = '__all__';
const byName = new Intl.Collator('de', { numeric: true }).compare;
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

  // Under „Alles“ the menu reads like the restaurant's: one heading per category.
  const groups = useMemo(() => {
    const sorted = [...visible].sort((a, b) => byName(a.name, b.name));
    if (deferredCategory !== ALL) return [{ key: '', name: null, dishes: sorted }];
    const byCategory = new Map<string | null, MenuDish[]>();
    for (const name of [...categories, null]) byCategory.set(name, []);
    for (const dish of sorted) byCategory.get(dish.category ?? null)!.push(dish);
    return [...byCategory.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([name, list]) => ({
        key: name ?? '',
        name: name ?? (categories.length > 0 ? 'Sonstiges' : null),
        dishes: list,
      }));
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
          <div className="flex flex-wrap gap-1.5">
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
                    {takenBy[dish.id] && (
                      <p className="text-primary mt-1 flex items-center gap-1 text-xs font-medium">
                        <Users className="size-3 shrink-0" />
                        <span className="truncate">{whoTook(takenBy[dish.id]!)}</span>
                      </p>
                    )}
                  </div>
                  <span className="border-primary/30 bg-primary/10 text-primary group-hover:bg-primary flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors group-hover:text-white">
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
      />
    </div>
  );
}
