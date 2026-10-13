import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  effectiveAttendance,
  type AttendancePerson,
  type EffectiveAttendance,
} from '@/lib/attendance';
import {
  DRINKS_FEE_CENTS,
  isBilled,
  moneyFor,
  payeeOf,
  type Debt,
  type Money,
} from '@/lib/balance';
import {
  addWeeks,
  currentFriday,
  daysBetween,
  fridaysFrom,
  isPastDeadline,
  isWithin,
  orderDeadline,
  orderTime,
  type IsoDate,
} from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import {
  attendance,
  charges,
  dishes,
  drinksOptOuts,
  fridays,
  memberDefaults,
  members,
  orderItems,
  payments,
  restaurantVotes,
  restaurants,
  type AttendanceStatus,
  type Dish,
  type Friday,
  type FridayMode,
  type Member,
  type OrderItem,
  type Restaurant,
} from '@/lib/db/schema';
import { unitPriceCents } from '@/lib/menu/options';
import {
  DEFAULT_TIP_CENTS,
  estimateFees,
  splitTotal,
  type FeeEstimate,
  type MemberShare,
} from '@/lib/pricing';
import { absencesOverlapping, getDefaultHost, ServiceError } from '@/lib/services/members';
import { hostRestaurant, restaurantHostIds, restaurantsForHost } from '@/lib/services/restaurants';
import { voteClosesAt, voteWinner, votingAt, type Vote } from '@/lib/vote';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function ensureFridayRow(db: Db, date: IsoDate) {
  await db.insert(fridays).values({ date }).onConflictDoNothing();
}

export async function getFridayRow(db: Db, date: IsoDate): Promise<Friday | null> {
  const [row] = await db.select().from(fridays).where(eq(fridays.date, date));
  return row ?? null;
}

/** The host of a Friday: the one entered for it, otherwise the default host. */
export async function hostIdFor(db: Db, date: IsoDate): Promise<number | null> {
  const row = await getFridayRow(db, date);
  if (row?.hostId) return row.hostId;
  return (await getDefaultHost(db))?.id ?? null;
}

async function touch(db: Db, date: IsoDate, values: Partial<Friday>) {
  await ensureFridayRow(db, date);
  await db
    .update(fridays)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(fridays.date, date));
}

export async function setHost(db: Db, date: IsoDate, hostId: number | null) {
  await touch(db, date, { hostId });
}

export async function setCancelled(
  db: Db,
  date: IsoDate,
  cancelled: boolean,
  reason: string | null
) {
  await touch(db, date, { cancelled, cancelReason: cancelled ? reason : null });
}

export async function setFridayNote(db: Db, date: IsoDate, note: string | null) {
  await touch(db, date, { note });
}

async function requireOpen(tx: Tx, date: IsoDate) {
  await ensureFridayRow(tx, date);
  const [row] = await tx.select().from(fridays).where(eq(fridays.date, date));
  if (row!.lockedAt) throw new ServiceError('Die Bestellung ist schon geschlossen');
  return row!;
}

/**
 * Picks the restaurant. Switching drops the orders placed so far. After the deadline the
 * host may still switch (the first choice turned out to be closed); everyone who counts
 * as coming then gets their default from the new restaurant. A host's pick (`chosen`)
 * ends the vote. A restaurant that does not deliver to the host but offers pickup turns
 * the Friday into one where someone fetches the food.
 */
