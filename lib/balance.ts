import type { PaymentPurpose } from '@/lib/db/schema';

export type Money = {
  /** What this person owes for food: their final share, or the current estimate. */
  dueCents: number;
  /** Food payments so far, net of anything paid back. */
  paidCents: number;
  /** Still to pay when positive, to get back when negative. */
  openCents: number;
  /** Donated to the drinks; never counted against the food. */
  drinksCents: number;
};

/** The host paid the restaurant and is the one being paid, so they owe nothing. */
export function moneyFor(input: {
  isHost: boolean;
  dueCents: number;
  payments: { amountCents: number; purpose: PaymentPurpose }[];
}): Money {
  const dueCents = input.isHost ? 0 : input.dueCents;
  const paidCents = input.payments
    .filter((payment) => payment.purpose === 'food')
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const drinksCents = input.payments
    .filter((payment) => payment.purpose === 'drinks')
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  return { dueCents, paidCents, openCents: dueCents - paidCents, drinksCents };
}

/** Suggested drink donations in cents, offered next to every payment. */
export const DRINK_SUGGESTIONS = [100, 200, 300, 500];
