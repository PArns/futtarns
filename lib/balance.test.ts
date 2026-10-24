import { describe, expect, it } from 'vitest';
import { drinksKitty, isBilled, moneyFor } from '@/lib/balance';
import type { FridayView, Participant } from '@/lib/services/fridays';

const HOST = 1;
const PICKER = 2;
const GUEST = 3;

describe('moneyFor', () => {
  const payments = [
    { amountCents: 1500, payeeId: null },
    { amountCents: -120, payeeId: null },
  ];
  const base = { memberId: GUEST, hostId: HOST, pickerId: null };

  it('adds the drinks fee to the food and nets payments against both', () => {
    expect(moneyFor({ ...base, foodCents: 1230, drinksCents: 150, payments })).toEqual({
      foodCents: 1230,
      drinksCents: 150,
      dueCents: 1380,
      paidCents: 1380,
      openCents: 0,
      debts: [{ payeeId: HOST, what: 'all', dueCents: 1380, paidCents: 1380, openCents: 0 }],
    });
  });

  it('shows money to give back as a negative balance', () => {
    expect(moneyFor({ ...base, foodCents: 1050, drinksCents: 150, payments }).openCents).toBe(-180);
  });

  it('never asks the host to pay themselves', () => {
    expect(
      moneyFor({ ...base, memberId: HOST, foodCents: 1200, drinksCents: 150, payments: [] })
        .openCents
    ).toBe(0);
  });
});

describe('moneyFor with someone fetching the food', () => {
  const base = { hostId: HOST, pickerId: PICKER, foodCents: 1200, drinksCents: 150 };

  it('owes the food to whoever fetched it and the drinks to the host', () => {
    const money = moneyFor({
      ...base,
      memberId: GUEST,
      payments: [{ amountCents: 1200, payeeId: PICKER }],
    });
    expect(money.debts).toEqual([
      { payeeId: PICKER, what: 'food', dueCents: 1200, paidCents: 1200, openCents: 0 },
      { payeeId: HOST, what: 'drinks', dueCents: 150, paidCents: 0, openCents: 150 },
    ]);
    expect(money.openCents).toBe(150);
  });

  it('has the host pay their food to whoever fetched it, and the picker only the drinks', () => {
    expect(moneyFor({ ...base, memberId: HOST, payments: [] }).debts).toMatchObject([
      { payeeId: PICKER, openCents: 1200 },
      { payeeId: HOST, openCents: 0 },
    ]);
    expect(moneyFor({ ...base, memberId: PICKER, payments: [] }).debts).toMatchObject([
      { payeeId: PICKER, openCents: 0 },
      { payeeId: HOST, openCents: 150 },
    ]);
  });

  it('counts payments without a payee as paid to the host', () => {
    const money = moneyFor({
      ...base,
      memberId: GUEST,
      payments: [{ amountCents: 150, payeeId: null }],
    });
    expect(money.debts.map((debt) => debt.openCents)).toEqual([1200, 0]);
  });
});

describe('isBilled', () => {
  const friday = { cancelled: false, mode: 'delivery' as const, pickup: false };

  it('waits for the real total on a delivery, but not on fetched food', () => {
    expect(isBilled({ ...friday, locked: true, settled: false })).toBe(false);
    expect(isBilled({ ...friday, locked: true, settled: true })).toBe(true);
    expect(isBilled({ ...friday, pickup: true, locked: true, settled: false })).toBe(true);
    expect(isBilled({ ...friday, pickup: true, locked: false, settled: false })).toBe(false);
  });
});

describe('drinksKitty', () => {
  const person = (id: number, status: 'in' | 'nofood' | 'out', drinksOptOut = false) =>
    ({ member: { id }, attendance: { status }, drinksOptOut }) as unknown as Participant;

  it('lists who of those coming chips in and who does not, without the host', () => {
    const kitty = drinksKitty({
      host: { id: 1 } as FridayView['host'],
      participants: [person(1, 'in'), person(2, 'in'), person(3, 'nofood', true), person(4, 'out')],
    });
    expect(kitty.payers.map((entry) => entry.member.id)).toEqual([2]);
    expect(kitty.skippers.map((entry) => entry.member.id)).toEqual([3]);
  });
});
