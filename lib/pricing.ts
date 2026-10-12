import type { Restaurant } from '@/lib/db/schema';

export type PricedItem = { memberId: number; unitPriceCents: number; quantity: number };

export type FeeEstimate = {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
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

/** What Lieferando will roughly charge before the order is placed. */
export function estimateFees(subtotalCents: number, restaurant: FeeRules): FeeEstimate {
  const freeDelivery =
    restaurant.freeDeliveryFromCents !== null && subtotalCents >= restaurant.freeDeliveryFromCents;
  const deliveryFeeCents = subtotalCents === 0 || freeDelivery ? 0 : restaurant.deliveryFeeCents;
  const serviceFeeCents = subtotalCents === 0 ? 0 : restaurant.serviceFeeCents;
  const sharedCents = deliveryFeeCents + serviceFeeCents;
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    sharedCents,
    totalCents: subtotalCents + sharedCents,
    missingForMinimumCents: Math.max(0, restaurant.minOrderCents - subtotalCents),
  };
}

/**
 * Splits a total across everyone who ordered: each pays their own items plus an equal
 * share of the rest (fees, tip, or a discount when the rest is negative). Leftover cents
 * go to the first members in the given order, so the shares always add up to the total.
 */
export function splitTotal(items: PricedItem[], totalCents: number): MemberShare[] {
  const perMember = [...itemsPerMember(items)].filter(([, cents]) => cents > 0);
  if (perMember.length === 0) return [];
  const subtotal = perMember.reduce((sum, [, cents]) => sum + cents, 0);
  const shared = totalCents - subtotal;
  const base = Math.floor(shared / perMember.length);
  let remainder = shared - base * perMember.length;
  return perMember.map(([memberId, itemsCents]) => {
    const sharedCents = base + (remainder-- > 0 ? 1 : 0);
    return { memberId, itemsCents, sharedCents, totalCents: itemsCents + sharedCents };
  });
}
