import type { Restaurant } from '@/lib/db/schema';

export type PricedItem = { memberId: number; unitPriceCents: number; quantity: number };

export type FeeEstimate = {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  tipCents: number;
  /** A voucher redeemed with the order, at most what the order costs. */
  voucherCents: number;
  /** What everyone who eats splits equally: the fees and tip, minus the voucher. */
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

/** The tip for the driver unless the host sets another amount for a Friday. */
export const DEFAULT_TIP_CENTS = 250;

/** What Lieferando will roughly charge before the order is placed, tip and voucher included. */
export function estimateFees(
  subtotalCents: number,
  restaurant: FeeRules,
  tipCents: number = DEFAULT_TIP_CENTS,
  voucherCents = 0
): FeeEstimate {
  const freeDelivery =
    restaurant.freeDeliveryFromCents !== null && subtotalCents >= restaurant.freeDeliveryFromCents;
  const empty = subtotalCents === 0;
  const deliveryFeeCents = empty || freeDelivery ? 0 : restaurant.deliveryFeeCents;
  const serviceFeeCents = empty ? 0 : restaurant.serviceFeeCents;
  const tip = empty ? 0 : tipCents;
  const fees = deliveryFeeCents + serviceFeeCents + tip;
  const voucher = Math.min(Math.max(voucherCents, 0), subtotalCents + fees);
  const sharedCents = fees - voucher;
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    tipCents: tip,
    voucherCents: voucher,
    sharedCents,
    totalCents: subtotalCents + sharedCents,
    missingForMinimumCents: Math.max(0, restaurant.minOrderCents - subtotalCents),
  };
}

/**
 * Splits a total across everyone who ordered: each pays their own items plus an equal
 * share of everything else (delivery, service fee, tip, or a discount when the rest is
 * negative). Leftover cents go to the first members in the given order, so the shares
 * always add up to the total.
 */
export function splitTotal(items: PricedItem[], totalCents: number): MemberShare[] {
  const perMember = [...itemsPerMember(items)].filter(([, cents]) => cents > 0);
  if (perMember.length === 0) return [];
  const subtotal = perMember.reduce((sum, [, cents]) => sum + cents, 0);
  const rest = totalCents - subtotal;
  const base = Math.floor(rest / perMember.length);
  let remainder = rest - base * perMember.length;
  return perMember.map(([memberId, itemsCents]) => {
    const sharedCents = base + (remainder-- > 0 ? 1 : 0);
    return { memberId, itemsCents, sharedCents, totalCents: itemsCents + sharedCents };
  });
}

/**
 * One person's share of the fees split into what it is made of: their part of the
 * voucher (the voucher over the number of eaters), and the rest in proportion to the
 * Friday's fees. The parts add up to the share exactly; leftover cents go to the parts
 * that lost most to rounding.
 */
export function feeParts(
  sharedCents: number,
  fees: Pick<FeeEstimate, 'deliveryFeeCents' | 'serviceFeeCents' | 'tipCents' | 'voucherCents'>,
  eaters: number
): { deliveryCents: number; serviceCents: number; tipCents: number; voucherCents: number } {
  const voucherCents = eaters > 0 ? Math.round(fees.voucherCents / eaters) : 0;
  const gross = sharedCents + voucherCents;
  const weights = [fees.deliveryFeeCents, fees.serviceFeeCents, fees.tipCents];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return { deliveryCents: 0, serviceCents: 0, tipCents: gross, voucherCents };
  const exact = weights.map((weight) => (gross * weight) / total);
  const parts = exact.map(Math.floor);
  let left = gross - parts.reduce((sum, part) => sum + part, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    parts[index]!++;
    left--;
  }
  return {
    deliveryCents: parts[0]!,
    serviceCents: parts[1]!,
    tipCents: parts[2]!,
    voucherCents,
  };
}
