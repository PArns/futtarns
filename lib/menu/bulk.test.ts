import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('reads a Lieferando page with its doubled headings and the „Beliebt“ section', () => {
    const page = readFileSync(join(__dirname, 'fixtures/lieferando.txt'), 'utf8');
    const { dishes, errors } = parseBulkDishes(page);
    expect(errors).toEqual(['„Angebot 3 (für 1 Person)“ ist gerade nicht verfügbar']);
    expect(dishes.map((dish) => [dish.category, dish.name, dish.priceCents])).toEqual([
      ['Angebote', 'Angebot 1 - Pizza', 2140],
      ['Vorspeisen', 'Pizzabrötchen mit Kräutercreme', 340],
      ['Amerikanisch - Pizza', 'Pizza Western', 940],
      ['Salate', 'Salat Nagra', 893],
      ['Pizza', 'Pizza Tonno', 840],
      ['Pizza', 'Pizza Sucuk', 890],
      ['Schnitzelgerichte', 'Hollandschnitzel', 1340],
      ['Rumpsteak', 'Bistecca Funghi', 1590],
      ['Beilagen', 'Reis', 340],
      ['Alkoholfreie Getränke', 'Coca-Cola 1,0l (MEHRWEG)', 290],
      ['Alkoholfreie Getränke', 'Durstlöscher Orange 0,5l', 170],
      ['Alkoholische Getränke', 'Pils 0,5l', 240],
    ]);
    const byName = Object.fromEntries(dishes.map((dish) => [dish.name, dish]));
    expect(byName['Angebot 1 - Pizza']!.description).toBe(
      '1 Pizza (Ø 40cm) mit 2 Zutaten nach Wahl, 1 Salat nach Wahl, 1 alkoholfreies Getränk 1,0l nach Wahl'
    );
    expect(byName['Pizza Tonno']!.description).toBe('mit Thunfisch');
    expect(byName['Pizza Sucuk']!.description).toBeNull();
    expect(byName['Coca-Cola 1,0l (MEHRWEG)']!.description).toMatch(/^Coca-Cola steht für/);
  });

  it('keeps names and descriptions within what the import accepts', () => {
    const long = 'x'.repeat(400);
    const { dishes } = parseBulkDishes(
      `${long}\n8,50 €\nKurz\nProduktinfo\n1,00 €\n${long}\n${long}\nB\nProduktinfo\n2,00 €`
    );
    expect(dishes.every((dish) => dish.name.length <= 120)).toBe(true);
    expect(dishes.every((dish) => (dish.description?.length ?? 0) <= 300)).toBe(true);
  });
});
