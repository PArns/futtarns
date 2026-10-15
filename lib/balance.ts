import { formatEuro } from '@/lib/format';
import { feeParts, type FeeEstimate } from '@/lib/pricing';
import type { FridayView, Participant } from '@/lib/services/fridays';

/** What each person pays into the drinks the host buys for everyone, unless they opt out. */
export const DRINKS_FEE_CENTS = 150;

/**
 * What one person owes one payee. When someone other than the host fetches the food, the
 * food money goes to them and the drinks money still to the host; otherwise it is all one.
 */
export type Debt = {
  payeeId: number | null;
  what: 'all' | 'food' | 'drinks';
  dueCents: number;
  paidCents: number;
  /** Still to pay when positive, to get back when negative. */
  openCents: number;
};

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
  /** The same per payee: one, or two when someone other than the host fetches the food. */
  debts: Debt[];
};

/**
 * Whoever paid for something is the one being paid for it, so owes nothing for it: the
 * host for the drinks, and for the food the host or whoever fetched it.
 */
export function moneyFor(input: {
  memberId: number;
  hostId: number | null;
  /** Who fetches the food when it is not the host; they get the food money. */
  pickerId: number | null;
  foodCents: number;
  drinksCents: number;
  /** `payeeId` null means the host. */
  payments: { amountCents: number; payeeId: number | null }[];
}): Money {
  const { memberId, hostId } = input;
  const foodPayee = input.pickerId ?? hostId;
  const foodCents = memberId === foodPayee ? 0 : input.foodCents;
  const drinksCents = memberId === hostId ? 0 : input.drinksCents;
  const debt = (what: Debt['what'], payeeId: number | null, dueCents: number): Debt => {
    const paidCents = input.payments
      .filter((payment) => (payment.payeeId ?? hostId) === payeeId)
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    return { payeeId, what, dueCents, paidCents, openCents: dueCents - paidCents };
  };
  const debts =
    foodPayee === hostId
      ? [debt('all', hostId, foodCents + drinksCents)]
      : [debt('food', foodPayee, foodCents), debt('drinks', hostId, drinksCents)];
  const dueCents = foodCents + drinksCents;
  const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return { foodCents, drinksCents, dueCents, paidCents, openCents: dueCents - paidCents, debts };
}

/** The people a Friday's money goes to: the host, and whoever fetches the food. */
export function payeeOf<T extends { id: number }>(
  view: { host: T | null; picker: T | null },
  debt: Pick<Debt, 'payeeId'>
): T | null {
  return [view.picker, view.host].find((person) => person && person.id === debt.payeeId) ?? null;
}

/** Someone to pay, and how much of what. */
export type Payee = {
  name: string;
  paypalMe: string | null;
  cents: number;
  what: Debt['what'];
};

type Payable = { id: number; name: string; paypalMe: string | null };

/** One debt as someone to pay. */
export function toPayee(payee: Payable | null, debt: Debt): Payee {
  return {
    name: payee?.name ?? 'Gastgeber',
    paypalMe: payee?.paypalMe ?? null,
    cents: debt.openCents,
    what: debt.what,
  };
}

/** Whom someone still has to pay for a Friday, one entry per payee. */
export function payeesFor(
  view: { host: Payable | null; picker: Payable | null },
  money: Money
): Payee[] {
  return money.debts
    .filter((debt) => debt.openCents > 0)
    .map((debt) => toPayee(payeeOf(view, debt), debt));
}

/** `fürs Essen`, `für die Getränke`, or nothing when it is all one. */
export function payeePurpose(what: Debt['what']): string {
  return what === 'food' ? 'fürs Essen' : what === 'drinks' ? 'für die Getränke' : '';
}

/** What `payeeId` still has to collect from the others for a Friday, and whether anyone owes them anything at all. */
export function collecting(
  view: Pick<FridayView, 'participants'>,
  payeeId: number
): { openCents: number; anyDue: boolean } {
  const debts = view.participants.flatMap((entry) =>
    entry.money.debts.filter((debt) => debt.payeeId === payeeId)
  );
  return {
    openCents: debts.reduce((sum, debt) => sum + Math.max(debt.openCents, 0), 0),
    anyDue: debts.some((debt) => debt.dueCents > 0),
  };
}

