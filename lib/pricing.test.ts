import { describe, expect, it } from 'vitest';
import { estimateFees, splitTotal } from '@/lib/pricing';

const restaurant = {
  minOrderCents: 2000,
  deliveryFeeCents: 299,
  freeDeliveryFromCents: 5000,
  serviceFeeCents: 99,
};

describe('estimateFees', () => {
  it('adds delivery, service fee and the 2,50 € tip below the free-delivery threshold', () => {
    expect(estimateFees(1500, restaurant)).toEqual({
      subtotalCents: 1500,
      deliveryFeeCents: 299,
      serviceFeeCents: 99,
      tipCents: 250,
      sharedCents: 648,
      totalCents: 2148,
      missingForMinimumCents: 500,
    });
  });

  it('takes the tip the host set', () => {
    expect(estimateFees(1500, restaurant, 350)).toMatchObject({ tipCents: 350, totalCents: 2248 });
  });

  it('drops the delivery fee from the threshold on', () => {
    expect(estimateFees(5000, restaurant)).toMatchObject({ deliveryFeeCents: 0, totalCents: 5349 });
  });

  it('charges nothing for an empty order', () => {
    expect(estimateFees(0, restaurant).totalCents).toBe(0);
  });
});

describe('splitTotal', () => {
  const items = [
    { memberId: 1, unitPriceCents: 850, quantity: 1 },
    { memberId: 2, unitPriceCents: 1000, quantity: 1 },
    { memberId: 3, unitPriceCents: 450, quantity: 2 },
    { memberId: 1, unitPriceCents: 250, quantity: 1 },
  ];

  it('gives everyone their items plus an equal share of the rest', () => {
    const shares = splitTotal(items, 3000 + 400);
    expect(shares).toEqual([
      { memberId: 1, itemsCents: 1100, sharedCents: 134, totalCents: 1234 },
      { memberId: 2, itemsCents: 1000, sharedCents: 133, totalCents: 1133 },
      { memberId: 3, itemsCents: 900, sharedCents: 133, totalCents: 1033 },
    ]);
  });

  it('always adds up to the total, also with a discount', () => {
    for (const total of [3000, 3001, 3002, 2500, 2999, 4567]) {
      const shares = splitTotal(items, total);
      expect(shares.reduce((sum, share) => sum + share.totalCents, 0)).toBe(total);
    }
  });

  it('spreads a discount evenly', () => {
    const shares = splitTotal(items, 2700);
    expect(shares.map((share) => share.sharedCents)).toEqual([-100, -100, -100]);
  });

  it('splits the tip equally like every other fee', () => {
    const shares = splitTotal(items, 3000 + 300 + 300);
    expect(shares.map((share) => share.sharedCents)).toEqual([200, 200, 200]);
  });

  it('leaves out people who ordered nothing', () => {
    expect(splitTotal([{ memberId: 9, unitPriceCents: 0, quantity: 1 }], 0)).toEqual([]);
  });
});
