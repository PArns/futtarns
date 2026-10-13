import { formatEuro } from '@/lib/format';
import { feeParts } from '@/lib/pricing';
import type { FridayView, Participant } from '@/lib/services/fridays';

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

export type MoneyLine = { label: string; cents: number };

/** A balance as lines when nothing more is known than its totals. */
export function moneyLines(money: Money): MoneyLine[] {
  return [
    { label: 'Essen mit Gebühren und Trinkgeld', cents: money.foodCents },
    { label: 'Getränke', cents: money.drinksCents },
    { label: 'Schon bezahlt', cents: -money.paidCents },
  ].filter((line) => line.cents !== 0);
}

/**
 * Why someone pays what they pay: each dish, their part of the delivery fee, Lieferando's
 * service fee and the tip, the drinks, and what they paid already. For the host, who pays
 * Lieferando directly, it is their own share of the order.
 */
export function shareLines(view: FridayView, entry: Participant): MoneyLine[] {
  const isHost = entry.member.id === view.host?.id;
  const lines: MoneyLine[] = [];
  if (view.mode === 'flat') {
    if (entry.share)
      lines.push({ label: view.flatTitle ?? 'Pauschale', cents: entry.share.totalCents });
  } else if (entry.share) {
    if (entry.items.length > 0) {
      for (const item of entry.items) {
        lines.push({
          label: `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}`,
          cents: item.unitPriceCents * item.quantity,
        });
      }
    } else {
      lines.push({
        label: `${entry.projectedDefault?.name ?? 'Essen'} (Standard)`,
        cents: entry.share.itemsCents,
      });
    }
    // Each share says what it is a share of: the fee and how many people split it.
    const eaters = view.shares.length;
    const of = (cents: number) => `(${formatEuro(cents)} ÷ ${eaters})`;
    if (view.settled || !view.estimate) {
      const shared = view.shares.reduce((sum, share) => sum + share.sharedCents, 0);
      lines.push({
        label: `Anteil ${view.voucherCents ? 'Gebühren, Trinkgeld und Gutschein' : 'Gebühren und Trinkgeld'} ${of(shared)}`,
        cents: entry.share.sharedCents,
      });
    } else {
      const fees = view.estimate;
      const parts = feeParts(entry.share.sharedCents, fees, eaters);
      lines.push(
        {
          label: `Anteil Liefergebühr ${of(fees.deliveryFeeCents)}`,
          cents: parts.deliveryCents,
        },
        {
          label: `Anteil Servicegebühr Lieferando ${of(fees.serviceFeeCents)}`,
          cents: parts.serviceCents,
        },
        { label: `Anteil Trinkgeld ${of(fees.tipCents)}`, cents: parts.tipCents },
        { label: `Anteil Gutschein ${of(-fees.voucherCents)}`, cents: -parts.voucherCents }
      );
    }
  }
  if (!isHost) {
    lines.push(
      { label: 'Getränke', cents: entry.money.drinksCents },
      { label: 'Schon bezahlt', cents: -entry.money.paidCents }
    );
  }
  return lines.filter((line) => line.cents !== 0);
}
