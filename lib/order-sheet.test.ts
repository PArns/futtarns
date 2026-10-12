import { describe, expect, it } from 'vitest';
import { buildOrderSheet, orderSheetText } from '@/lib/order-sheet';

const size = (choice: string) => [
  { groupId: 'g', groupName: 'Größe', choiceId: choice, choiceName: choice, priceCents: 0 },
];
const names: Record<number, string> = { 1: 'Anna', 2: 'Ben', 3: 'Clara' };

describe('buildOrderSheet', () => {
  it('folds identical dishes and keeps different options apart', () => {
    const lines = buildOrderSheet(
      [
        {
          dishId: 1,
          name: 'Margherita',
          options: size('Groß'),
          note: null,
          quantity: 1,
          unitPriceCents: 1000,
          memberId: 1,
        },
        {
          dishId: 1,
          name: 'Margherita',
          options: size('Groß'),
          note: null,
          quantity: 2,
          unitPriceCents: 1000,
          memberId: 2,
        },
        {
          dishId: 1,
          name: 'Margherita',
          options: size('Klein'),
          note: null,
          quantity: 1,
          unitPriceCents: 800,
          memberId: 3,
        },
        {
          dishId: 2,
          name: 'Salami',
          options: [],
          note: 'extra scharf',
          quantity: 1,
          unitPriceCents: 900,
          memberId: 3,
        },
      ],
      (id) => names[id]!
    );
    expect(orderSheetText(lines)).toBe(
      [
        '3× Margherita (Größe: Groß) – Anna, Ben',
        '1× Margherita (Größe: Klein) – Clara',
        '1× Salami (Notiz: extra scharf) – Clara',
      ].join('\n')
    );
  });
});
