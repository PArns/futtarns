import { describe, expect, it } from 'vitest';
import { moneyFor } from '@/lib/balance';

describe('moneyFor', () => {
  const payments = [{ amountCents: 1500 }, { amountCents: -120 }];

  it('adds the drinks fee to the food and nets payments against both', () => {
    expect(moneyFor({ isHost: false, foodCents: 1230, drinksCents: 150, payments })).toEqual({
      foodCents: 1230,
      drinksCents: 150,
      dueCents: 1380,
      paidCents: 1380,
      openCents: 0,
    });
  });

  it('shows money to give back as a negative balance', () => {
    expect(moneyFor({ isHost: false, foodCents: 1050, drinksCents: 150, payments }).openCents).toBe(
      -180
    );
  });

  it('never asks the host to pay themselves', () => {
    expect(
      moneyFor({ isHost: true, foodCents: 1200, drinksCents: 150, payments: [] }).openCents
    ).toBe(0);
  });
});