/**
 * Whether a Friday's amounts are final enough to chase: a delivery once the real total is
 * entered, fetched food and a flat price from the deadline on (they cost what they say),
 * a cancelled Friday whenever someone paid in advance.
 */
export function isBilled(
  view: Pick<FridayView, 'cancelled' | 'mode' | 'pickup' | 'locked' | 'settled'>
): boolean {
  if (view.cancelled) return true;
  return view.mode === 'flat' || view.pickup ? view.locked : view.settled;
}

export type MoneyLine = { label: string; cents: number };

/** Some of a person's debts for a Friday as lines, when nothing more is known than the totals. */
export function debtLines(money: Money, debts: Debt[]): MoneyLine[] {
  const covers = (what: Debt['what']) => debts.some((debt) => debt.what === what);
  return [
    {
      label: 'Essen mit Gebühren und Trinkgeld',
      cents: covers('all') || covers('food') ? money.foodCents : 0,
    },
    { label: 'Getränke', cents: covers('all') || covers('drinks') ? money.drinksCents : 0 },
    { label: 'Schon bezahlt', cents: -debts.reduce((sum, debt) => sum + debt.paidCents, 0) },
  ].filter((line) => line.cents !== 0);
}

/**
 * What someone's food costs: each dish, their part of the delivery fee, Lieferando's
 * service fee and the tip. For the host or whoever fetches the food, who pay the
 * restaurant directly, it is their own share of the order.
 */
export function foodLines(view: FridayView, entry: Participant): MoneyLine[] {
  const lines: MoneyLine[] = [];
  if (!entry.share) return lines;
  if (view.mode === 'flat') {
    lines.push({ label: view.flatTitle ?? 'Pauschale', cents: entry.share.totalCents });
    return lines;
  }
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
    const what = view.pickup
      ? 'Unterschied zum Kassenbon'
      : view.voucherCents
        ? 'Gebühren, Trinkgeld und Gutschein'
        : 'Gebühren und Trinkgeld';
    lines.push({ label: `Anteil ${what} ${of(shared)}`, cents: entry.share.sharedCents });
  } else {
    lines.push(...feeLines(entry.share.sharedCents, view.estimate, eaters));
  }
  return lines.filter((line) => line.cents !== 0);
}

/**
 * One person's share of the estimated fees, a line per fee that says what it is a share
 * of and how many split it: `Anteil Trinkgeld (2,50 € ÷ 4)`.
 */
export function feeLines(sharedCents: number, fees: FeeEstimate, eaters: number): MoneyLine[] {
  const of = (cents: number) => `(${formatEuro(cents)} ÷ ${eaters})`;
  const parts = feeParts(sharedCents, fees, eaters);
  return [
    { label: `Anteil Liefergebühr ${of(fees.deliveryFeeCents)}`, cents: parts.deliveryCents },
    {
      label: `Anteil Servicegebühr Lieferando ${of(fees.serviceFeeCents)}`,
      cents: parts.serviceCents,
    },
    { label: `Anteil Trinkgeld ${of(fees.tipCents)}`, cents: parts.tipCents },
    { label: `Anteil Gutschein ${of(-fees.voucherCents)}`, cents: -parts.voucherCents },
  ].filter((line) => line.cents !== 0);
}

/** Why someone pays what they pay: their food unless they paid it themselves, the drinks, what they paid already. */
export function shareLines(view: FridayView, entry: Participant): MoneyLine[] {
  return [
    ...(entry.money.foodCents !== 0 ? foodLines(view, entry) : []),
    { label: 'Getränke', cents: entry.money.drinksCents },
    { label: 'Schon bezahlt', cents: -entry.money.paidCents },
  ].filter((line) => line.cents !== 0);
}
