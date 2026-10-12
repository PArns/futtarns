/** What each person pays into the drinks the host buys for everyone, unless they opt out. */
export const DRINKS_FEE_CENTS = 150;

export type Money = {
  /** Their dishes and share of the fees: the final share, or the current estimate. */
  foodCents: number;
  /** The drinks flat fee, 0 for whoever opted out. */
  drinksCents: number;
  dueCents: number;
  /** Payments so far, net of anything paid back. */
  paidCents: number;
  /** Still to pay when positive, to get back when negative. */
  openCents: number;
};

/** The host paid the restaurant and the drinks and is the one being paid, so owes nothing. */
export function moneyFor(input: {
  isHost: boolean;
  foodCents: number;
  drinksCents: number;
  payments: { amountCents: number }[];
}): Money {
  const foodCents = input.isHost ? 0 : input.foodCents;
  const drinksCents = input.isHost ? 0 : input.drinksCents;
  const dueCents = foodCents + drinksCents;
  const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return { foodCents, drinksCents, dueCents, paidCents, openCents: dueCents - paidCents };
}
