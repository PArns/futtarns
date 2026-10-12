import { describe, expect, it } from 'vitest';
import { moneyFor } from '@/lib/balance';

describe('moneyFor', () => {
  const payments = [
    { amountCents: 1500, purpose: 'food' as const },
    { amountCents: 200, purpose: 'drinks' as const },
    { amountCents: -120, purpose: 'food' as const },
  ];

  it('keeps drink donations apart from the food balance', () => {
    expect(moneyFor({ isHost: false, dueCents: 1380, payments })).toEqual({
      dueCents: 1380,
      paidCents: 1380,
      openCents: 0,
      drinksCents: 200,
    });
  });

  it('shows money to give back as a negative balance', () => {
    expect(moneyFor({ isHost: false, dueCents: 1200, payments }).openCents).toBe(-180);
  });

  it('never asks the host to pay themselves', () => {
    expect(moneyFor({ isHost: true, dueCents: 1200, payments: [] }).openCents).toBe(0);
  });
});