export async function setRestaurant(
  db: Db,
  date: IsoDate,
  restaurantId: number | null,
  { chosen = true } = {}
) {
  await db.transaction(async (tx) => {
    await ensureFridayRow(tx, date);
    const [row] = await tx.select().from(fridays).where(eq(fridays.date, date));
    if (row!.settledAt) throw new ServiceError('Schon abgerechnet – erst die Abrechnung öffnen');
    const restaurantChosen = row!.restaurantChosen || chosen;
    if (row!.mode === 'delivery' && row!.restaurantId === restaurantId) {
      if (restaurantChosen !== row!.restaurantChosen) {
        await tx.update(fridays).set({ restaurantChosen }).where(eq(fridays.date, date));
      }
      return;
    }
    const [restaurant] = restaurantId
      ? await tx.select().from(restaurants).where(eq(restaurants.id, restaurantId))
      : [];
    const hostId = row!.hostId ?? (await getDefaultHost(tx))?.id ?? null;
    const area = restaurant ? await restaurantHostIds(tx, restaurant.id) : [];
    const delivers = area.length === 0 || (hostId !== null && area.includes(hostId));
    await tx.delete(orderItems).where(eq(orderItems.fridayDate, date));
    await tx
      .update(fridays)
      .set({
        mode: 'delivery',
        restaurantId,
        restaurantChosen,
        ...(restaurant && !delivers && restaurant.pickup ? { pickup: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(fridays.date, date));
    if (row!.lockedAt && restaurantId) await applyDefaults(tx, date, restaurantId);
  });
}

/**
 * Counts the restaurant vote once Thursday is over: the most votes win, no votes or a tie
 * leave the restaurant as it is. Runs once per Friday, from a page view or the timer.
 */
export async function closeVote(db: Db, date: IsoDate, now: Date): Promise<boolean> {
  if (now < voteClosesAt(date)) return false;
  const row = await getFridayRow(db, date);
  if (!row || row.voteClosedAt) return false;
  const [claimed] = await db
    .update(fridays)
    .set({ voteClosedAt: now })
    .where(and(eq(fridays.date, date), isNull(fridays.voteClosedAt)))
    .returning();
  if (!claimed || claimed.mode !== 'delivery' || claimed.cancelled || claimed.restaurantChosen) {
    return false;
  }
  if (claimed.lockedAt || claimed.settledAt) return false;
  const hostId = claimed.hostId ?? (await getDefaultHost(db))?.id ?? null;
  const options = await restaurantsForHost(db, hostId);
  const votes = (
    await db.select().from(restaurantVotes).where(eq(restaurantVotes.fridayDate, date))
  ).filter((vote) => options.some((option) => option.id === vote.restaurantId));
  const currentId = claimed.restaurantId ?? (await hostRestaurant(db, hostId))?.id ?? null;
  const winner = voteWinner(votes, currentId);
  if (winner === null || winner === currentId) return false;
  // Orders placed during the vote were for the old restaurant; their owners hear about it.
  const dropped = await db
    .selectDistinct({ memberId: orderItems.memberId })
    .from(orderItems)
    .where(eq(orderItems.fridayDate, date));
  await setRestaurant(db, date, winner, { chosen: false });
  await db
    .update(fridays)
    .set({ voteDroppedIds: dropped.map((entry) => entry.memberId) })
    .where(eq(fridays.date, date));
  return true;
}

/**
 * One member's vote for a Friday's restaurant, or null to take it back. Only while the
 * vote is open and only for a restaurant that can serve this Friday's host.
 */
export async function castVote(
  db: Db,
  date: IsoDate,
  memberId: number,
  restaurantId: number | null,
  now: Date
) {
  const row = await getFridayRow(db, date);
  const friday = {
    date,
    mode: row?.mode ?? 'delivery',
    cancelled: row?.cancelled ?? false,
    restaurantChosen: row?.restaurantChosen ?? false,
    voteClosed: Boolean(row?.voteClosedAt),
  };
  if (!votingAt(friday, now)) {
    throw new ServiceError('Die Restaurantwahl für diesen Freitag ist vorbei');
  }
  // Outside the Stammtruppe, only those invited to this Friday have a say in it.
  const [voter] = await db.select().from(members).where(eq(members.id, memberId));
  if (!voter || voter.kind !== 'member' || !voter.active) {
    throw new ServiceError('Abstimmen kann nur, wer dabei ist');
  }
  if (!voter.core) {
    const [invited] = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.fridayDate, date), eq(attendance.memberId, memberId)));
    if (!invited)
      throw new ServiceError('Abstimmen kannst du an Freitagen, zu denen du eingeladen bist');
  }
  const where = and(eq(restaurantVotes.fridayDate, date), eq(restaurantVotes.memberId, memberId));
  // The count looks for the Friday's row, so a vote makes sure there is one.
  await ensureFridayRow(db, date);
  if (restaurantId === null) {
    await db.delete(restaurantVotes).where(where);
    return;
  }
  const options = await restaurantsForHost(db, await hostIdFor(db, date));
  if (!options.some((option) => option.id === restaurantId)) {
    throw new ServiceError('Das Restaurant steht nicht zur Wahl');
  }
  await db
    .insert(restaurantVotes)
    .values({ fridayDate: date, memberId, restaurantId })
    .onConflictDoUpdate({
      target: [restaurantVotes.fridayDate, restaurantVotes.memberId],
      set: { restaurantId, createdAt: now },
    });
}

/** Turns a Friday into one with a single price for everyone, e.g. a barbecue. */
export async function setFlat(db: Db, date: IsoDate, title: string, priceCents: number) {
  if (priceCents <= 0) throw new ServiceError('Bitte einen Betrag angeben');
  await db.transaction(async (tx) => {
    const row = await requireOpen(tx, date);
    if (row.mode !== 'flat') await tx.delete(orderItems).where(eq(orderItems.fridayDate, date));
    await tx
      .update(fridays)
      .set({
        mode: 'flat' satisfies FridayMode,
        flatTitle: title,
        flatPriceCents: priceCents,
        restaurantId: null,
        updatedAt: new Date(),
      })
      .where(eq(fridays.date, date));
  });
}

