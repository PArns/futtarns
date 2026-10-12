import { describe, expect, it } from 'vitest';
import { parseBulkDishes } from '@/lib/menu/bulk';

describe('parseBulkDishes', () => {
  it('reads typed categories, prices and descriptions', () => {
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

  it('reads a menu copied from a delivery page, price on its own line', () => {
    const { dishes, errors } = parseBulkDishes(
      [
        '# Pizza',
        'Pizza Margherita',
        'mit Tomatensauce und Käse',
        '8,50 €',
        'Beliebt',
        'Pizza Salami',
        'mit Rindersalami',
        'Wahl aus: Klein, Groß.',
        'ab 9,90 €',
      ].join('\n')
    );
    expect(errors).toEqual([]);
    expect(dishes).toEqual([
      {
        category: 'Pizza',
        name: 'Pizza Margherita',
        priceCents: 850,
        description: 'mit Tomatensauce und Käse',
      },
      {
        category: 'Pizza',
        name: 'Pizza Salami',
        priceCents: 990,
        description: 'mit Rindersalami Wahl aus: Klein, Groß.',
      },
    ]);
  });

  it('does not read a number in a name as its price', () => {
    const { dishes } = parseBulkDishes('Menü 1\n12,90 €\nSushi Box 8 14,50\nCola 2 €');
    expect(dishes.map((dish) => [dish.name, dish.priceCents])).toEqual([
      ['Menü 1', 1290],
      ['Sushi Box 8', 1450],
      ['Cola', 200],
    ]);
  });

  it('reports lines without a price', () => {
    const { dishes, errors } = parseBulkDishes('Margherita\n# Pasta\n8,50 €');
    expect(dishes).toEqual([]);
    expect(errors).toEqual([
      'Zeile 1: „Margherita“ hat keinen Preis',
      'Zeile 3: Preis ohne Gericht davor',
    ]);
  });
});
