const collator = new Intl.Collator('de', { numeric: true });

/** Sorts dishes the way the menu lists them within a heading: by name, numbers as numbers. */
export function byDishName(a: { name: string }, b: { name: string }): number {
  return collator.compare(a.name, b.name);
}

/** A menu's categories in the order its dishes first name them. */
export function categoriesOf(dishes: { category: string | null }[]): string[] {
  return [
    ...new Set(dishes.map((dish) => dish.category).filter((name): name is string => Boolean(name))),
  ];
}

/**
 * Dishes under their category headings, in the menu's order and by name within one. Dishes
 * without a category come last, as „Sonstiges“ once the menu has categories at all.
 */
export function groupByCategory<T extends { name: string; category: string | null }>(
  dishes: T[],
  categories: string[] = categoriesOf(dishes)
): { key: string; name: string | null; dishes: T[] }[] {
  const byCategory = new Map<string | null, T[]>();
  for (const name of [...categories, null]) byCategory.set(name, []);
  for (const dish of [...dishes].sort(byDishName)) {
    byCategory.get(dish.category ?? null)?.push(dish);
  }
  return [...byCategory.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => ({
      key: name ?? '',
      name: name ?? (categories.length > 0 ? 'Sonstiges' : null),
      dishes: list,
    }));
}
