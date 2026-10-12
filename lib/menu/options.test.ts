import { describe, expect, it } from 'vitest';
import {
  formatOptionGroups,
  parseEuroToCents,
  parseOptionGroups,
  resolveSelection,
  unitPriceCents,
} from '@/lib/menu/options';

describe('parseEuroToCents', () => {
  it.each([
    ['2,50', 250],
    ['2.5', 250],
    ['+1', 100],
    ['-0,30', -30],
    ['12 €', 1200],
    ['0', 0],
  ])('reads %s', (input, cents) => expect(parseEuroToCents(input)).toBe(cents));

  it.each(['', 'abc', '1,234', '1.2.3', '99999999999'])('rejects %s', (input) =>
    expect(parseEuroToCents(input)).toBeNull()
  );
});

describe('parseOptionGroups', () => {
  it('reads groups with counts and prices', () => {
    const { groups, errors } = parseOptionGroups(
      'Größe (1): Klein | Groß +2,50\nExtras (0-2): Käse +1 | Salami +1,50 | Zwiebeln'
    );
    expect(errors).toEqual([]);
    expect(groups).toEqual([
      {
        id: 'grosse',
        name: 'Größe',
        min: 1,
        max: 1,
        choices: [
          { id: 'klein', name: 'Klein', priceCents: 0 },
          { id: 'gross', name: 'Groß', priceCents: 250 },
        ],
      },
      {
        id: 'extras',
        name: 'Extras',
        min: 0,
        max: 2,
        choices: [
          { id: 'kase', name: 'Käse', priceCents: 100 },
          { id: 'salami', name: 'Salami', priceCents: 150 },
          { id: 'zwiebeln', name: 'Zwiebeln', priceCents: 0 },
        ],
      },
    ]);
  });

  it('allows any number of choices without a count', () => {
    const { groups } = parseOptionGroups('Soßen: Knoblauch | Cocktail');
    expect(groups[0]).toMatchObject({ min: 0, max: 2 });
  });

  it('keeps ids unique when names repeat', () => {
    const { groups } = parseOptionGroups('Extras: Käse | Käse +1');
    expect(groups[0]!.choices.map((choice) => choice.id)).toEqual(['kase', 'kase-2']);
  });

  it('reports lines it cannot read', () => {
    const { groups, errors } = parseOptionGroups('Nur ein Name\nGröße (2-1): A | B');
    expect(groups).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it('round-trips through formatOptionGroups', () => {
    const text =
      'Größe (1): Klein | Groß +2,50\nExtras (0-2): Käse +1,00 | Salami +1,50 | Zwiebeln\nSoßen: A | B';
    const { groups } = parseOptionGroups(text);
    expect(parseOptionGroups(formatOptionGroups(groups)).groups).toEqual(groups);
  });
});

describe('resolveSelection', () => {
  const { groups } = parseOptionGroups(
    'Größe (1): Klein | Groß +2,50\nExtras (0-2): Käse +1 | Salami +1,50'
  );

  it('returns the snapshot of the picked choices', () => {
    const result = resolveSelection(groups, { grosse: ['gross'], extras: ['kase', 'salami'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(unitPriceCents(800, result.options)).toBe(800 + 250 + 100 + 150);
  });

  it('enforces the minimum', () => {
    expect(resolveSelection(groups, {})).toEqual({
      ok: false,
      error: 'Bei „Größe“ bitte 1 auswählen',
    });
  });

  it('enforces the maximum', () => {
    const result = resolveSelection(groups, { grosse: ['klein', 'gross'] });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown choices and groups', () => {
    expect(resolveSelection(groups, { grosse: ['riesig'] }).ok).toBe(false);
    expect(resolveSelection(groups, { grosse: ['klein'], dips: ['x'] }).ok).toBe(false);
  });
});
