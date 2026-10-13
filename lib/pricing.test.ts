import { describe, expect, it } from 'vitest';
import { estimateFees, feeParts, splitTotal } from '@/lib/pricing';

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
      voucherCents: 0,
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

describe('feeParts', () => {
  const fees = { deliveryFeeCents: 300, serviceFeeCents: 99, tipCents: 250, voucherCents: 0 };

  it('splits a share in proportion to the fees and adds up exactly', () => {
    // 3,00 € delivery, 0,99 € service fee, 2,50 € tip shared by five: 1,30 € each.
    const parts = feeParts(130, fees, 5);
    expect(parts).toEqual({ deliveryCents: 60, serviceCents: 20, tipCents: 50, voucherCents: 0 });
    const odd = feeParts(131, fees, 5);
    expect(odd.deliveryCents + odd.serviceCents + odd.tipCents).toBe(131);
  });

  it('takes the voucher out as its own part, and the parts still add up', () => {
    // A 10 € voucher among five: 6,49 € fees minus 10 € is −3,51 €, about −0,70 € each.
    const parts = feeParts(-70, { ...fees, voucherCents: 1000 }, 5);
    expect(parts.voucherCents).toBe(200);
    expect(parts.deliveryCents + parts.serviceCents + parts.tipCents - parts.voucherCents).toBe(
      -70
    );
  });

  it('puts everything on the tip when there are no fees to weigh by', () => {
    expect(
      feeParts(50, { deliveryFeeCents: 0, serviceFeeCents: 0, tipCents: 0, voucherCents: 0 }, 2)
    ).toEqual({ deliveryCents: 0, serviceCents: 0, tipCents: 50, voucherCents: 0 });
  });
});

describe('a voucher', () => {
  const restaurant = {
    minOrderCents: 1500,
    deliveryFeeCents: 300,
    freeDeliveryFromCents: null,
    serviceFeeCents: 99,
  };

  it('comes off the shared part of the bill', () => {
    const estimate = estimateFees(3000, restaurant, 250, 1000);
    expect(estimate.voucherCents).toBe(1000);
    expect(estimate.sharedCents).toBe(649 - 1000);
    expect(estimate.totalCents).toBe(3000 + 649 - 1000);
    // The minimum order still counts the dishes, not what is left to pay.
    expect(estimate.missingForMinimumCents).toBe(0);
  });

  it('never makes the order cost less than nothing', () => {
    expect(estimateFees(500, restaurant, 250, 5000).totalCents).toBe(0);
  });
});

describe('fetching the food', () => {
  const restaurant = {
    minOrderCents: 1500,
    deliveryFeeCents: 300,
    freeDeliveryFromCents: null,
    serviceFeeCents: 99,
  };

  it('costs the menu prices, with no fees, tip or minimum', () => {
    expect(estimateFees(1000, restaurant, 250, 0, true)).toEqual({
      subtotalCents: 1000,
      deliveryFeeCents: 0,
      serviceFeeCents: 0,
      tipCents: 0,
      voucherCents: 0,
      sharedCents: 0,
      totalCents: 1000,
      missingForMinimumCents: 0,
    });
  });

  it('still takes a voucher off', () => {
    expect(estimateFees(1000, restaurant, 250, 300, true).totalCents).toBe(700);
  });
});