/** Records an answer. Anything but a plain yes takes back what that person had ordered. */
export async function setAttendance(
  db: Db,
  date: IsoDate,
  memberId: number,
  status: AttendanceStatus,
  now: Date = new Date()
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(attendance)
      .values({ fridayDate: date, memberId, status, updatedAt: now })
      .onConflictDoUpdate({
        target: [attendance.fridayDate, attendance.memberId],
        set: { status, updatedAt: now },
      });
    if (status !== 'in') {
      await tx
        .delete(orderItems)
        .where(and(eq(orderItems.fridayDate, date), eq(orderItems.memberId, memberId)));
    }
  });
}

/**
 * Closes ordering for a Friday once its deadline has passed: everyone who counts as
 * coming but picked nothing gets their default dish for the chosen restaurant. Runs at
 * most once per Friday, whoever triggers it first (a page view or the timer).
 */
export async function lockFriday(db: Db, date: IsoDate, now: Date): Promise<boolean> {
  if (!isPastDeadline(date, now)) return false;
  return db.transaction(async (tx) => {
    await ensureFridayRow(tx, date);
    // The host is written down at the lock, so payments keep going to whoever hosted even
    // if the default host changes later. The same goes for the host's usual restaurant
    // when nobody picked one.
    const [current] = await tx
      .select({ hostId: fridays.hostId })
      .from(fridays)
      .where(eq(fridays.date, date));
    const hostId = current?.hostId ?? (await getDefaultHost(tx))?.id ?? null;
    const restaurantId = (await hostRestaurant(tx, hostId))?.id ?? null;
    const [row] = await tx
      .update(fridays)
      .set({
        lockedAt: now,
        updatedAt: now,
        hostId: sql`coalesce(${fridays.hostId}, ${hostId})`,
        restaurantId: sql`case when ${fridays.mode} = 'delivery' then coalesce(${fridays.restaurantId}, ${restaurantId}) else ${fridays.restaurantId} end`,
      })
      .where(and(eq(fridays.date, date), isNull(fridays.lockedAt), eq(fridays.cancelled, false)))
      .returning();
    if (!row) return false;
    if (row.mode === 'delivery' && row.restaurantId) {
      await applyDefaults(tx, date, row.restaurantId);
    }
    return true;
  });
}

async function applyDefaults(tx: Tx, date: IsoDate, restaurantId: number) {
  const everyone = await tx
    .select()
    .from(members)
    .where(and(eq(members.kind, 'member'), eq(members.active, true)));
  const answers = await tx.select().from(attendance).where(eq(attendance.fridayDate, date));
  const absent = await absencesOverlapping(tx, date, date);
  const ordered = new Set(
    (
      await tx
        .select({ memberId: orderItems.memberId })
        .from(orderItems)
        .where(eq(orderItems.fridayDate, date))
    ).map((item) => item.memberId)
  );
  const defaults = await tx
    .select({ entry: memberDefaults, dish: dishes })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(and(eq(memberDefaults.restaurantId, restaurantId), eq(dishes.archived, false)));

  for (const member of everyone) {
    if (ordered.has(member.id)) continue;
    const answer = answers.find((entry) => entry.memberId === member.id)?.status;
    if (effectiveAttendance(member, date, answer, absent).status !== 'in') continue;
    const fallback = defaults.find((entry) => entry.entry.memberId === member.id);
    if (!fallback) continue;
    await tx.insert(orderItems).values({
      fridayDate: date,
      memberId: member.id,
      dishId: fallback.dish.id,
      name: fallback.dish.name,
      category: fallback.dish.category,
      unitPriceCents: unitPriceCents(fallback.dish.priceCents, fallback.entry.options),
      options: fallback.entry.options,
      note: fallback.entry.note,
      quantity: 1,
      isDefault: true,
    });
  }
}

/**
 * Locks the recent Fridays whose deadline has passed while nobody had the page open. A
 * Friday nobody touched has no row and nothing to lock; opening it locks it anyway.
 */
export async function lockDueFridays(db: Db, now: Date): Promise<IsoDate[]> {
  const thisWeek = currentFriday(now);
  const due = await db
    .select({ date: fridays.date })
    .from(fridays)
    .where(
      and(
        gte(fridays.date, addWeeks(thisWeek, -1)),
        lte(fridays.date, thisWeek),
        isNull(fridays.lockedAt),
        eq(fridays.cancelled, false)
      )
    );
  const locked: IsoDate[] = [];
  for (const { date } of due) {
    if (await lockFriday(db, date, now)) locked.push(date);
  }
  return locked;
}

