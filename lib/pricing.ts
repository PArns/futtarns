import type { Restaurant } from '@/lib/db/schema';

export type PricedItem = { memberId: number; unitPriceCents: number; quantity: number };

export type FeeEstimate = {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  tipCents: number;
  /** True when the tip is the automatic percentage, false when the host fixed it. */
  tipIsAuto: boolean;
  sharedCents: number;
  totalCents: number;
  /** How much is missing to reach the restaurant's minimum order value, 0 if reached. */
  missingForMinimumCents: number;
};

export type MemberShare = {
  memberId: number;
  itemsCents: number;
  sharedCents: number;
  totalCents: number;
};

/** Sum of every item's price per member, in first-seen order. */
export function itemsPerMember(items: PricedItem[]): Map<number, number> {
  const sums = new Map<number, number>();
  for (const item of items) {
    sums.set(item.memberId, (sums.get(item.memberId) ?? 0) + item.unitPriceCents * item.quantity);
  }
  return sums;
}

type FeeRules = Pick<
  Restaurant,
  'minOrderCents' | 'deliveryFeeCents' | 'freeDeliveryFromCents' | 'serviceFeeCents'
>;

export const AUTO_TIP_PERCENT = 10;

/** The automatic tip: a tenth of the dishes, rounded to 50 cents. */
export function autoTipCents(subtotalCents: number): number {
  return Math.round((subtotalCents * AUTO_TIP_PERCENT) / 100 / 50) * 50;
}

/** What Lieferando will roughly charge before the order is placed, tip included. */
export function estimateFees(
  subtotalCents: number,
  restaurant: FeeRules,
  fixedTipCents: number | null = null
): FeeEstimate {
  const freeDelivery =
    restaurant.freeDeliveryFromCents !== null && subtotalCents >= restaurant.freeDeliveryFromCents;
  const empty = subtotalCents === 0;
  const deliveryFeeCents = empty || freeDelivery ? 0 : restaurant.deliveryFeeCents;
  const serviceFeeCents = empty ? 0 : restaurant.serviceFeeCents;
  const tipCents = empty ? 0 : (fixedTipCents ?? autoTipCents(subtotalCents));
  const sharedCents = deliveryFeeCents + serviceFeeCents + tipCents;
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    tipCents,
    tipIsAuto: fixedTipCents === null,
    sharedCents,
    totalCents: subtotalCents + sharedCents,
    missingForMinimumCents: Math.max(0, restaurant.minOrderCents - subtotalCents),
  };
}

/** Spreads `amount` over weights so the parts add up exactly (largest remainder first). */
function proportional(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0 || amount === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (amount * weight) / total);
  const parts = exact.map(Math.floor);
  let left = amount - parts.reduce((sum, part) => sum + part, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left-- <= 0) break;
    parts[index]! += 1;
  }
  return parts;
}

/**
 * Splits a total across everyone who ordered: each pays their own items, the tip in
 * proportion to what they ordered, and an equal share of the rest (delivery, service fee,
 * or a discount when the rest is negative). The shares always add up to the total.
 */
export function splitTotal(items: PricedItem[], totalCents: number, tipCents = 0): MemberShare[] {
  const perMember = [...itemsPerMember(items)].filter(([, cents]) => cents > 0);
  if (perMember.length === 0) return [];
  const subtotal = perMember.reduce((sum, [, cents]) => sum + cents, 0);
  const tips = proportional(
    tipCents,
    perMember.map(([, cents]) => cents)
  );
  const rest = totalCents - subtotal - tipCents;
  const base = Math.floor(rest / perMember.length);
  let remainder = rest - base * perMember.length;
  return perMember.map(([memberId, itemsCents], index) => {
    const sharedCents = tips[index]! + base + (remainder-- > 0 ? 1 : 0);
    return { memberId, itemsCents, sharedCents, totalCents: itemsCents + sharedCents };
  });
}
