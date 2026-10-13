import { describe, expect, it } from 'vitest';
import { groupByCategory } from '@/lib/menu/groups';

const dish = (name: string, category: string | null) => ({ name, category });

describe('groupByCategory', () => {
  it('keeps the menu’s category order, sorts by name and puts the rest last', () => {
    const groups = groupByCategory([
      dish('Pizza 12', 'Pizza'),
      dish('Cola', null),
      dish('Pizza 2', 'Pizza'),
      dish('Tiramisu', 'Desserts'),
    ]);
    expect(groups.map((group) => [group.name, group.dishes.map((entry) => entry.name)])).toEqual([
      ['Pizza', ['Pizza 2', 'Pizza 12']],
      ['Desserts', ['Tiramisu']],
      ['Sonstiges', ['Cola']],
    ]);
  });

  it('has no heading for a menu without categories', () => {
    expect(groupByCategory([dish('Döner', null)])).toEqual([
      { key: '', name: null, dishes: [dish('Döner', null)] },
    ]);
  });
});