/** Splits the amount Lieferando actually charged and stores what everyone owes. */
export async function settleFriday(db: Db, date: IsoDate, totalCents: number, now: Date) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(fridays).where(eq(fridays.date, date));
    if (!row?.lockedAt) throw new ServiceError('Erst nach Bestellschluss abrechnen');
    if (row.mode === 'flat')
      throw new ServiceError('Bei einer Pauschale gibt es nichts abzurechnen');
    const items = await tx.select().from(orderItems).where(eq(orderItems.fridayDate, date));
    const shares = splitTotal(items, totalCents);
    if (shares.length === 0) throw new ServiceError('Es wurde nichts bestellt');
    await tx.delete(charges).where(eq(charges.fridayDate, date));
    await tx.insert(charges).values(
      shares.map((share) => ({
        fridayDate: date,
        memberId: share.memberId,
        amountCents: share.totalCents,
      }))
    );
    await tx
      .update(fridays)
      .set({ finalTotalCents: totalCents, settledAt: now, updatedAt: now })
      .where(eq(fridays.date, date));
  });
}

/** Undoes the split so orders can be corrected; payments stay in the ledger. */
export async function reopenSettlement(db: Db, date: IsoDate) {
  await db
    .update(fridays)
    .set({ settledAt: null, updatedAt: new Date() })
    .where(eq(fridays.date, date));
}

/**
 * Paying opens at the deadline: before it, orders and with them everyone's share still
 * change, so an amount paid early would rarely be right.
 */
export function paymentOpen(view: Pick<FridayView, 'date' | 'locked'>, now: Date): boolean {
  return view.locked || isPastDeadline(view.date, now);
}

export async function recordPayment(
  db: Db,
  input: {
    date: IsoDate;
    memberId: number;
    amountCents: number;
    recordedById: number;
    /** Who got the money; null or left out for the host. */
    payeeId?: number | null;
  }
) {
  if (input.amountCents === 0) return;
  await db.insert(payments).values({
    fridayDate: input.date,
    memberId: input.memberId,
    amountCents: input.amountCents,
    payeeId: input.payeeId ?? null,
    recordedById: input.recordedById,
  });
}

/**
 * Books what someone still owes, one payment per payee, so the food money can go to
 * whoever fetched the food and the drinks money to the host. With `refunds`, money due
 * back is booked as paid back too. Returns the amount booked.
 */
export async function bookOpen(
  db: Db,
  input: { date: IsoDate; memberId: number; money: Money; recordedById: number },
  { refunds = false } = {}
): Promise<number> {
  let booked = 0;
  for (const debt of input.money.debts) {
    if (debt.openCents === 0 || (debt.openCents < 0 && !refunds)) continue;
    await recordPayment(db, {
      date: input.date,
      memberId: input.memberId,
      amountCents: debt.openCents,
      recordedById: input.recordedById,
      payeeId: debt.payeeId,
    });
    booked += debt.openCents;
  }
  return booked;
}

/** Forgets every payment of one person for a Friday, for when one was a mistake. */
export async function clearPayments(db: Db, date: IsoDate, memberId: number) {
  await db
    .delete(payments)
    .where(and(eq(payments.fridayDate, date), eq(payments.memberId, memberId)));
}

export async function setDrinksOptOut(db: Db, date: IsoDate, memberId: number, optOut: boolean) {
  if (optOut) {
    await db.insert(drinksOptOuts).values({ fridayDate: date, memberId }).onConflictDoNothing();
  } else {
    await db
      .delete(drinksOptOuts)
      .where(and(eq(drinksOptOuts.fridayDate, date), eq(drinksOptOuts.memberId, memberId)));
  }
}

/** The tip for this Friday, or null for the usual amount. */
export async function setTip(db: Db, date: IsoDate, tipCents: number | null) {
  await touch(db, date, { tipCents });
}

/** A voucher for this Friday's order, or null for none. */
export async function setVoucher(db: Db, date: IsoDate, voucherCents: number | null) {
  await touch(db, date, { voucherCents });
}

/**
 * Whether someone fetches the food, and who (null: the host). Once anyone has paid, the
 * money already went to someone, so it stays as it is.
 */
