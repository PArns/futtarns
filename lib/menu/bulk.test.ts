import { describe, expect, it } from 'vitest';
import { parseBulkDishes } from '@/lib/menu/bulk';

describe('parseBulkDishes', () => {
  it('reads categories, prices and descriptions', () => {
    const { dishes, errors } = parseBulkDishes(
      '# Pizza\nMargherita 8,50 | Tomate, Mozzarella\nPizza 4 Formaggi 10.90 €\n\n# Getränke\nCola 0,33l 2,50'
    );
    expect(errors).toEqual([]);
    expect(dishes).toEqual([
      { category: 'Pizza', name: 'Margherita', priceCents: 850, description: 'Tomate, Mozzarella' },
      { category: 'Pizza', name: 'Pizza 4 Formaggi', priceCents: 1090, description: null },
      { category: 'Getränke', name: 'Cola 0,33l', priceCents: 250, description: null },
    ]);
  });

  it('reports lines without a price', () => {
    const { dishes, errors } = parseBulkDishes('Margherita\n8,50');
    expect(dishes).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});