export async function setPickup(db: Db, date: IsoDate, pickup: boolean, pickerId: number | null) {
  const row = await getFridayRow(db, date);
  if (row?.settledAt) throw new ServiceError('Schon abgerechnet – erst die Abrechnung öffnen');
  const [paid] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.fridayDate, date))
    .limit(1);
  if (paid) {
    throw new ServiceError('Es wurde schon bezahlt, Abholen und Abholer bleiben deshalb so');
  }
  if (pickerId !== null) {
    const [picker] = await db.select().from(members).where(eq(members.id, pickerId));
    if (!picker || picker.kind !== 'member' || !picker.active) {
      throw new ServiceError('Abholen kann nur jemand aus der Runde');
    }
  }
  await touch(db, date, { pickup, pickerId: pickup ? pickerId : null });
}

/** The drinks fee per person for the Friday, or null for the usual one; 0 means none. */
export async function setDrinksFee(db: Db, date: IsoDate, drinksFeeCents: number | null) {
  await touch(db, date, { drinksFeeCents });
}

export type Participant = {
  member: Member;
  attendance: EffectiveAttendance;
  /** When they last answered for this Friday, if they did. */
  answeredAt: Date | null;
  addedById: number | null;
  items: OrderItem[];
  itemsCents: number;
  hasDefault: boolean;
  /** Before the lock: the default this silent member is going to get. */
  projectedDefault: { name: string; unitPriceCents: number } | null;
  share: MemberShare | null;
  drinksOptOut: boolean;
  money: Money;
};

export type FridayView = {
  date: IsoDate;
  host: Member | null;
  hostIsDefault: boolean;
  /** The host is away that day, so someone has to take over or the Friday is called off. */
  hostAbsent: boolean;
  cancelled: boolean;
  cancelReason: string | null;
  note: string | null;
  mode: FridayMode;
  flatTitle: string | null;
  flatPriceCents: number | null;
  restaurant: Restaurant | null;
  /** Someone fetches the food: the restaurant offers it and the host chose it. */
  pickup: boolean;
  /** Who fetches it, pays the restaurant and gets the food money; the host unless set. */
  picker: Member | null;
  /** The restaurant delivers to this Friday's host (otherwise it can only be fetched). */
  restaurantDelivers: boolean;
  /** The host picked the restaurant, so there is no vote. */
  restaurantChosen: boolean;
  /** The vote was counted. */
  voteClosed: boolean;
  votes: Vote[];
  /** Whose orders the vote threw away by switching the restaurant. */
  voteDroppedIds: number[];
  /** True when no restaurant was picked and the default one applies. */
  restaurantIsDefault: boolean;
  dishes: Dish[];
  deadline: Date;
  orderTime: Date;
  locked: boolean;
  settled: boolean;
  finalTotalCents: number | null;
  participants: Participant[];
  estimate: FeeEstimate | null;
  shares: MemberShare[];
  /** The drinks fee per person this Friday (0 when switched off). */
  drinksFeeCents: number;
  /** What the host set for this Friday; null means the usual rule. */
  fixedTipCents: number | null;
  customDrinksFeeCents: number | null;
  /** A voucher the host entered for this Friday's order, or null. */
  voucherCents: number | null;
  /** What the drinks fees add up to: the host's drinks kitty. */
  drinksTotalCents: number;
};

/** Everything a Friday page shows, after closing ordering if the deadline has passed. */
export async function loadFriday(db: Db, date: IsoDate, now: Date): Promise<FridayView> {
  await closeVote(db, date, now);
  await lockFriday(db, date, now);
  const row = await getFridayRow(db, date);
  const defaultHost = await getDefaultHost(db);
  const mode = row?.mode ?? 'delivery';

  const answers = await db.select().from(attendance).where(eq(attendance.fridayDate, date));
  const ledger = await db.select().from(payments).where(eq(payments.fridayDate, date));
  const optedOut = new Set(
    (
      await db
        .select({ memberId: drinksOptOuts.memberId })
        .from(drinksOptOuts)
        .where(eq(drinksOptOuts.fridayDate, date))
    ).map((entry) => entry.memberId)
  );
  const drinksFeeCents = row?.drinksFeeCents ?? DRINKS_FEE_CENTS;
  const involvedIds = [...new Set([...answers, ...ledger].map((entry) => entry.memberId))];
  const people = await db
    .select()
    .from(members)
    .where(
      or(
        and(eq(members.kind, 'member'), eq(members.active, true), eq(members.core, true)),
        involvedIds.length ? inArray(members.id, involvedIds) : undefined
      )
    )
    .orderBy(asc(members.name));
  const hostId = row?.hostId ?? defaultHost?.id ?? null;
  const host =
    people.find((person) => person.id === hostId) ??
    (hostId ? ((await db.select().from(members).where(eq(members.id, hostId)))[0] ?? null) : null);

  const defaultRestaurant =
    mode === 'delivery' && !row?.restaurantId ? await hostRestaurant(db, hostId) : null;
  const restaurantId =
    mode === 'delivery' ? (row?.restaurantId ?? defaultRestaurant?.id ?? null) : null;
  const [restaurant] = restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, restaurantId))
    : [];
  const menu = restaurantId
    ? await db
        .select()
        .from(dishes)
        .where(and(eq(dishes.restaurantId, restaurantId), eq(dishes.archived, false)))
        .orderBy(asc(dishes.sortOrder), asc(dishes.id))
    : [];
  const defaults = restaurantId
    ? (
        await db
          .select({ entry: memberDefaults, dish: dishes })
          .from(memberDefaults)
          .leftJoin(dishes, eq(dishes.id, memberDefaults.dishId))
          .where(eq(memberDefaults.restaurantId, restaurantId))
      ).filter((entry) => !entry.dish?.archived)
    : [];

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.fridayDate, date))
    .orderBy(asc(orderItems.id));
  const absent = await absencesOverlapping(db, date, date);
  const storedCharges = await db.select().from(charges).where(eq(charges.fridayDate, date));
  const settled = Boolean(row?.settledAt);

  const locked = Boolean(row?.lockedAt);
  const cancelled = row?.cancelled ?? false;
  const base = people.map((member) => {
    const answer = answers.find((entry) => entry.memberId === member.id);
    const own = items.filter((item) => item.memberId === member.id);
    const fallback = defaults.find((entry) => entry.entry.memberId === member.id);
    // A default of „nix“ means: when they say nothing, they come without eating.
    const silentMeans = mode === 'flat' ? 'out' : fallback && !fallback.dish ? 'nofood' : 'in';
    const attendance = effectiveAttendance(member, date, answer?.status, absent, silentMeans);
    // Until the lock, a silent member's default is what they will get, so the estimate
    // counts it; otherwise early payers would pay fees split among too few people.
    const projectedDefault =
      !locked &&
      member.kind === 'member' &&
      attendance.status === 'in' &&
      own.length === 0 &&
      fallback?.dish
        ? {
            name: fallback.dish.name,
            unitPriceCents: unitPriceCents(fallback.dish.priceCents, fallback.entry.options),
          }
        : null;
    return {
      member,
      attendance,
      answeredAt: answer?.updatedAt ?? null,
      addedById: answer?.addedById ?? null,
      items: own,
      itemsCents: own.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
      hasDefault: Boolean(fallback),
      projectedDefault,
    };
  });

  const priced = [
    ...items,
    ...base.flatMap((entry) =>
      entry.projectedDefault
        ? [
            {
              memberId: entry.member.id,
              unitPriceCents: entry.projectedDefault.unitPriceCents,
              quantity: 1,
            },
          ]
        : []
    ),
  ];
  const subtotal = priced.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const area = restaurant ? await restaurantHostIds(db, restaurant.id) : [];
  const restaurantDelivers = area.length === 0 || (hostId !== null && area.includes(hostId));
  const votes = await db
    .select({ memberId: restaurantVotes.memberId, restaurantId: restaurantVotes.restaurantId })
    .from(restaurantVotes)
    .where(eq(restaurantVotes.fridayDate, date))
    .orderBy(asc(restaurantVotes.createdAt));
  // A restaurant that does not deliver to the host can only be fetched.
  const pickup = Boolean(restaurant?.pickup && (row?.pickup || !restaurantDelivers));
  const picker = !pickup
    ? null
    : ((row?.pickerId
        ? (people.find((person) => person.id === row.pickerId) ??
          (await db.select().from(members).where(eq(members.id, row.pickerId)))[0])
        : null) ?? host);
  const estimate = restaurant
    ? estimateFees(
        subtotal,
        restaurant,
        row?.tipCents ?? DEFAULT_TIP_CENTS,
        row?.voucherCents ?? 0,
        pickup
      )
    : null;
  const finalTotalCents = row?.finalTotalCents ?? null;
  const flatPrice = row?.flatPriceCents ?? 0;
  const shares: MemberShare[] = cancelled
    ? []
    : mode === 'flat'
      ? base
          .filter((entry) => entry.attendance.status === 'in')
          .map((entry) => ({
            memberId: entry.member.id,
            itemsCents: flatPrice,
            sharedCents: 0,
            totalCents: flatPrice,
          }))
      : splitTotal(priced, finalTotalCents ?? estimate?.totalCents ?? subtotal);

  const participants = base.map((entry): Participant => {
    const share = shares.find((candidate) => candidate.memberId === entry.member.id) ?? null;
    const charge = storedCharges.find((candidate) => candidate.memberId === entry.member.id);
    const foodCents =
      settled && mode === 'delivery' ? (charge?.amountCents ?? 0) : (share?.totalCents ?? 0);
    const drinksOptOut = optedOut.has(entry.member.id);
    const comes = entry.attendance.status !== 'out' && !cancelled;
    return {
      ...entry,
      share,
      drinksOptOut,
      money: moneyFor({
        memberId: entry.member.id,
        hostId,
        pickerId: picker?.id ?? null,
        foodCents,
        drinksCents: comes && !drinksOptOut ? drinksFeeCents : 0,
        payments: ledger.filter((payment) => payment.memberId === entry.member.id),
      }),
    };
  });

  return {
    date,
    host,
    hostIsDefault: !row?.hostId,
    hostAbsent: hostId !== null && absent.some((absence) => absence.memberId === hostId),
    cancelled,
    cancelReason: row?.cancelReason ?? null,
    note: row?.note ?? null,
    mode,
    flatTitle: row?.flatTitle ?? null,
    flatPriceCents: row?.flatPriceCents ?? null,
    restaurant: restaurant ?? null,
    pickup,
    picker,
    restaurantDelivers,
    restaurantChosen: row?.restaurantChosen ?? false,
    voteClosed: Boolean(row?.voteClosedAt),
    votes,
    voteDroppedIds: row?.voteDroppedIds ?? [],
    restaurantIsDefault: Boolean(defaultRestaurant),
    dishes: menu,
    deadline: orderDeadline(date),
    orderTime: orderTime(date),
    locked,
    settled,
    finalTotalCents,
    participants,
    estimate,
    shares,
    drinksFeeCents,
    fixedTipCents: row?.tipCents ?? null,
    customDrinksFeeCents: row?.drinksFeeCents ?? null,
    voucherCents: row?.voucherCents ?? null,
    drinksTotalCents: participants.reduce((sum, entry) => sum + entry.money.drinksCents, 0),
  };
}

export type CalendarEntry = {
  date: IsoDate;
  host: Member | null;
  hostIsDefault: boolean;
  cancelled: boolean;
  cancelReason: string | null;
  note: string | null;
  mode: FridayMode;
  flatTitle: string | null;
  flatPriceCents: number | null;
  restaurant: Pick<Restaurant, 'id' | 'name' | 'cuisine'> | null;
  restaurantIsDefault: boolean;
  hostAbsent: boolean;
  absentMemberIds: number[];
  /** Members and the guests added to this Friday, with whether they come, by name. */
  people: CalendarPerson[];
};

export type CalendarPerson = AttendancePerson;

/** The coming Fridays with host, restaurant and who is away, for the calendar. */
export async function loadCalendar(db: Db, from: IsoDate, weeks: number): Promise<CalendarEntry[]> {
  const dates = fridaysFrom(from, weeks);
  const to = dates[dates.length - 1]!;
  const rows = await db
    .select()
    .from(fridays)
    .where(and(gte(fridays.date, from), lte(fridays.date, to)));
  const everyone = await db.select().from(members);
  const defaultHost = everyone.find((member) => member.isDefaultHost && member.active) ?? null;
  const allRestaurants = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      cuisine: restaurants.cuisine,
      archived: restaurants.archived,
    })
    .from(restaurants);
  const absent = await absencesOverlapping(db, from, to);
  const answers = await db
    .select()
    .from(attendance)
    .where(and(gte(attendance.fridayDate, from), lte(attendance.fridayDate, to)));
  // Only the restaurant matters, and only whether the default is „nix“.
  const nothingDefaults = await db
    .select({ memberId: memberDefaults.memberId, restaurantId: memberDefaults.restaurantId })
    .from(memberDefaults)
    .where(isNull(memberDefaults.dishId));

  return dates.map((date) => {
    const row = rows.find((entry) => entry.date === date);
    const host = row?.hostId
      ? (everyone.find((member) => member.id === row.hostId) ?? null)
      : defaultHost;
    const absentMemberIds = [
      ...new Set(
        absent
          .filter((absence) => absence.fromDate <= date && date <= absence.toDate)
          .map((absence) => absence.memberId)
      ),
    ];
    const mode = row?.mode ?? 'delivery';
    const defaultRestaurant =
      allRestaurants.find((entry) => entry.id === host?.defaultRestaurantId && !entry.archived) ??
      null;
    const restaurantId = mode === 'delivery' ? (row?.restaurantId ?? defaultRestaurant?.id) : null;
    const dayAnswers = answers.filter((entry) => entry.fridayDate === date);
    // The same rule as the Friday page (loadFriday): silence means in, „nix“ as default means
    // coming without food, and a flat-price evening needs a yes.
    const people = everyone
      .filter(
        (member) =>
          (member.kind === 'member' && member.active && member.core) ||
          dayAnswers.some((entry) => entry.memberId === member.id)
      )
      .map((member) => {
        const answer = dayAnswers.find((entry) => entry.memberId === member.id)?.status;
        const eatsNothing = nothingDefaults.some(
          (entry) => entry.memberId === member.id && entry.restaurantId === restaurantId
        );
        const silentMeans = mode === 'flat' ? 'out' : eatsNothing ? 'nofood' : 'in';
        const effective = effectiveAttendance(member, date, answer, absent, silentMeans);
        return {
          id: member.id,
          name: member.name,
          status: effective.status,
          answered: effective.reason === 'answered',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return {
      people,
      date,
      host,
      hostIsDefault: !row?.hostId,
      cancelled: row?.cancelled ?? false,
      cancelReason: row?.cancelReason ?? null,
      note: row?.note ?? null,
      mode,
      flatTitle: row?.flatTitle ?? null,
      flatPriceCents: row?.flatPriceCents ?? null,
      restaurant:
        mode === 'delivery'
          ? row?.restaurantId
            ? (allRestaurants.find((entry) => entry.id === row.restaurantId) ?? null)
            : defaultRestaurant
          : null,
      restaurantIsDefault: mode === 'delivery' && !row?.restaurantId && Boolean(defaultRestaurant),
      hostAbsent: host ? absentMemberIds.includes(host.id) : false,
      absentMemberIds,
    };
  });
}

/**
 * The Fridays from `from` to `to` that `memberId` hosts and that still take place, from
 * this week on: what someone who enters an absence has to find a substitute for.
 */
export async function hostedFridaysBetween(
  db: Db,
  memberId: number,
  from: IsoDate,
  to: IsoDate,
  now: Date
): Promise<IsoDate[]> {
  const start = currentFriday(now);
  if (to < start) return [];
  const weeks = Math.min(Math.floor(daysBetween(start, to) / 7) + 1, 53);
  const entries = await loadCalendar(db, start, weeks);
  return entries
    .filter(
      (entry) => isWithin(entry.date, from, to) && entry.host?.id === memberId && !entry.cancelled
    )
    .map((entry) => entry.date);
}

/** What one person still owes one payee, or gets back, for an earlier Friday. */
export type OpenBalance = {
  fridayDate: IsoDate;
  member: Pick<Member, 'id' | 'name' | 'kind' | 'phone'>;
  /** Who brought a guest; their open money is that person's to sort out. */
  addedById: number | null;
  money: Money;
  debt: Debt;
  payee: Pick<Member, 'id' | 'name' | 'paypalMe'> | null;
  title: string;
};

const BALANCE_LOOKBACK_WEEKS = 8;

/**
 * Everyone who still owes money or gets some back for the Fridays before `before`, once
 * the Friday's amounts are final (`isBilled`), one entry per payee.
 */
export async function openBalances(db: Db, before: IsoDate, now: Date): Promise<OpenBalance[]> {
  const candidates = await db
    .select({ date: fridays.date })
    .from(fridays)
    .where(
      and(
        gte(fridays.date, addWeeks(before, -BALANCE_LOOKBACK_WEEKS)),
        lte(fridays.date, addWeeks(before, -1))
      )
    )
    .orderBy(asc(fridays.date));
  const result: OpenBalance[] = [];
  for (const { date } of candidates) {
    const view = await loadFriday(db, date, now);
    if (!isBilled(view)) continue;
    const title = view.cancelled
      ? 'abgesagt'
      : view.mode === 'flat'
        ? (view.flatTitle ?? 'Pauschale')
        : (view.restaurant?.name ?? 'Freitag');
    for (const participant of view.participants) {
      for (const debt of participant.money.debts) {
        if (debt.openCents === 0) continue;
        const payee = payeeOf(view, debt);
        result.push({
          fridayDate: date,
          member: participant.member,
          addedById: participant.addedById,
          money: participant.money,
          debt,
          payee: payee ? { id: payee.id, name: payee.name, paypalMe: payee.paypalMe } : null,
          title,
        });
      }
    }
  }
  return result;
}

/** A member's own open balances and those of the guests they brought. */
export async function openBalancesFor(db: Db, memberId: number, before: IsoDate, now: Date) {
  return (await openBalances(db, before, now)).filter(
    (balance) => balance.member.id === memberId || balance.addedById === memberId
  );
}
